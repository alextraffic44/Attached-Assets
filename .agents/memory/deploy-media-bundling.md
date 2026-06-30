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
each from GCS SDK (preferred) or `http://localhost:${PORT}${path}` (fallback), bundle the
bytes under a relative folder (e.g. `assets/` for deploy, `images/` for ZIP), and rewrite
every reference across every page to the bundled relative path. De-duplicate output filenames.

**Why:** A previous version only bundled `.glb/.gltf` 3D models, so user-uploaded
images/video/audio (stored in object storage and served at `/objects/...`) broke on
deploy. The fix is ONE unified bundler covering all media types.

**Four regexes in bundler (routes.ts ~4194):**
1. `src|href|poster` attrs with relative `/objects/` or `/uploads/` paths
2. CSS `url(...)` with relative paths
3. Bare relative URL ending in known media extension — catches frame URLs in `data-frames='[...]'` JSON arrays
4. Absolute same-origin URLs (`https://craft-ai.ru/objects/...`) — catches cases where AI or Kling
   pipeline embeds the full domain URL; these are mapped back to the relative path for GCS lookup,
   then BOTH the absolute form and the relative form are rewritten in the HTML.

**GCS → localhost fallback:** If GCS SDK `getObjectEntityFile` throws, the bundler falls
back to a localhost fetch (with 15s timeout). Ensures dev-env publishes still work.

**Logging:** Each publish now logs "Found N local media URLs" and "Bundled M/N media files"
so you can diagnose 0-download situations without guessing.

**How to apply:** Any new media kind added to the chat-attach flow is automatically
covered as long as it ends up referenced via `/objects/` or `/uploads/`. Any NEW custom
data attribute or JS-embedded URL that doesn't end in a recognized extension must be
added to one of the four regexes explicitly.

**Rewrite order:** Rewrite absolute same-origin URLs FIRST (longer strings), then relative
paths — avoids partial-replacement where absolute URL contains the relative path as suffix.

## Extension MUST match real bytes (Netlify Content-Type)

Netlify serves `Content-Type` purely from the file extension. If the extension lies about the
bytes, strict browsers refuse to render the image (this was the real root cause of "broken
images on published sites"). Nano Banana returns PNG bytes even when our code asked for jpeg
and saved a `.jpg` name.

**Rule:** Detect the real format from magic bytes (PNG 89 50 4E 47 / JPEG FF D8 FF / WebP
RIFF…WEBP / GIF 47 49 46) in TWO places: (1) `uploadToObjectStorage` overrides the
passed mimeType/ext; (2) the deploy bundler ALWAYS forces the bundled asset's extension to
the detected format before writing — never trust the source URL's extension. The mediaMap key
stays the original `/objects/...` URL, value becomes `assets/<corrected-ext>`, so HTML rewrites
stay consistent.

## Publish-time compression

`compressImageForPublish(buffer)` (raster-only `/\.(jpe?g|png|webp)$/i`, never grows the file,
dynamic `import("sharp")`) → ≤300KB (mozjpeg q86→55 opaque, WebP q86→50 alpha, resize max 1920px
fit:inside, last-resort 1280px q72). Real test: 3.8MB PNG → 184KB.

**Gate:** `isRaster && !frameUrls.has(url)` → compress; animation frames and `.gif` are skipped.
`frameUrls` is a Set parsed from `data-frames='...'` JSON arrays.

**Animation frames are NOT compressed — user decision, see `russia-cdn-throttling.md`.** A frame
compressor (`compressFrameForPublish`, 1280px + mozjpeg q72) was tried to shrink heavy interactive
deploys, but the user found the quality loss too visible and asked to keep frames fully lossless;
frame extraction is back to `-q:v 1` full-res. The load-without-VPN win for product-heavy sites
comes mostly from compressing the non-frame product photos here, not the frames. Do NOT re-add
frame compression without asking. `.gif` is also never compressed (Sharp flattens animation to one
frame). Because compression can change format (png→webp / png→jpg), the extension-forcing step
above keeps the bundle valid afterwards.
