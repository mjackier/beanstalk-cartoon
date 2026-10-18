# Beanstalk Me

Upload a photo, cartoonify it with adjustable settings, and see yourself in two scenes from *Jack and the Beanstalk*:

1. Jack is planting the seeds.
2. Jack is climbing the beanstalk.

Each image is captioned with the exact scene specification sent to the model.

## Files

- `server.js`: Express server. Reads the API key from the environment and makes exactly one image API call per button click.
- `prompt.js`: all prompt text (scene descriptions, style settings). Iterate on the prompt here.
- `public/`: the web page (HTML, CSS, JS).

## Run locally

```bash
npm install
cp .env.example .env      # then paste your real key into .env
npm run dev
```

Open http://localhost:3000.

## Deploy to Render

1. Push this folder to a GitHub repo (`.env` is git-ignored, so the key stays out).
2. On Render: **New → Web Service**, connect the repo.
3. Build command: `npm install` · Start command: `npm start`
4. Under **Environment**, add `OPENAI_API_KEY` with your key.
   Optional: `OPENAI_IMAGE_MODEL` and `OPENAI_IMAGE_QUALITY`.
5. Deploy and submit the live URL.

## Testing checklist

Try several different people's photos. For each one, check:

- [ ] The face is recognizably the uploaded person.
- [ ] The picture shows what the caption says.

If either fails, edit `prompt.js` and try again.
