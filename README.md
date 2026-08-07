# For my baby ♡

A flower-per-month photo book. Static site on GitHub Pages; the repo itself is the
database. Photos are committed as files under `photos/`, everything else lives in
`book.json`.

No server, no SQL, no build step, no credit card.

## How it works

- **You** open the site with an edit token → drop photos, write captions. Each change
  is committed to this repo through the GitHub Contents API.
- **Anyone else** opens the plain link → sees the finished book, read-only. No token,
  no edit controls, no editable fields.

The gate is one line in `image-slot.js`: it only shows its editing UI when
`window.omelette.writeFile` exists, and `host.js` only defines that when a token is
present.

## Setup

**1. Create a *public* repo** and push these files to it.

GitHub Pages is free only on public repos. See the privacy note below.

**2. Point `config.js` at it**

```js
window.BOOK_CONFIG = { owner: 'your-username', repo: 'your-repo', branch: 'main' };
```

**3. Turn on Pages** — repo Settings → Pages → Source: `main`, folder `/ (root)`.

Your site: `https://<username>.github.io/<repo>/`

**4. Make an edit token**

github.com → Settings → Developer settings → Personal access tokens → **Fine-grained
tokens** → Generate new token:

- Repository access: **Only select repositories** → this one
- Permissions: **Contents → Read and write** (nothing else)
- Set an expiry you're happy with; you'll need to regenerate after it lapses

**5. Unlock editing** — visit once with the token on the end of the URL:

```
https://<username>.github.io/<repo>/#key=github_pat_xxxxxxxx
```

It's saved to `localStorage` and stripped from the address bar immediately. From then
on the plain URL is editable **on that browser**. A green "edit mode" pill top-right
confirms it.

To hand off a read-only link, just send the plain URL — **without** the `#key=` part.

To revoke on a device: `localStorage.removeItem('gh-edit-token')` in the console.

## Read this before uploading photos

**The repo is public, so the photos are public.** Anyone who finds the repo can browse
`photos/`. Search engines can index them. Deleting a photo later does *not* remove it
from git history.

That's the trade for free hosting. If these photos shouldn't be on the open internet,
options are a private repo with GitHub Pro (~$4/mo), or Cloudflare R2 with unguessable
URLs (free tier, but wants a card on file).

## Notes

- Photos are downscaled in the browser to 1200px WebP (~150–300KB) before upload, so
  you'd need thousands before repo size matters.
- Every photo is one commit. Pages rebuilds take ~30–60s, but images are read straight
  from `raw.githubusercontent.com`, so they appear on reload without waiting.
- React is vendored in `vendor/` rather than loaded from a CDN — nothing external can
  take the site down.
- Don't edit from two devices at once. Last write wins on `book.json`.

## Local development

```bash
python -m http.server 8420
```

Then open `http://127.0.0.1:8420/`. Editing locally still commits to the real repo if a
token is set.

## Files

| File | Purpose |
|---|---|
| `index.html` | The page — layout and all flower/month data |
| `host.js` | GitHub storage: uploads, `book.json`, the edit gate |
| `config.js` | Repo coordinates + React vendoring map. No secrets |
| `image-slot.js` | Drop / crop / zoom photo component (unmodified) |
| `support.js` | Template runtime (unmodified) |
| `book.json` | Captions, dates, locations, slide order, custom months |
| `.image-slots.state.json` | Which photo is in which slot, plus crop framing |
