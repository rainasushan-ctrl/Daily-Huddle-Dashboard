# CARS24 Ops Dashboard

Single-file static dashboard (Inspections · Tokens · Stock In) with CSV/Excel upload,
date + D-1/LMTD/Absolute views, region map and AI root-cause analysis.

## Deploy on Vercel

This is a **static site** — no build step.

1. Push this folder to a GitHub repo.
2. In Vercel → **Add New → Project** → import the repo.
3. Settings that matter:
   - **Framework Preset:** Other
   - **Build Command:** *(leave empty)*
   - **Output Directory:** *(leave empty)*
   - **Root Directory:** `./` (the folder containing `index.html`)
4. Deploy. The site is served from `index.html` at the root URL.

`vercel.json` already sets clean URLs and routes everything to `index.html`.

## Run locally

```
npx serve .
```
Then open the printed URL.
