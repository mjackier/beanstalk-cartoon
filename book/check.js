// The quality check: a vision model looks at every generated image and reports problems
// plus the boxes of every face and key story detail (used to keep text off them).
import { lookAt } from "../lib/openai.js";

const BOX = {
  type: "object",
  additionalProperties: false,
  required: ["label", "kind", "x", "y", "w", "h"],
  properties: {
    label: { type: "string" },
    kind: { type: "string", enum: ["face", "character", "object"] },
    x: { type: "number" },
    y: { type: "number" },
    w: { type: "number" },
    h: { type: "number" },
  },
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "hero_present",
    "hero_face_visible",
    "hero_count",
    "likeness",
    "pasted_on",
    "anatomy_ok",
    "text_in_image",
    "missing",
    "problems",
    "score",
    "boxes",
  ],
  properties: {
    hero_present: { type: "boolean" },
    hero_face_visible: { type: "boolean" },
    hero_count: { type: "integer" },
    likeness: { type: "integer", description: "0-10: how clearly the hero is the same child as the reference portrait" },
    pasted_on: { type: "boolean", description: "the hero's head looks pasted on: different style, lighting or proportions from the rest" },
    anatomy_ok: { type: "boolean" },
    text_in_image: { type: "boolean" },
    missing: { type: "array", items: { type: "string" } },
    problems: { type: "array", items: { type: "string" } },
    score: { type: "integer", description: "0-10 overall quality as a professional picture-book page" },
    boxes: { type: "array", items: BOX },
  },
};

const BOX_RULES =
  "BOXES: list a tight box for EVERY face (humans and animals: the whole head), every character's body, and each item in the must-see list. " +
  "Coordinates are fractions of the image: x and y are the top-left corner (0 = left/top, 1 = right/bottom), w and h the size. Be accurate.";

// kind: "page" (hero edited into a scene) | "scene" (stand-in hero) | "portrait" (hero from photo)
export async function checkImage({ kind, image, story, page, portrait, photo, model }) {
  const images = [{ buffer: image, mime: "image/jpeg", detail: "high", label: "IMAGE TO CHECK:" }];
  let task;
  if (kind === "portrait") {
    images.push({ buffer: photo.buffer, mime: photo.mime, detail: "low", label: "THE ORIGINAL PHOTO:" });
    task =
      "You check a cartoon portrait made from a photo for a children's picture book. The portrait should show exactly one child, " +
      "head and shoulders, recognisably the same person as the photo (face shape, skin tone, hair, eyes, glasses), in a polished 3D animated style. " +
      "hero = the child in the portrait; likeness = how clearly it is the person in the photo. must-see: the face.";
  } else {
    if (portrait) images.push({ buffer: portrait, mime: "image/jpeg", detail: "low", label: "THE HERO'S REFERENCE PORTRAIT:" });
    task =
      `You are a strict art director checking page ${page.n} of a children's picture book of "${story.title}". ` +
      `The hero is ${story.heroName}${kind === "scene" ? " (a stand-in child model)" : ", who must be the same child as the reference portrait"}. ` +
      `The page should show: ${page.scene} ${page.hero ? `Hero: ${page.hero}` : "The hero is not on this page."} ` +
      `Must-see details: ${page.keep.join("; ")}. ` +
      "Report anything a picture-book editor would reject: missing must-see details (put them in `missing`), wrong number of objects the text states " +
      "(e.g. five beans), the hero appearing twice, distorted faces or hands, extra limbs, a head that looks pasted on, any letters or text drawn in the picture.";
  }
  const out = await lookAt({
    name: "page_check",
    instructions: `${task}\n${BOX_RULES}\nBe concise in problems (each under 15 words).`,
    images,
    schema: SCHEMA,
    // Scenes are checked once, so they get the stronger model; per-book pages use the fast one.
    model: model || (kind === "scene" ? process.env.OPENAI_VISION_MODEL_SCENES || "gpt-4.1" : undefined),
  });
  // Clamp boxes into the image.
  out.boxes = (out.boxes || [])
    .map((b) => {
      const x = Math.max(0, Math.min(1, b.x));
      const y = Math.max(0, Math.min(1, b.y));
      return { ...b, x, y, w: Math.max(0, Math.min(1 - x, b.w)), h: Math.max(0, Math.min(1 - y, b.h)) };
    })
    .filter((b) => b.w > 0.005 && b.h > 0.005);
  return out;
}

// Pass / fail rules (deterministic, so they are easy to read and test).
export function verdict(kind, c, { needsHero = true } = {}) {
  const fails = [];
  if (c.text_in_image) fails.push("remove all letters and words drawn in the picture");
  if (!c.anatomy_ok) fails.push("fix distorted faces, hands or limbs");
  if (needsHero) {
    if (!c.hero_present) fails.push("the hero is missing");
    else {
      if (!c.hero_face_visible) fails.push("the hero's face must be clearly visible");
      if (c.hero_count > 1) fails.push("draw the hero only once");
      if (kind !== "scene" && c.likeness < 6) fails.push("make the hero look much more like the reference child");
      if (c.pasted_on) fails.push("blend the hero's head into the scene's style and lighting");
    }
  }
  if (c.missing?.length) fails.push(`show clearly: ${c.missing.join(", ")}`);
  if (c.score < 6) fails.push(...(c.problems || []).slice(0, 3));
  const rank = (c.score || 0) + (needsHero && kind !== "scene" ? (c.likeness || 0) * 0.6 : 0) - fails.length * 2;
  return { pass: fails.length === 0, fails, rank };
}

// Bible images: is this really a clean reference sheet of the character described?
const SHEET = {
  type: "object",
  additionalProperties: false,
  required: ["is_character", "single", "matches", "text_in_image", "problems"],
  properties: {
    is_character: { type: "boolean", description: "a finished illustration of the character, not a placeholder, blank or broken image" },
    single: { type: "boolean" },
    matches: { type: "integer", description: "0-10 how well it matches the description" },
    text_in_image: { type: "boolean" },
    problems: { type: "array", items: { type: "string" } },
  },
};

export async function checkCharacter({ image, description }) {
  const c = await lookAt({
    name: "sheet_check",
    instructions: `Check this character reference sheet for a children's picture book. It should show exactly one character, full figure, on a plain background, matching: ${description}. Problems: under 15 words each.`,
    images: [{ buffer: image, mime: "image/jpeg", detail: "low" }],
    schema: SHEET,
    model: process.env.OPENAI_VISION_MODEL_SCENES || "gpt-4.1",
  });
  const fails = [];
  if (!c.is_character) fails.push("draw the actual character, a finished illustration");
  if (!c.single) fails.push("show only this one character");
  if (c.text_in_image) fails.push("no text or letters");
  if (c.matches < 7) fails.push(...(c.problems || []).slice(0, 3));
  return { check: c, pass: fails.length === 0, fails, rank: (c.matches || 0) + (c.is_character ? 10 : 0) - fails.length };
}
