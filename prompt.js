// All prompt text lives here so you can iterate on it in one place.

// The scene specifications. These exact strings become the image captions.
export const SCENES = {
  planting: {
    title: "Scene 1",
    spec: "Jack is planting the seeds.",
    detail:
      "Jack kneels in the dirt of a small, poor cottage garden in the early morning. " +
      "He is pressing a few magic beans into a freshly dug hole in the soil with his hand. " +
      "A small cloth pouch of beans is in his other hand. A simple wooden cottage and a " +
      "fence are behind him. No beanstalk has grown yet: the ground is bare soil.",
  },
  climbing: {
    title: "Scene 2",
    spec: "Jack is climbing the beanstalk.",
    detail:
      "Jack is partway up an enormous, thick green beanstalk that rises into the clouds. " +
      "He grips the stalk with both hands and has one foot on a giant leaf, mid-climb. " +
      "The cottage is tiny far below him and clouds swirl above. The beanstalk is the " +
      "central element and clearly visible.",
  },
};

const STYLES = {
  storybook: "classic children's storybook illustration, soft painted textures",
  "3d": "polished 3D animated movie style, soft lighting, rounded shapes",
  comic: "bold comic book style, halftone shading, dynamic inking",
  flat: "flat vector cartoon, clean shapes, minimal shading",
  anime: "anime style, cel shading, expressive eyes",
};

const EXAGGERATION = {
  low: "Keep proportions realistic; only a light cartoon stylization.",
  medium: "Moderate cartoon stylization: slightly larger head and eyes.",
  high: "Strong caricature: big head, exaggerated expression, but still the same person.",
};

const OUTLINE = {
  none: "no outlines",
  thin: "thin clean outlines",
  thick: "thick bold outlines",
};

const PALETTE = {
  bright: "bright, saturated colors",
  pastel: "soft pastel colors",
  earthy: "warm earthy tones",
  muted: "muted, desaturated colors",
};

function pick(table, key, fallback) {
  return table[key] ?? table[fallback];
}

export function buildPrompt(sceneId, settings = {}) {
  const scene = SCENES[sceneId];
  const style = pick(STYLES, settings.style, "storybook");
  const exaggeration = pick(EXAGGERATION, settings.exaggeration, "medium");
  const outline = pick(OUTLINE, settings.outline, "thin");
  const palette = pick(PALETTE, settings.palette, "bright");

  const prompt = [
    "Turn the person in the uploaded photo into a cartoon character and place them in a scene from the fairy tale Jack and the Beanstalk.",
    "",
    "IDENTITY (most important): The cartoon character must be clearly recognizable as the person in the photo.",
    "Keep their face shape, skin tone, hair color, hairstyle, eye shape, eyebrows, nose, and any glasses, facial hair, or distinctive features.",
    "Keep their apparent age and gender presentation. Do not replace them with a generic character.",
    "Their face should be visible and facing roughly toward the viewer, large enough to recognize.",
    "Dress them as Jack: simple peasant clothes (tunic, trousers, boots).",
    "",
    `SCENE: ${scene.spec} ${scene.detail}`,
    "The picture must clearly show exactly this action. Do not add a giant, a castle, a goose, or a harp.",
    "",
    `ART STYLE: ${style}; ${outline}; ${palette}. ${exaggeration}`,
    "Full scene illustration, no text, no captions, no borders.",
  ].join("\n");

  return { prompt, sceneSpec: scene.spec };
}
