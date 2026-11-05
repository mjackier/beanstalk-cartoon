// Every prompt the app sends, in one place.
import { STYLE, NO_TEXT, TEMPLATE } from "./template.js";

const ZONE_WORDS = {
  top: "the top quarter of the picture",
  bottom: "the bottom quarter of the picture",
  middle: "a horizontal band across the middle of the picture",
};

// 1. Character bible: one reference image per character (drawn once, stored in the database).
export function characterPrompt(story, ch) {
  const body = ch.is_hero
    ? `${ch.description} This is a stand-in model for the hero; give them a friendly, neutral, generic face.`
    : ch.description;
  return [
    `Character reference sheet for a children's picture book of "${story.title}".`,
    `STYLE: ${STYLE}`,
    `CHARACTER: ${body}`,
    "Show this ONE character only, full body, standing in a relaxed neutral pose, turned three-quarters towards the viewer, " +
      "evenly lit, on a plain warm light-grey background. No props unless they are part of the description.",
    NO_TEXT,
  ].join("\n");
}

// 2. Scenes: every page drawn once with the stand-in hero, using the bible images as references.
// refs = [{ key, name, description }] in the same order as the images sent.
export function scenePrompt(story, page, slot, refs, { retryNotes = [] } = {}) {
  const cast = refs.map((r, i) => `- Image ${i + 1} is ${r.name}: ${r.description}`).join("\n");
  const composition =
    slot.layout === "full"
      ? `Keep ${ZONE_WORDS[slot.prefer]} calm and simple (open sky, plain wall, floor or grass): no faces, no characters and no important objects there, because the story text will be printed there.`
      : "Keep every face and important object well inside the frame, away from the edges.";
  return [
    `Illustration for page ${slot.n} of 20 of a children's picture book of "${story.title}". Wide landscape picture-book page.`,
    `STYLE: ${STYLE}`,
    `CHARACTERS: draw each character exactly like its reference image: same face, body, colours and clothes.\n${cast}`,
    `SCENE: ${page.scene}`,
    page.hero ? `HERO: ${page.hero} The hero's face must be clearly visible and large enough to recognise.` : "The hero is NOT in this picture.",
    `CAMERA: ${slot.shot}.`,
    `COMPOSITION: ${composition}`,
    retryNotes.length ? `FIX THESE PROBLEMS FROM THE LAST ATTEMPT: ${retryNotes.join("; ")}.` : "",
    NO_TEXT,
  ]
    .filter(Boolean)
    .join("\n");
}

// 3. Per book: the photo becomes one cartoon portrait of the child (used on every page).
export function heroPortraitPrompt({ retryNotes = [] } = {}) {
  return [
    "Turn the person in this photo into the hero of a children's picture book.",
    `STYLE: ${STYLE}`,
    "Draw them as a cheerful child of about 8 years old: head and shoulders, facing the viewer, friendly smile, evenly lit, on a plain warm light-grey background, wearing a plain cream shirt.",
    "IDENTITY: they must be recognisably the same person: face shape, skin tone, hair colour, hairstyle and hair texture, eye shape and colour, eyebrows, nose, mouth, ears, freckles, dimples and glasses (if they wear glasses). " +
      "Because they are drawn as a young child, leave out any beard or stubble, but keep everything else.",
    retryNotes.length ? `FIX THESE PROBLEMS FROM THE LAST ATTEMPT: ${retryNotes.join("; ")}.` : "",
    NO_TEXT,
  ]
    .filter(Boolean)
    .join("\n");
}

// 4. Per book, per page: edit the child into the pre-generated scene.
// Image 1 = the scene, image 2 = the child's portrait.
export function heroSwapPrompt(story, page, heroDescription, { retryNotes = [] } = {}) {
  return [
    `Image 1 is a finished illustration from a children's picture book of "${story.title}". Image 2 is the real child who is the hero of this book.`,
    `In image 1, the hero is ${story.heroName}: ${heroDescription}`,
    `Redraw ONLY the hero's head, face and hair so that the hero is clearly the child from image 2: same face shape, skin tone, hair colour, hairstyle and texture, eye shape and colour, eyebrows, nose, glasses and freckles (if any).`,
    `Keep the hero's pose, expression, costume, body size and position exactly as they are in image 1 (${page.hero}).`,
    "Draw the new face in exactly the same 3D animated style and lighting as image 1, so it does not look pasted on, with the same head-to-body proportions as before.",
    "Change nothing else: the same background, the same other characters, the same objects, composition and colours as image 1.",
    retryNotes.length ? `FIX THESE PROBLEMS FROM THE LAST ATTEMPT: ${retryNotes.join("; ")}.` : "",
    NO_TEXT,
  ]
    .filter(Boolean)
    .join("\n");
}

export const slotFor = (i) => TEMPLATE[i];
