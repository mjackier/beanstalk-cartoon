## storybook-review result
Total: **87 / 100**

Graded with our own `storybook-review` skill (no official one was posted), on November 8, 2026.

The skill was run against the live site (https://beanstalk.jackier.xyz) and the PDFs of four real books:
- Mattan's own Jack book: 52.3 s
- an admin Jack test book after the first fixes: 59.8 s
- the final Jack book: 43.6 s
- a final Little Red Riding Hood book: 44.6 s

Every page of the final Jack PDF was rendered and looked at.

| Section | Score | Evidence |
|---|---|---|
| 1 Book completeness | 10/10 | Cover + 20 story pages + About Me (22 PDF pages). Both stories are complete, from beginning to end (Jack: beans → beanstalk → giant → hen → chop → happy ending). Quotation marks on dialogue, page numbers on every story page. |
| 2 Hero likeness and consistency | 17/20 | Same glasses, curls and smile on all 20 pages; same age and build on every page because every scene starts from one stand-in Jack. Deductions: the hero is always drawn as a child about 8, so an adult's photo comes out younger by design; the Red book needed 4 likeness redraws (pages 5, 15, 16, 18). |
| 3 Template and character bible | 9/10 | One 20-slot template drives both books: the same layouts appear on the same page numbers. 14 bible characters with images are stored in the `characters` table, and the cow, old man, giant, hen and mother match on every page. Deduction: page 5's close-up crops Milky-White. |
| 4 Text never hides the story | 13/15 | Final Jack book: no text touches any face or character on any page. Placement is decided in code: each full-page scene's caption spot is drawn as a red box and verified by a vision model, and every book re-checks it; if anything overlaps, the text goes under the picture. Deductions: the check is so strict that 12 of 14 full-bleed slots fall back to text-under-picture, so the layouts repeat; the page numbers on paper pages are very small. |
| 5 Picture quality | 8/10 | No stray letters, no distorted hands. Story mistakes found in Mattan's first book were fixed (pages 3, 7, 9, 13, 17, 19, 20). Deductions: page 5 is crowded (three heads, cow cut off); the hen reads a little like a rooster. |
| 6 Speed and progress | 8/10 | Page load 0.5 s (first byte 0.2 s, app.js 12 KB gzipped). Books: 43.6 s and 44.6 s finally, but 59.8 s and 52.3 s earlier. The progress bar names each of 5 stages, and each page's thumbnail appears as soon as it passes its check. Deduction: too little margin under 60 s when several pages need redrawing. |
| 7 Quality loop | 5/5 | Every image is checked (gpt-4.1-mini per book, gpt-4.1 for scenes and the bible). Logged per page: attempts, pass/fail and reasons, at most 3 generations, best-ranked kept. Safety-filter refusals don't use up an attempt. |
| 8 Persistence | 4/5 | Portrait, 20 pages and the PDF are stored in Postgres, and the PDFs download again in a later session (document 3 re-downloaded for this review). Deduction: not re-tested with an explicit sign-out and a second Google account during this review. |
| 9 Money (Stripe sandbox) | 9/10 | Tested live: $5.00 added with Stripe Checkout (test card), $0.99 charged for the book, refund requested and processed by Stripe; every entry is in History with its cause and the balance after. Deduction: the first version pre-filled the whole balance and refunded it in one click (fixed: empty amount + confirm step). |
| 10 UI, security, hand-in | 4/5 | Clean three-page app (My books, New book, Account). `git grep` finds no keys in any commit; `.env` is ignored, and a pre-commit hook blocks keys. Deduction: links still to be checked in a private window after the merge to `main`. |

### Fix first
1. **Full-page pictures almost never keep their text on the picture:** 12 of 14 full-bleed slots → redraw those scenes with a genuinely empty band of sky, floor or grass where the caption goes, so the template's layouts actually vary.
2. **Speed margin:** worst run 59.8 s → start the backup image request sooner (18 s instead of 24 s) and skip a redraw earlier when time is short.
3. **Likeness on Little Red:** 4 redraws → give the hero swap a closer reference crop of the face, or a higher quality for those pages.
4. **Page 5 (the trade):** crowded close-up, cow cut off → redraw as a wider medium shot.
5. **Page numbers on paper pages are tiny** → make them larger and darker.

### What's working
- The child is recognisable and consistent across all 20 pages.
- Both stories are complete, the cast is consistent, and the mistakes found in review were fixed.
- No text covers a face anywhere: the placement is verified by looking, not guessed.
- Under a minute end to end, with live stage names and thumbnails.
- The full Stripe test-mode loop works, with an honest history.
