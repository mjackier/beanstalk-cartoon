// Builds the finished book as PDFs on the server (vendored jsPDF), using the template.
//
// The book is a real 11 x 8.5 in landscape hardcover (Lulu casewrap, 24 interior pages):
//   front cover   the title, "starring <child>", the first picture
//   interior p1   copyright notice and publisher
//   interior p2-21  the 20 story pages (the story starts right after the copyright page)
//   interior p22-24 The End, a page to draw on, a dedication
//   back cover    About Me
//
// Three files come out of the same drawing code, so what the parent approves is what is printed:
//   buildBookPdf        the reading copy: front cover, the 24 interior pages, back cover (26 pages)
//   buildPrintInterior  the 24 interior pages with 0.125 in bleed on every side, for the printer
//   buildPrintCover     one spread (back cover, spine, front cover) sized from Lulu's cover dimensions
import fs from "node:fs";
import { createRequire } from "node:module";
import { LAYOUTS, PAGE_W, PAGE_H, TEMPLATE } from "./template.js";
import { firstClear, fullPageCandidates, padBox, intersects } from "./layout.js";
import { personalize } from "./stories.js";

const require = createRequire(import.meta.url);
globalThis.self ??= globalThis; // jsPDF's UMD build looks for these
globalThis.window ??= globalThis;
const { jsPDF } = require("../vendor/jspdf/jspdf.umd.min.cjs");

const FONT_DIR = new URL("../vendor/fonts/", import.meta.url);
const FONT_FILES = {
  normal: "GentiumBookPlus-Regular.ttf",
  bold: "GentiumBookPlus-Bold.ttf",
  italic: "GentiumBookPlus-Italic.ttf",
};
let fontData = null;
function loadFonts() {
  if (fontData !== null) return fontData;
  try {
    fontData = Object.fromEntries(
      Object.entries(FONT_FILES).map(([style, file]) => [style, fs.readFileSync(new URL(file, FONT_DIR)).toString("base64")])
    );
  } catch {
    fontData = false; // fall back to Times
  }
  return fontData;
}

const INK = [43, 35, 24];
const PAPER = [248, 243, 231];
const MUTED = [118, 108, 90];
const LEAF = [52, 108, 60];

// The trim (finished page) is 792 x 612 pt. The 3:2 story design (PAGE_W x PAGE_H = 792 x 528)
// sits ART_DY down from the top, leaving a paper band underneath for the page number.
export const TRIM_W = 792;
export const TRIM_H = 612;
export const ART_DY = 34;
export const BLEED = 9; // 0.125 in
export const INTERIOR_PAGES = 24;

function newDoc(size = [PAGE_W, PAGE_H]) {
  const doc = new jsPDF({ orientation: size[0] >= size[1] ? "landscape" : "portrait", unit: "pt", format: size, compress: true });
  const fonts = loadFonts();
  if (fonts) {
    for (const [style, b64] of Object.entries(fonts)) {
      doc.addFileToVFS(FONT_FILES[style], b64);
      doc.addFont(FONT_FILES[style], "Book", style);
    }
    doc.bookFont = "Book";
  } else doc.bookFont = "times";
  return doc;
}

const font = (doc, style, size) => {
  doc.setFont(doc.bookFont, style);
  doc.setFontSize(size);
};

// Fill the whole physical page (including any bleed). Call outside shift().
function fillPage(doc, color = PAPER) {
  doc.setFillColor(...color);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), doc.internal.pageSize.getHeight(), "F");
}

// Draw fn() with the origin moved right by dx and down by dy (a PDF "cm" translation).
function shift(doc, dx, dy, fn) {
  if (!dx && !dy) return fn();
  doc.saveGraphicsState();
  doc.setCurrentTransformationMatrix(new doc.Matrix(1, 0, 0, 1, dx, -dy));
  try {
    return fn();
  } finally {
    doc.restoreGraphicsState();
  }
}

function drawArt(doc, jpeg, box, alias) {
  doc.addImage(jpeg, "JPEG", box.x, box.y, box.w, box.h, alias, "NONE");
  if (box.w < PAGE_W) {
    doc.setDrawColor(222, 212, 188);
    doc.setLineWidth(0.8);
    doc.rect(box.x, box.y, box.w, box.h, "S");
  }
}

// Wrap text into a column, shrinking the font until it fits the height.
function fit(doc, text, width, height, { max = 24, min = 14, style = "normal" } = {}) {
  for (let size = max; size >= min; size -= 1) {
    font(doc, style, size);
    const lines = doc.splitTextToSize(text, width);
    const lineH = size * 1.32;
    if (lines.length * lineH <= height || size === min) return { size, lines, lineH, h: lines.length * lineH };
  }
}

function writeLines(doc, f, x, y, width, align = "center", color = INK) {
  font(doc, "normal", f.size);
  doc.setTextColor(...color);
  f.lines.forEach((line, i) => {
    const base = y + f.size * 0.98 + i * f.lineH;
    if (align === "center") doc.text(line, x + width / 2, base, { align: "center" });
    else doc.text(line, x, base);
  });
}

// Page numbers sit in the paper band under the art (trim coordinates), inside the 0.5 in safety margin.
function pageNumber(doc, n) {
  font(doc, "normal", 13);
  doc.setTextColor(...MUTED);
  doc.text(String(n), TRIM_W / 2, TRIM_H - 36, { align: "center" });
}

// Height of the caption panel for some text at a width, as a fraction of the page height.
export function panelMeasure(doc, text) {
  const art = LAYOUTS.full.art;
  return (wFrac) => {
    const f = fit(doc, text, wFrac * art.w - 32, 999, { max: 23, min: 23 });
    return (f.h + 32 - 6) / art.h;
  };
}

// Decide the layout of one page. Returns what was decided so it can be logged and shown.
// scenePanel: the caption spot verified once for this scene (undefined = never checked, null = none is clear).
export function planPage(doc, slot, text, boxes, scenePanel) {
  if (slot.layout === "full" && scenePanel !== undefined) {
    if (!scenePanel) return { layout: "band", fallback: true, reason: "no caption spot on this scene was verified clear" };
    const need = panelMeasure(doc, text)(scenePanel.wFrac);
    const rect = { ...scenePanel.rect };
    if (need > rect.h) {
      // a longer personalised text: grow away from the page edge
      if (scenePanel.zone === "bottom") rect.y -= need - rect.h;
      rect.h = need;
    }
    const hit = boxes.map(padBox).find((b) => intersects(rect, b));
    if (hit) return { layout: "band", fallback: true, reason: `the verified spot would touch ${hit.label} on this book's picture` };
    return { layout: "full", panel: { ...scenePanel, rect }, verified: true };
  }
  if (slot.layout === "full") {
    const art = LAYOUTS.full.art;
    const pad = 16;
    const measure = (wFrac) => {
      const w = wFrac * art.w - 2 * pad;
      const f = fit(doc, text, w, 999, { max: 23, min: 23 });
      return (f.h + 2 * pad - 6) / art.h;
    };
    const chosen = firstClear(fullPageCandidates(slot.prefer, measure), boxes);
    if (chosen) return { layout: "full", panel: chosen };
    return { layout: "band", fallback: true, reason: "no text zone on the picture was clear of faces and key details" };
  }
  return { layout: slot.layout };
}

// One story page, in trim coordinates. `bleed` stretches full-page art into the print bleed.
function drawStoryPage(doc, { slot, text, jpeg, boxes, alias, scenePanel, bleed = 0 }) {
  const plan = planPage(doc, slot, text, boxes, scenePanel);
  shift(doc, 0, ART_DY, () => {
    if (plan.layout === "full") {
      // Uniformly scaled so the art reaches the left and right bleed (no distortion, nothing cropped).
      const w = PAGE_W + 2 * bleed;
      const h = (w * PAGE_H) / PAGE_W;
      const art = { x: -bleed, y: (PAGE_H - h) / 2, w, h };
      drawArt(doc, jpeg, art, alias);
      const r = plan.panel.rect;
      const px = art.x + r.x * art.w;
      const py = art.y + r.y * art.h;
      const pw = r.w * art.w;
      const ph = r.h * art.h;
      doc.saveGraphicsState();
      doc.setGState(new doc.GState({ opacity: 0.9 }));
      doc.setFillColor(...PAPER);
      doc.roundedRect(px, py, pw, ph, 12, 12, "F");
      doc.restoreGraphicsState();
      const f = fit(doc, text, pw - 32, 999, { max: 23, min: 23 });
      writeLines(doc, f, px + 16, py + Math.max(13, (ph - f.h) / 2 - 3), pw - 32, "center");
      return;
    }
    const L = LAYOUTS[plan.layout];
    drawArt(doc, jpeg, L.art, alias);
    const f = fit(doc, text, L.text.w, L.text.h, { max: plan.layout.startsWith("split") ? 20 : 22, min: 13 });
    const ty = L.text.y + Math.max(0, (L.text.h - f.h) / 2) - 4;
    writeLines(doc, f, L.text.x, ty, L.text.w, plan.layout.startsWith("split") ? "left" : "center");
  });
  pageNumber(doc, slot.n);
  return plan;
}

const fmtDate = (d) => new Date(d || Date.now()).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" });

// Front cover, trim coordinates: "<Title>", "starring <Name>", the first picture.
function drawFrontCover(doc, { title, childName, jpeg }) {
  doc.setFillColor(...LEAF);
  doc.rect(0, 0, TRIM_W, TRIM_H, "F");
  doc.setFillColor(...PAPER);
  doc.roundedRect(40, 40, TRIM_W - 80, TRIM_H - 80, 18, 18, "F");
  let size = 44;
  font(doc, "bold", size);
  while (doc.getTextWidth(title) > TRIM_W - 160 && size > 28) font(doc, "bold", (size -= 2));
  doc.setTextColor(...LEAF);
  doc.text(title, TRIM_W / 2, 118, { align: "center" });
  font(doc, "italic", 26);
  doc.setTextColor(...INK);
  doc.text(`starring ${childName}`, TRIM_W / 2, 158, { align: "center" });
  const art = { x: (TRIM_W - 465) / 2, y: 190, w: 465, h: 310 };
  drawArt(doc, jpeg, art, "cover");
  font(doc, "normal", 12);
  doc.setTextColor(...MUTED);
  doc.text("Beanstalk Storybook", TRIM_W / 2, 532, { align: "center" });
}

// Back cover, trim coordinates: About Me.
function drawBackCover(doc, { name, age, favorites, about, heroName, portrait }) {
  doc.setFillColor(...LEAF);
  doc.rect(0, 0, TRIM_W, TRIM_H, "F");
  doc.setFillColor(...PAPER);
  doc.roundedRect(40, 40, TRIM_W - 80, TRIM_H - 80, 18, 18, "F");
  const pw = 280;
  drawArt(doc, portrait, { x: 76, y: (TRIM_H - pw) / 2, w: pw, h: pw }, "portrait");
  const x = 76 + pw + 40;
  const maxW = TRIM_W - x - 76;
  let y = 150;
  font(doc, "bold", 38);
  doc.setTextColor(...LEAF);
  doc.text("About Me", x, y);
  y += 46;
  font(doc, "bold", 26);
  doc.setTextColor(...INK);
  for (const l of doc.splitTextToSize(name, maxW)) {
    doc.text(l, x, y);
    y += 30;
  }
  y += 8;
  const field = (label, value) => {
    if (!value) return;
    font(doc, "bold", 11);
    doc.setTextColor(...MUTED);
    doc.text(label.toUpperCase(), x, y);
    y += 17;
    font(doc, "normal", 15);
    doc.setTextColor(...INK);
    for (const l of doc.splitTextToSize(value, maxW)) {
      doc.text(l, x, y);
      y += 20;
    }
    y += 12;
  };
  field("Age", age);
  // Feedback from homework 3: don't print the favourites twice if "about" already says them.
  const repeated =
    favorites &&
    about &&
    favorites
      .toLowerCase()
      .split(/,|\band\b/)
      .map((s) => s.trim())
      .filter(Boolean)
      .every((item) => about.toLowerCase().includes(item));
  if (!repeated) field("Favourite things", favorites);
  if (about) {
    const f = fit(doc, about, maxW, TRIM_H - 110 - y, { max: 16, min: 11, style: "italic" });
    f.lines.forEach((l, i) => doc.text(l, x, y + f.size + i * f.lineH));
  }
  font(doc, "italic", 12);
  doc.setTextColor(...MUTED);
  doc.text(`Starring ${name} as ${heroName}`, x, TRIM_H - 84);
}

function centered(doc, lines, y, { style = "normal", size = 11, color = INK, gap = 1.45 } = {}) {
  font(doc, style, size);
  doc.setTextColor(...color);
  for (const line of lines) {
    for (const l of doc.splitTextToSize(line, TRIM_W - 240)) {
      doc.text(l, TRIM_W / 2, y, { align: "center" });
      y += size * gap;
    }
  }
  return y;
}

export const PUBLISHER = process.env.PUBLISHER_NAME || "Beanstalk Storybook (Mattan Jackier)";
export const PUBLISHER_SITE = process.env.PUBLISHER_SITE || "beanstalk.jackier.xyz";

// Interior page 1: the copyright notice and the publisher.
function drawCopyright(doc, { title, childName, date }) {
  const year = new Date(date || Date.now()).getFullYear();
  let y = 300;
  y = centered(doc, [`${title}, starring ${childName}`], y, { style: "bold", size: 14 });
  y += 10;
  y = centered(
    doc,
    [
      `Copyright © ${year} ${PUBLISHER}. All rights reserved.`,
      `Published by ${PUBLISHER}, ${PUBLISHER_SITE}`,
      `Personalized edition made for ${childName} on ${fmtDate(date)}.`,
    ],
    y
  );
  y += 10;
  centered(
    doc,
    [
      "Adapted from the traditional folk tale. Illustrations made with AI from a photo shared by the family, for this one book.",
      "No part of this book may be reproduced, stored or shared without written permission from the publisher.",
      "First edition. Printed on demand.",
    ],
    y,
    { size: 10, color: MUTED }
  );
}

function drawTheEnd(doc) {
  font(doc, "bold", 54);
  doc.setTextColor(...LEAF);
  doc.text("The End", TRIM_W / 2, TRIM_H / 2, { align: "center" });
}

function drawYourPicture(doc, { childName }) {
  centered(doc, [`${childName}, draw your favourite part of the story`], 92, { style: "italic", size: 20 });
  doc.setDrawColor(...MUTED);
  doc.setLineWidth(1.2);
  doc.setLineDashPattern([6, 5], 0);
  doc.roundedRect(96, 124, TRIM_W - 192, TRIM_H - 200, 14, 14, "S");
  doc.setLineDashPattern([], 0);
}

function drawDedication(doc, { childName, date }) {
  centered(doc, ["This book was made for", childName], 270, { style: "italic", size: 22, gap: 1.6 });
  centered(doc, [fmtDate(date)], 360, { size: 13, color: MUTED });
}

// "mattan" -> "Mattan" (a name typed all in lower case looks like a typo on a cover)
export const displayName = (name) =>
  name && name === name.toLowerCase() ? name.replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()) : name;

function prepare({ story, book: rawBook }) {
  const book = { ...rawBook, child_name: displayName(rawBook.child_name) };
  const title = story.title;
  const meta = { title: `${title}, starring ${book.child_name}`, subject: "A personalised storybook", creator: PUBLISHER, author: PUBLISHER };
  return { book, title, meta, date: book.created_at };
}

// The 24 interior pages, each a function drawing in trim coordinates. Collects the story-page plans.
function interior({ story, book, pages, title, date }, plans, bleed) {
  const childName = book.child_name;
  return [
    (doc) => drawCopyright(doc, { title, childName, date }),
    ...pages.map((p, i) => (doc) => {
      const slot = TEMPLATE[i];
      const text = personalize(story.pages[i].text, book.pronouns);
      plans.push({ n: slot.n, ...drawStoryPage(doc, { slot, text, jpeg: p.jpeg, boxes: p.boxes || [], alias: `p${i + 1}`, scenePanel: p.scenePanel, bleed }) });
    }),
    (doc) => drawTheEnd(doc),
    (doc) => drawYourPicture(doc, { childName }),
    (doc) => drawDedication(doc, { childName, date }),
  ];
}

const aboutOf = (story, book, portrait) => ({
  name: book.child_name,
  age: book.child_age,
  favorites: book.child_favorites,
  about: book.child_about,
  heroName: story.heroName,
  portrait,
});

// pages: [{ jpeg: Buffer, boxes, scenePanel }], 20 of them in template order.
// The reading copy: front cover, 24 interior pages, back cover, all at trim size.
export function buildBookPdf({ story, book: rawBook, pages, portrait }) {
  const { book, title, meta, date } = prepare({ story, book: rawBook });
  const doc = newDoc([TRIM_W, TRIM_H]);
  doc.setProperties(meta);
  const plans = [];
  drawFrontCover(doc, { title, childName: book.child_name, jpeg: pages[0].jpeg });
  for (const draw of interior({ story, book, pages, title, date }, plans, 0)) {
    doc.addPage([TRIM_W, TRIM_H], "landscape");
    fillPage(doc);
    draw(doc);
  }
  doc.addPage([TRIM_W, TRIM_H], "landscape");
  drawBackCover(doc, aboutOf(story, book, portrait));
  return { pdf: Buffer.from(doc.output("arraybuffer")), plans, pageCount: doc.getNumberOfPages() };
}

// The printer's interior file: 24 pages of 810 x 630 pt (trim + 0.125 in bleed on each side).
export function buildPrintInterior({ story, book: rawBook, pages }) {
  const { book, title, meta, date } = prepare({ story, book: rawBook });
  const size = [TRIM_W + 2 * BLEED, TRIM_H + 2 * BLEED];
  const doc = newDoc(size);
  doc.setProperties(meta);
  const plans = [];
  interior({ story, book, pages, title, date }, plans, BLEED).forEach((draw, i) => {
    if (i > 0) doc.addPage(size, "landscape");
    fillPage(doc);
    shift(doc, BLEED, BLEED, () => draw(doc));
  });
  if (doc.getNumberOfPages() !== INTERIOR_PAGES) throw new Error(`Interior has ${doc.getNumberOfPages()} pages, expected ${INTERIOR_PAGES}.`);
  return { pdf: Buffer.from(doc.output("arraybuffer")), pageCount: INTERIOR_PAGES };
}

// The printer's cover file: one spread, back | spine | front, with the wrap/bleed all around.
// dims: { width, height } in pt from Lulu's /cover-dimensions/. The wrap is whatever is left
// around the two trim panels: wrap = (height - trim height) / 2, spine = width - 2 * (trim width + wrap).
export function coverLayout(dims) {
  const wrap = (dims.height - TRIM_H) / 2;
  const spine = dims.width - 2 * (TRIM_W + wrap);
  if (!(wrap >= 0 && spine >= 0)) throw new Error(`Cover dimensions ${dims.width} x ${dims.height} don't fit an ${TRIM_W} x ${TRIM_H} trim.`);
  return { width: dims.width, height: dims.height, wrap, spine, back: { x: wrap, y: wrap }, front: { x: wrap + TRIM_W + spine, y: wrap } };
}

export function buildPrintCover({ story, book: rawBook, pages, portrait, dims }) {
  const { book, title, meta } = prepare({ story, book: rawBook });
  const L = coverLayout(dims);
  const doc = newDoc([L.width, L.height]);
  doc.setProperties(meta);
  fillPage(doc, LEAF);
  shift(doc, L.back.x, L.back.y, () => drawBackCover(doc, aboutOf(story, book, portrait)));
  // A slightly darker spine. 24 pages is too thin for spine text (Lulu needs 80+ pages for that).
  doc.setFillColor(40, 88, 48);
  doc.rect(L.wrap + TRIM_W, 0, L.spine, L.height, "F");
  shift(doc, L.front.x, L.front.y, () => drawFrontCover(doc, { title, childName: book.child_name, jpeg: pages[0].jpeg }));
  return { pdf: Buffer.from(doc.output("arraybuffer")), layout: L };
}

export { newDoc };
