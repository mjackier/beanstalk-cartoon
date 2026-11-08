// Where the text goes. This is decided by geometry, never left to the image model.
//
// On "full" pages the text sits on the art, so we try candidate panels (top / bottom / middle,
// centred or pushed left or right, wide or narrow) and keep the first one that does not touch
// any face, character or must-see detail the checker found, with a safety margin around each.
// If none is clear, the page switches to the "band" layout: smaller art, text underneath,
// so nothing can ever be covered.

// Grow each box: faces get the most room, so a panel never grazes a chin or a hat.
export function padBox(b) {
  const pad = b.kind === "face" ? 0.35 : b.kind === "character" ? 0.06 : 0.12;
  const px = b.w * pad + 0.012;
  const py = b.h * pad + 0.012;
  return { ...b, x: b.x - px, y: b.y - py, w: b.w + 2 * px, h: b.h + 2 * py };
}

export function intersects(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// candidates: [{ zone, align, rect }] in fractions of the art. Returns the first clear one.
export function firstClear(candidates, boxes) {
  const keepOut = boxes.map(padBox);
  for (const c of candidates) {
    const hit = keepOut.find((b) => intersects(c.rect, b));
    if (!hit) return { ...c, checked: keepOut.length };
  }
  return null;
}

// Builds the candidate panels for a full page, in preference order.
// measure(widthFrac) -> panel height as a fraction of the art height for text wrapped at that width.
export function fullPageCandidates(prefer, measure) {
  const zones = [prefer, ...["top", "bottom", "middle"].filter((z) => z !== prefer)];
  const out = [];
  for (const zone of zones) {
    for (const [align, wFrac] of [
      ["center", 0.86],
      ["left", 0.5],
      ["right", 0.5],
      ["left", 0.4],
      ["right", 0.4],
    ]) {
      const h = measure(wFrac);
      if (h > 0.4) continue; // too tall to be a caption
      const y = zone === "top" ? 0.035 : zone === "bottom" ? 1 - 0.035 - h : 0.5 - h / 2;
      const x = align === "center" ? (1 - wFrac) / 2 : align === "left" ? 0.035 : 1 - 0.035 - wFrac;
      out.push({ zone, align, wFrac, rect: { x, y, w: wFrac, h } });
    }
  }
  return out;
}
