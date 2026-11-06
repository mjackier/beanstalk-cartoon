# Beanstalk Storybook

A 20-page picture book starring your child, as a PDF, in under a minute.
Two stories, **Jack and the Beanstalk** and **Little Red Riding Hood**, share one 20-page template.
Live: https://beanstalk.jackier.xyz

## How a book is made

```
once (admin page)                         per book (about 30–50 s after "Make the book")
-----------------                         ---------------------------------------------
character bible (DB)                      photo -> cartoon portrait of the child (starts while the
  one reference image per character         form is still being filled in; checked, up to 3 tries)
        |                                 $0.99 charged from the balance
        v                                 all 20 pages at the same time:
40 scenes (DB), 20 per story,               scene + portrait -> image edit puts the child into the scene
  drawn from the bible images with          -> vision check -> redraw with the problems listed (max 3)
  a stand-in hero, each checked               -> still failing after 3? keep the best-scoring one
                                          text placed only where nothing important is (see below)
                                          PDF built on the server, stored in the DB
```

- **Template** (`book/template.js`): 20 slots, each with a layout (`full`, `band`, `split-L`, `split-R`, `vignette`), where the art sits, where text may go, and the camera shot. Both stories fill the same 20 slots, so pacing and quality stay the same across stories.
- **Stories** (`book/stories.js`): text, scene, what the hero does, which bible characters appear, and the must-see details of every page. Pronouns follow the child (`{he}` / `{his}`).
- **Character bible** (`characters` table): name, description and a reference image for every character. Scenes are drawn *from those images*, so the cow, the giant or the wolf look the same on every page.
- **Scenes** (`scenes` table): pre-generated once per story, so a book only needs one edit per page instead of drawing the whole page from nothing.

## Text never hides the story

This is decided by geometry in `book/layout.js`, not left to the image model:

1. The vision check returns boxes for every face, every character and each must-see detail of the page.
2. Most template layouts (`band`, `split`, `vignette`) put the text **off the picture**, so nothing can be covered.
3. On full-bleed pages, the text panel is measured for the real text, then tried at top, bottom and middle, centred, left and right, wide and narrow. The first panel that touches no padded box is used. Faces get the widest safety margin.
4. If no panel is clear, that page switches to the `band` layout: the picture shrinks and the text goes underneath.

## Quality loop

`book/check.js` sends each generated image, with the child's portrait, to a vision model. It answers in a fixed JSON schema:
- whether the hero is there, the face is visible and the hero appears only once
- likeness from 0 to 10
- whether the head looks pasted on
- whether the anatomy is OK and whether any text is drawn in the image
- missing must-see details, a score from 0 to 10, and the boxes

`verdict()` turns that into pass/fail with plain rules. A failure is redrawn with its problems added to the prompt, up to **3 generations** in total. If all three fail, the best-ranked one is kept. A retry that would push the book past the 60-second budget is skipped, and the best attempt so far is kept.

## Speed

- Measured on this account: 20 image edits at once take ~14 s typically, 33 s for the slowest. A vision check takes ~3.5 s.
- Pages run in parallel. A slow image call gets an identical backup request after 24 s, and whichever finishes first wins.
- The portrait is drawn as soon as the photo is chosen, while the name and About Me are still being typed.
- The PDF is built on the server with vendored jsPDF in ~0.7 s and stored, so it can be downloaded again any time.
- The page loads fast because there's no framework: one HTML, one CSS and one JS file, gzipped and cached, with fonts loading without blocking.
- The progress bar names the stage ("Step 2 of 5: Putting Avi into all 20 pages · 12 of 20 done · 2 being redrawn"). Each page's thumbnail appears as soon as it passes.

## Money (Stripe sandbox)

- **Add funds:** Stripe Checkout in test mode (card `4242 4242 4242 4242`). Coming back, the server asks Stripe whether the session is paid, so the URL is never trusted, and credits it exactly once (`ledger.ref` is unique).
- **Balance:** `users.balance_cents`, changed only together with a `ledger` row, in one transaction with a row lock.
- **$0.99 per document:** charged when a book starts. If the book can't be finished, or the server restarts, it's refunded automatically.
- **Refunds:** the user requests a refund of unspent money from a payment; the money is reserved, then the refund is processed with `POST /v1/refunds` (idempotent). If Stripe declines, the money goes back to the balance.
- **History:** every credit and debit, with what caused it, the book it belongs to and the balance after.
- The server refuses to run payments with anything but an `sk_test_` key.

## Accounts and storage

Google sign-in (OAuth code flow, signed HttpOnly cookie) and Render Postgres. The database stores:
- users, books, the hero portrait and the 20 page images (with their check results)
- the PDFs, the bible, the scenes, the ledger, top-ups, refunds and an event log

Every query is scoped to the signed-in user. The uploaded photo is never stored.

## Files

| Path | What |
|---|---|
| `server.js` | All routes |
| `lib/http.js` | A ~200-line router on `node:http` (no Express) |
| `lib/store.js` | Postgres schema and every query |
| `lib/openai.js`, `lib/stripe.js` | API clients over `fetch` |
| `lib/auth.js`, `lib/session.js` | Google sign-in and session cookies |
| `lib/images.js` | JPEG thumbnails (vendored `jpeg-js`) |
| `book/` | Template, stories, prompts, check, layout, pipeline, PDF |
| `public/` | The app (`index.html`, `app.css`, `app.js`), privacy policy, survey page |
| `vendor/` | jsPDF, jpeg-js and the Gentium Book Plus font (OFL), so there's nothing to download at run time |

The only npm dependency is `pg`.

## Run locally

```bash
npm install
cp .env.example .env              # fill in your own keys; .env is git-ignored
git config core.hooksPath scripts/hooks   # blocks commits that contain a secret key
npm run dev                       # http://localhost:3000
```

Keys live only in `.env` locally and in Render's environment group in production.
