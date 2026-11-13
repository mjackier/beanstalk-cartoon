// Rebuilds a finished book's PDFs from what is stored (pictures, their face boxes, the verified
// caption spots), without drawing anything new. Used for the print files Lulu fetches, and to move
// a book made before printing existed onto the print layout (no API calls, nothing charged).
import { STORIES } from "./stories.js";
import { TEMPLATE } from "./template.js";
import { buildBookPdf, buildPrintInterior, buildPrintCover, INTERIOR_PAGES } from "./pdf.js";

const pageId = (n) => `p${String(n).padStart(2, "0")}`;
export const READING_PAGES = INTERIOR_PAGES + 2; // front cover + interior + back cover

export async function loadInputs(store, book) {
  const story = STORIES[book.story];
  if (!story) throw Object.assign(new Error("This is an older 3-page book; it can't be printed."), { status: 400 });
  const hero = await store.getImageData(book.id, "hero", "");
  if (!hero) throw Object.assign(new Error("This book has no hero picture."), { status: 400 });
  const pages = [];
  for (const slot of TEMPLATE) {
    const img = await store.getImageData(book.id, "page", pageId(slot.n));
    if (!img) throw Object.assign(new Error(`Page ${slot.n} is missing; make the book again.`), { status: 400 });
    const scene = await store.getScene(book.story, slot.n, true);
    pages.push({ jpeg: img.data, boxes: img.meta?.boxes || [], scenePanel: scene?.meta?.panel });
  }
  return { story, book, pages, portrait: hero.data };
}

export async function rebuildReadingPdf(store, book) {
  const input = await loadInputs(store, book);
  const { pdf, pageCount } = buildBookPdf(input);
  return store.saveDocument({
    userId: book.user_id,
    bookId: book.id,
    title: `${input.story.title}, starring ${book.child_name}`,
    data: pdf,
    pages: pageCount,
  });
}

// dims: the cover spread size from Lulu's /cover-dimensions/.
export async function buildPrintFiles(store, book, dims) {
  const input = await loadInputs(store, book);
  const title = `${input.story.title}, starring ${book.child_name}`;
  const interior = buildPrintInterior(input);
  const cover = buildPrintCover({ ...input, dims });
  const i = await store.saveDocument({ userId: book.user_id, bookId: book.id, title, data: interior.pdf, pages: interior.pageCount, kind: "print_interior" });
  const c = await store.saveDocument({ userId: book.user_id, bookId: book.id, title, data: cover.pdf, pages: 1, kind: "print_cover" });
  return { interiorId: i.id, coverId: c.id, title, layout: cover.layout };
}
