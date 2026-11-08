# review-log.md

Every run of the `storybook-review` skill (the MCON 368 grading rubric), oldest first.
Entries are only ever appended; earlier runs are never edited.

## Run 1 — 2026-11-08 — reviewer: self (Mattan + Claude) — browser: Claude's built-in browser
Total 96 (first run)
PDF 37/40 · UI 20/20 · Money 19/20 · Engineering 20/20
Little Red (the story not demoed, new photo): upload 17:05:01 → PDF 17:05:57 (56 s)
Jack (same new photo): upload 17:07:42 → PDF 17:08:06 (24 s)
Balance: 0.00 → generate refused (402, "A book costs $0.99 and your balance is $0.00. Add funds first.") → fund 5.00 → generate 4.01 → generate 3.02 → refund $1.00 → 2.02 (updated on screen without reload)
History: +5.00 topup 17:04:38 · −0.99 Red 17:05:01 · −0.99 Jack 17:07:41 · −1.00 refund re_3UZeCVD77uFrOgI50QvDBvWW 17:09:28; sums to 2.02
Avg cost per book: $2.72 over 2 books (min $2.25, max $3.18), price $0.99
Not measured: none

Evidence:
- Site opened signed-out in 0.36 s (first byte 0.28 s).
- Both PDFs: 22 pages = cover + 20 story pages + About Me. Same layout on the same page numbers in both (band pages; split on 3, 8, 11, 17; vignette on 6, 14, 19).
- No text over any face or must-see detail on any page of either PDF; all captions sit on the paper below or beside the art.
- Text is typeset (pdf.js extracts it word for word: p.5 "On the way, he met a strange little old man…"), sharp at 400%.
- About Me: "Zach", age 7, the about text as entered.
- Progress bar named each stage ("Step 3 of 5: Checking every picture · 10 of 20 done · 5 being checked · 3 being redrawn"); thumbnails appeared one by one, each with "try N of 3".
- Sign out → PDFs return 401; sign back in → all 5 PDFs on the account download (200, %PDF).
- 400 px wide: no horizontal scroll (scrollWidth 400), New book flow usable.
- Repo: no key in any commit (git log -p --all), none in app.js; .env not tracked. Bible: 8/8 Jack and 6/6 Red characters with images in the characters table.

Deductions:
- PDF −3: Little Red's hero has the photo's short hair on p.16 and on About Me, but the stand-in's long bob under the hood on most other pages.
- Money −1: the Account page says the one-off bible and scenes cost "$0.00"; they were drawn before cost tracking existed, so that number is wrong, not zero.

Fix first:
1. Every book loses money: $2.72 average API cost against the $0.99 price (Red $3.18, Jack $2.25). Each page edit costs ~$0.10 (two full-size input images at high input fidelity), 20+ per book. Cut input fidelity / input image size or use a cheaper image model until a book costs well under $0.99 (product-breaking; 0 rubric points but the business doesn't work).
2. Little Red hero's hair drifts between the photo's hair and the stand-in's bob (PDF, −3) → tell the swap to replace the hair under the hood and fail the likeness check on hair.
3. Red took 56 s with 10 redraws, 4 s from the limit (Engineering, 6 at risk) → start backup requests sooner and stop redrawing earlier when time is short.
4. "One-off $0.00" setup cost on the Account page is wrong (Money, −1) → show "not tracked (drawn before cost tracking)".
5. 12 of 14 full-page slots fall back to text under the picture, so the books look samey → redraw those scenes with real empty sky/floor for the caption.

