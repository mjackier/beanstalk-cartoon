// THE TEMPLATE: one 20-page layout that both stories use.
//
// Every page is 792 x 528 pt (11 x 7.33 in, 3:2). Every picture is drawn at 3:2 too,
// so art is never cropped and the "where is the face" boxes from the checker map
// straight onto the page.
//
// A layout says where the art sits and where text may go:
//   full     the art covers the page. Text sits in a panel ON the art, only in a zone
//            the checker found clear of faces and key story details (see layout.js).
//            The scene prompt asks for that zone to be kept quiet, but we never rely on it.
//   band     art on top, text in a band underneath. Text never touches the art.
//   split-L  art on the left, text column on the right. Never touches the art.
//   split-R  art on the right, text column on the left.
//   vignette smaller framed art, text below it. Never touches the art.
// If no zone on a full page is clear, that page falls back to "band" automatically.

export const PAGE_W = 792;
export const PAGE_H = 528;
export const MARGIN = 28;

export const LAYOUTS = {
  full: {
    art: { x: 0, y: 0, w: 792, h: 528 },
    // Candidate text zones, as fractions of the art. Order = preference when several are clear.
    zones: {
      top: { x: 0.05, y: 0.035, w: 0.9, h: 0.2 },
      bottom: { x: 0.05, y: 0.765, w: 0.9, h: 0.2 },
      middle: { x: 0.05, y: 0.4, w: 0.9, h: 0.2 },
    },
    maxWords: 40,
  },
  band: {
    art: { x: 99, y: MARGIN, w: 594, h: 396 },
    text: { x: 72, y: 440, w: 648, h: 72 },
    maxWords: 42,
  },
  "split-L": {
    art: { x: MARGIN, y: 84, w: 528, h: 352 },
    text: { x: 580, y: 84, w: 184, h: 352 },
    maxWords: 40,
  },
  "split-R": {
    art: { x: 792 - MARGIN - 528, y: 84, w: 528, h: 352 },
    text: { x: MARGIN, y: 84, w: 184, h: 352 },
    maxWords: 40,
  },
  vignette: {
    art: { x: 168, y: MARGIN, w: 456, h: 304 },
    text: { x: 96, y: 352, w: 600, h: 140 },
    maxWords: 48,
  },
};

// The 20 slots. `shot` tells the scene prompt how close the camera is;
// `prefer` is the zone a full page asks the illustrator to keep quiet.
export const TEMPLATE = [
  { n: 1, layout: "full", shot: "wide establishing shot", prefer: "top" },
  { n: 2, layout: "band", shot: "medium shot" },
  { n: 3, layout: "split-L", shot: "medium-wide shot" },
  { n: 4, layout: "full", shot: "wide shot", prefer: "top" },
  { n: 5, layout: "band", shot: "medium two-shot" },
  { n: 6, layout: "vignette", shot: "close-up on the hero" },
  { n: 7, layout: "full", shot: "medium-wide shot", prefer: "bottom" },
  { n: 8, layout: "split-R", shot: "medium shot" },
  { n: 9, layout: "band", shot: "medium-wide shot" },
  { n: 10, layout: "full", shot: "dramatic wide shot", prefer: "bottom" },
  { n: 11, layout: "split-L", shot: "wide shot" },
  { n: 12, layout: "band", shot: "medium two-shot" },
  { n: 13, layout: "full", shot: "medium-wide shot", prefer: "top" },
  { n: 14, layout: "vignette", shot: "close-up" },
  { n: 15, layout: "band", shot: "medium shot" },
  { n: 16, layout: "full", shot: "dramatic wide action shot", prefer: "top" },
  { n: 17, layout: "split-R", shot: "medium shot" },
  { n: 18, layout: "band", shot: "medium-wide shot" },
  { n: 19, layout: "vignette", shot: "medium shot" },
  { n: 20, layout: "full", shot: "warm wide shot", prefer: "top" },
];

export const STYLE =
  "Modern 3D animated feature-film style: rounded appealing forms, soft global illumination, warm saturated colours, " +
  "expressive eyes, gentle depth of field, clean uncluttered staging. A premium children's picture book.";

export const NO_TEXT = "Do not draw any words, letters, numbers, captions, signs or speech bubbles anywhere in the picture.";
