// Builds the finished book as a PDF on the server (vendored jsPDF), using the template.
// Pages: cover, the 20 story pages, About Me.
import fs from "node:fs";
import { createRequire } from "node:module";
import { LAYOUTS, PAGE_W, PAGE_H, TEMPLATE } from "./template.js";
import { firstClear, fullPageCandidates } from "./layout.js";
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

function newDoc() {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: [PAGE_W, PAGE_H], compress: true });
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

function paper(doc) {
  doc.setFillColor(...PAPER);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");
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

function pageNumber(doc, n, onArt) {
  font(doc, "normal", 11);
  if (onArt) {
    doc.saveGraphicsState();
    doc.setGState(new doc.GState({ opacity: 0.88 }));
    doc.setFillColor(...PAPER);
    doc.circle(PAGE_W - 24, PAGE_H - 24, 12, "F");
    doc.restoreGraphicsState();
    doc.setTextColor(...INK);
    doc.text(String(n), PAGE_W - 24, PAGE_H - 20.2, { align: "center" });
  } else {
    doc.setTextColor(...MUTED);
    doc.text(String(n), PAGE_W / 2, PAGE_H - 10, { align: "center" });
  }
}

// Decide the layout of one page. Returns what was decided so it can be logged and shown.
export function planPage(doc, slot, text, boxes) {
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

function drawStoryPage(doc, { slot, text, jpeg, boxes, alias }) {
  const plan = planPage(doc, slot, text, boxes);
  if (plan.layout === "full") {
    const art = LAYOUTS.full.art;
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
    writeLines(doc, f, px + 16, py + 13, pw - 32, "center");
    pageNumber(doc, slot.n, true);
    return plan;
  }
  paper(doc);
  const L = LAYOUTS[plan.layout];
  drawArt(doc, jpeg, L.art, alias);
  const f = fit(doc, text, L.text.w, L.text.h, { max: plan.layout.startsWith("split") ? 20 : 22, min: 13 });
  const ty = L.text.y + Math.max(0, (L.text.h - f.h) / 2) - 4;
  writeLines(doc, f, L.text.x, ty, L.text.w, plan.layout.startsWith("split") ? "left" : "center");
  pageNumber(doc, slot.n, false);
  return plan;
}

function drawCover(doc, { title, heroName, childName, jpeg }) {
  doc.setFillColor(...LEAF);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");
  doc.setFillColor(...PAPER);
  doc.roundedRect(24, 24, PAGE_W - 48, PAGE_H - 48, 18, 18, "F");
  const art = { x: 216, y: 150, w: 360, h: 240 };
  drawArt(doc, jpeg, art, "cover");
  font(doc, "bold", 40);
  doc.setTextColor(...LEAF);
  doc.text(title, PAGE_W / 2, 98, { align: "center" });
  font(doc, "italic", 18);
  doc.setTextColor(...INK);
  doc.text(`starring ${childName} as ${heroName}`, PAGE_W / 2, 128, { align: "center" });
  font(doc, "normal", 12);
  doc.setTextColor(...MUTED);
  doc.text("A storybook made just for you", PAGE_W / 2, 428, { align: "center" });
}

function drawAboutMe(doc, { name, age, favorites, about, heroName, portrait }) {
  paper(doc);
  const pw = 300;
  drawArt(doc, portrait, { x: 48, y: (PAGE_H - pw) / 2, w: pw, h: pw }, "portrait");
  const x = 48 + pw + 44;
  const maxW = PAGE_W - x - 48;
  let y = 120;
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
    font(doc, "italic", 16);
    doc.setTextColor(...INK);
    for (const l of doc.splitTextToSize(about, maxW)) {
      doc.text(l, x, y);
      y += 22;
    }
  }
  font(doc, "italic", 12);
  doc.setTextColor(...MUTED);
  doc.text(`Starring ${name} as ${heroName}`, x, PAGE_H - 56);
}

// pages: [{ jpeg: Buffer, boxes }], 20 of them in template order.
export function buildBookPdf({ story, book, pages, portrait }) {
  const doc = newDoc();
  doc.setProperties({ title: `${story.title}, starring ${book.child_name}`, subject: "A personalised storybook", creator: "Beanstalk Storybook" });
  drawCover(doc, { title: story.title, heroName: story.heroName, childName: book.child_name, jpeg: pages[0].jpeg });
  const plans = [];
  pages.forEach((p, i) => {
    doc.addPage([PAGE_W, PAGE_H], "landscape");
    const slot = TEMPLATE[i];
    const text = personalize(story.pages[i].text, book.pronouns);
    plans.push({ n: slot.n, ...drawStoryPage(doc, { slot, text, jpeg: p.jpeg, boxes: p.boxes || [], alias: `p${i + 1}` }) });
  });
  doc.addPage([PAGE_W, PAGE_H], "landscape");
  drawAboutMe(doc, {
    name: book.child_name,
    age: book.child_age,
    favorites: book.child_favorites,
    about: book.child_about,
    heroName: story.heroName,
    portrait,
  });
  return { pdf: Buffer.from(doc.output("arraybuffer")), plans, pageCount: pages.length + 2 };
}

export { newDoc };
