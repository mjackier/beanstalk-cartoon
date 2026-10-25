// =====================================================================
// The storybook: one style string, one cast, one page list.
// Every image call is built from these constants, so the book stays
// consistent. Edit wording HERE (after trying it in the Playground),
// never inline in server.js.
// =====================================================================

// The ONE style string for the whole book. Same words in every call. Never change mid-book.
export const STYLE =
  "Modern 3D animated feature film style: rounded forms, large expressive eyes, soft rim light.";

// Fixed descriptions of every recurring character, reused word-for-word on every page.
export const CAST = {
  jackOutfit:
    "a patched oatmeal-colored linen tunic, a brown rope belt, dark green trousers, and scuffed brown leather boots",
  mother:
    "Jack's mother: a slim woman in her thirties who looks like a believable parent of Jack (similar skin tone and features), " +
    "chestnut-brown hair in a loose bun, a faded blue dress with rolled-up sleeves, and a cream apron",
  oldMan:
    "a stooped, kindly but mysterious old man with a long white beard, a wide-brimmed grey hat, and a dark green hooded cloak",
  cow:
    "Milky-White, a thin, gentle white cow with a few pale-brown patches, a small brass bell on a leather collar, and a frayed rope halter",
};

const NO_TEXT =
  "Do NOT draw any text, letters, words, numbers, signs, labels, captions, or speech bubbles anywhere in the image.";

// Where the story text will be drawn later (in the PDF, not by the image model).
// position: "top" | "bottom"; size: fraction of the page height; tone: "light" | "dark" background.
//
// Pages with ready: false are planned but not generated yet (this iteration = pages 1-3).
// To add page 4, fill it in and flip ready to true. Nothing else in the code needs to change.
export const PAGES = [
  {
    id: "empty-cupboard",
    number: 1,
    ready: true,
    title: "The empty cupboard",
    text: "Jack and his mother had nothing left to sell but Milky-White.",
    jack:
      "Jack's whole face is shown from the front, evenly front-lit, eyes turned toward his mother, with a worried expression.",
    scene:
      "Inside a bare, poor cottage kitchen. The cupboard doors hang open and the shelves are empty. " +
      "Jack and his mother stand together in the kitchen; she looks sad and tired. " +
      "The cottage door is wide open, and through it Milky-White the cow is clearly visible standing outside in the yard.",
    cast: ["mother", "cow"],
    lighting: "Soft, warm morning light; muted, earthy colors.",
    textArea: { position: "bottom", size: 0.33, tone: "light" },
    composition:
      "Keep the lower third of the picture quiet: plain floorboards with no faces, no important objects, and no bright highlights there, so story text can sit on it.",
  },
  {
    id: "the-trade",
    number: 2,
    ready: true,
    title: "The trade",
    text: "Five magic beans, said the old man. For one cow.",
    jack:
      "Jack is shown in three-quarter view, turned toward the old man, curious and tempted. He wears exactly the same outfit as in the reference image.",
    scene:
      "A dirt road winding through green fields toward a distant market town. " +
      "The old man faces Jack and holds out his open palm with exactly five beans in it, each a different bright color (red, blue, yellow, purple, green), clearly visible. " +
      "Jack holds Milky-White's rope in one hand; the cow stands right beside him.",
    cast: ["oldMan", "cow"],
    lighting: "Bright, clear midday light; fresh greens and warm browns.",
    textArea: { position: "top", size: 0.25, tone: "light" },
    composition:
      "Wide shot from a slightly higher, farther-back camera: Jack, the old man, and the cow are shown full-body in the middle and lower part of the picture, " +
      "and the tops of ALL their heads and hats are below the top third of the picture. " +
      "The top third is only open, simple pale-blue sky with a few soft clouds: no heads, hats, faces, birds, trees, or details there, so story text can sit on it.",
  },
  {
    id: "out-the-window",
    number: 3,
    ready: true,
    title: "Out the window",
    text: "Beans! she cried. And out the window they went.",
    jack:
      "Jack stands in the open cottage doorway, surprised and upset. His head is tilted and turned toward the flying beans and his eyes are clearly looking AT the beans, " +
      "following them as they fall. Show his face in three-quarter view, lit by warm light from the doorway, so it is clearly recognizable while he watches the beans.",
    scene:
      "The outside of the cottage at dusk. Jack's mother leans out of a window next to the doorway, angrily flinging the beans out; " +
      "the five colored beans arc through the air in front of Jack, between the window and the garden, and fall into the dark garden below. " +
      "Jack's line of sight and the beans are clearly connected: he is watching them land.",
    cast: ["mother"],
    lighting:
      "Dusk: a noticeably darker, cooler palette than daytime, with deep blues and purples, lit by warm orange light from the window and doorway.",
    textArea: { position: "bottom", size: 0.3, tone: "dark" },
    composition:
      "The bottom third of the picture is dark, shadowed, plain grass with no objects, faces, or highlights, kept quiet so story text can sit on it.",
  },

  // ---- Planned, not built yet ----
  {
    id: "beanstalk-dawn",
    number: 4,
    ready: false,
    title: "The beanstalk at dawn",
    text: "",
    jack: "",
    scene: "",
    cast: [],
    lighting: "Dawn.",
    textArea: { position: "bottom", size: 0.3, tone: "light" },
    composition: "",
  },
  // Later pages include the two scenes from the previous homework
  // ("Jack is planting the seeds", "Jack is climbing the beanstalk"); see prompt.js.
];

export const READY_PAGES = PAGES.filter((p) => p.ready);

export function getPage(id) {
  return READY_PAGES.find((p) => p.id === id);
}

const IDENTITY =
  "Keep the child's face recognizably the same person: face shape, skin tone, hair color and hairstyle, eye shape and color, eyebrows, nose, mouth, " +
  "and any freckles, dimples, or glasses. Keep the child's apparent age. Natural, undistorted facial proportions.";

// Step 1: the photo becomes ONE reference image of Jack, reused on every page.
export function buildCharacterPrompt() {
  return [
    "Create a character reference image for a children's picture book of Jack and the Beanstalk.",
    "Turn the child in the photo into Jack, the hero of the story.",
    `STYLE: ${STYLE}`,
    `IDENTITY: ${IDENTITY}`,
    `OUTFIT: Jack wears ${CAST.jackOutfit}.`,
    "POSE: full body, standing, facing the viewer, friendly neutral expression, arms relaxed, on a plain light warm-grey background. Jack is the only figure. No props.",
    NO_TEXT,
  ].join("\n");
}

function textAreaWords(page) {
  return page.textArea.position === "top" ? "top of the picture" : "bottom of the picture";
}

// Step 2: each page = the reference image + this prompt.
export function buildPagePrompt(page) {
  const cast = page.cast.map((c) => `- ${CAST[c]}.`).join("\n");
  return [
    `Illustration for page ${page.number} of a children's picture book of Jack and the Beanstalk. Wide landscape picture-book page.`,
    `STYLE: ${STYLE}`,
    `JACK: The child in the reference image is Jack. Keep Jack's face, hair, and outfit exactly as in the reference image: the same child in the same clothes (${CAST.jackOutfit}). ${IDENTITY} ${page.jack}`,
    `SCENE: ${page.scene}`,
    cast ? `OTHER CHARACTERS (draw them exactly like this):\n${cast}` : "",
    `LIGHTING: ${page.lighting}`,
    `COMPOSITION: ${page.composition}`,
    NO_TEXT,
  ]
    .filter(Boolean)
    .join("\n");
}

// Step 3 (optional): edit an existing page instead of regenerating it.
export function buildFixPrompt(page, instruction) {
  return [
    "Edit this picture-book illustration (the first image).",
    `Change only this: ${instruction}`,
    "Keep everything else the same: the composition, the scene, the other characters, the lighting, and the colors.",
    `Jack must still match the second image (the reference): same face, hair, and outfit. ${IDENTITY}`,
    `STYLE: ${STYLE}`,
    `Keep the ${textAreaWords(page)} quiet and empty for the story text.`,
    NO_TEXT,
  ].join("\n");
}
