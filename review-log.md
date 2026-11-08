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

## Run 2 — 2026-11-08 — reviewer: self (Mattan + Claude) — browser: Claude's built-in browser
Total 98 (was 96)
PDF 38/40 · UI 20/20 · Money 20/20 · Engineering 20/20
Little Red (story not demoed, new photo): upload 17:35:41 → PDF 17:36:13 (32 s; was 56 s)
Jack (same photo): upload 17:38:15 → PDF 17:38:49 (34 s)
Balance: 2.02 → fund 5.00 → 7.02 → generate 6.03 → generate 5.04 → refund $1.00 → 4.04 (shown without reload) → refund $4.00 → 0.04 → generate refused (402, "A book costs $0.99 and your balance is $0.04. Add funds first.") → 0.04; a refund larger than the unspent balance was refused
History: +5.00 topup 17:34:10 · −0.99 Red 17:35:41 · −0.99 Jack 17:38:14 · −1.00 refund re_3UZef6D77uFrOgI51SjYuqsv 17:39:19 · −4.00 refund; sums to 0.04
Avg cost per book: $0.53 for the 3 books made since the fix ($0.52 Red, $0.54 Jack, $0.56 test book); $1.41 over all 5 tracked books (price $0.99)
Not measured: none

Changed since run 1:
- Fix 1 (cost): book pages now use low input fidelity: 517 instead of 10,885 image-input tokens, $0.024 instead of $0.107 a page. Measured side by side on pages 2, 11 and 16 first: same scene, same likeness. Books went from $2.25–3.18 to $0.52–0.56, now under the $0.99 price.
- Fix 2 (hair): the edit prompt replaces the hair under the hood with the child's hair; the checker counts hair in likeness.
- Fix 3 (speed): faster low-fidelity pages, backup request at 18 s, no redraw that would end after 52 s. Red went from 56 s to 32 s.
- Fix 4: the Account page no longer claims the bible and scenes cost "$0.00"; it says they weren't tracked.

Evidence:
- Site opened signed-out in 0.28 s.
- Both new PDFs: 22 pages (cover + 20 + About Me), same layout on the same page numbers; no text over any face or must-see detail on any page; text typeset (pdf.js extracts p.5 word for word).
- Progress bar named every stage; thumbnails appeared one at a time with "try N of 3"; Red pages 2, 3 and 20 show "✓ try 2 of 3".
- Sign out → sign in: balance kept, all 8 PDFs on the account download (200, %PDF).
- 400 px: New book and the finished-book page both fit (scrollWidth 400); try counts visible.

Deductions:
- PDF −2: Little Red's hair is better but still chin-length under the hood on most pages (pp. 1, 4, 5, 8), while the portrait and p.16 show short hair.

Fix first:
1. The Account page's headline average ($1.41) mixes in the two books made before the cost fix; the current cost is $0.53. Show the average for books made with the current settings, so the cost-vs-price comparison is true (Money, misleading; 0 points but it's the number a reader trusts).
2. Little Red's hair under the hood still runs longer than the child's (PDF, −2) → draw the stand-in Red with short hair tucked into the hood, so the edit has less to change.
3. 12 of 14 full-page slots still put the text under the picture; redraw those scenes with real empty sky or floor for the caption.
4. Three Red pages needed a second try for likeness → test whether a higher-quality hero portrait cuts redraws (time and cost).
5. Page numbers on the paper pages are very small → larger.

