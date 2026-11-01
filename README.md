# Beanstalk Me

Two apps in one Express server:

- **`/`**: homework 1. Upload or take a photo, cartoonify it, and see yourself in two Jack and the Beanstalk scenes.
- **`/book.html`**: the storybook. Sign in with Google, make a book starring a child (pages 1–3 plus About Me), come back later and it's still there, download it as one PDF.

## Accounts, saving, logging (homework 3)

- **Sign in with Google** (`lib/auth.js`): standard OAuth 2.0 code flow with a `state` check, written with Node's built-in `fetch` (no auth library). The session is a signed, HttpOnly cookie (`lib/session.js`, HMAC-SHA256 with `SESSION_SECRET`), valid 30 days.
- **Database** (`lib/store.js`): Render Postgres. Tables: `users`, `books`, `images` (the Jack reference and each page, stored as JPEG), `events` (the activity log). Every query is scoped to the signed-in user, so nobody can see or fetch another user's book or images. Without `DATABASE_URL` it falls back to an in-memory store for local testing.
- **The uploaded photo is never stored**, only the cartoon made from it.
- **Logging** (`lib/log.js`): every API request is logged as one JSON line (method, path, status, ms, user id; never query strings or tokens), visible in Render's **Logs** tab. Generation, sign-in, book creation and PDF downloads are also saved in the `events` table and shown to each user under **Recent activity**.
- **Parallel generation with progress**: "Generate the whole book" draws Jack first (the pages need him), then sends every page request at the same time. Each image has its own progress bar; the overall bar counts finished images. The model doesn't report progress, so bars move on an estimate learned from earlier images and jump to 100% when the image arrives. A failed page doesn't stop the others.
- **Cheap testing**: `MOCK_IMAGES=1` skips OpenAI entirely; `OPENAI_IMAGE_QUALITY=low` keeps real tests cheap. Images are requested as JPEG (much smaller than PNG).

## How the storybook works

1. **One reference image.** The uploaded photo is turned into a single full-body image of the child as Jack, in his costume (`POST /api/book/character`).
2. **One style string.** Every call uses the same `STYLE` constant from `story.js`:
   *"Modern 3D animated feature film style: rounded forms, large expressive eyes, soft rim light."*
3. **One page = one call.** Each page sends the reference image plus that page's prompt (`POST /api/book/page`). No loops, no retries.
4. **Edit, don't regenerate.** "Edit this page" sends the existing page plus the reference to the image *edit* endpoint with a one-change instruction (`POST /api/book/fix`).
5. **Text is never drawn by the model.** The story text is drawn in the PDF layer (`public/book.js`, jsPDF) on each page's quiet area: lower third, top sky, or dark grass.
6. **PDF.** Full-bleed 3:2 pages in order, then About Me with the child's name and details. Downloaded as `JackAndTheBeanstalk.pdf`.

## Files

- `lib/auth.js`, `lib/session.js`, `lib/store.js`, `lib/log.js`: sign-in, sessions, database, logging.
- `story.js`: the style string, the fixed cast descriptions, the page list (text, scene, text area), and the prompt builders. **Edit prompts here.** To add page 4, fill it in and set `ready: true`.
- `server.js`: Express server and API routes. Reads the key from the environment only.
- `prompt.js`: prompts for the homework 1 two-scene app.
- `public/book.html`, `book.js`, `book.css`: the storybook UI and the PDF layer.
- `public/vendor/jspdf.umd.min.js`: jsPDF 2.5.1 (MIT), bundled so the app doesn't depend on a CDN.
- `to-do.md`: what still needs work.

## Environment variables

| Name | Purpose |
|---|---|
| `OPENAI_API_KEY` | Required. Never in code or in the repo. |
| `OPENAI_IMAGE_MODEL` | e.g. `gpt-image-1.5` (default `gpt-image-1-mini`) |
| `OPENAI_INPUT_FIDELITY` | `high` keeps faces closer to the reference (not supported by the mini model) |
| `OPENAI_IMAGE_QUALITY` | `low` / `medium` / `high` (default `low`) |
| `GENERATE_PASSWORD` | If set, generating images requires this password (checked on the server). Viewing the site stays open. Never put the password in code; this repo is public. |
| `DATABASE_URL` | Render Postgres **Internal Database URL**. Without it, data is kept in memory only. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From Google Cloud Console → Google Auth Platform → Clients (Web application). Redirect URI: `https://<site>/auth/google/callback` |
| `SESSION_SECRET` | Long random string that signs the login cookie. |
| `MOCK_IMAGES` | `1` = don't call OpenAI; echo the input image back. For testing the pipeline and PDF for free. |

## Run locally

```bash
npm install
cp .env.example .env      # put your real key in .env (git-ignored)
npm run dev
```

Open http://localhost:3000/book.html

## Deploy (Render)

Build: `npm install` · Start: `npm start` · Set the variables above under **Environment**.
