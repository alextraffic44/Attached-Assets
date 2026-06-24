---
name: Deploy media bundling (Netlify)
description: Locally-hosted media must be downloaded and bundled into the deploy package or it 404s on the static host.
---

# Deploy media bundling

When publishing a generated site to a static host (Netlify), any media the generated
HTML references via app-relative paths (`/objects/...`, `/uploads/...`) will 404 on the
deployed site, because those paths only resolve on the Replit app server, not on the
static host.

**Rule:** Before deploying (and when building the ZIP export), scan ALL HTML pages for
local media references — in `src`, `href`, `poster` attributes AND CSS `url(...)` — fetch
each from `http://localhost:${PORT}${path}`, bundle the bytes under a relative folder
(e.g. `assets/` for deploy, `images/` for ZIP), and rewrite every reference across every
page to the bundled relative path. De-duplicate output filenames.

**Why:** A previous version only bundled `.glb/.gltf` 3D models, so user-uploaded
images/video/audio (stored in object storage and served at `/objects/...`) broke on
deploy. The fix is ONE unified bundler covering all media types, not per-type blocks.

**How to apply:** Any new media kind added to the chat-attach flow is automatically
covered as long as it ends up referenced via `/objects/` or `/uploads/`. The scan now has
THREE regexes: `src|href|poster` attrs, CSS `url(...)`, AND a bare-URL regex matching any
`/objects//uploads/` path ending in a known media extension — the last one is what catches
frame URLs embedded in non-standard places like the scroll-animation `data-frames='[...]'`
JSON array. Any NEW way of embedding a media URL (custom data-attr, inline JS string, JSON
blob) must end in a recognized extension or it won't be bundled — verify after adding it.
Absolute same-origin URLs (e.g. `https://craft-ai.ru/objects/...`) are still NOT bundled —
add them to the scan regex if a path can produce absolute URLs.
