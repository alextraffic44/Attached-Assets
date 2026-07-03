---
name: Server-resolved generated-media markers (GENIMG / SCROLLANIM)
description: Generated sites must use server-resolved local media, never external stock URLs; covers the shared marker-resolution + billing pattern.
---

# On-theme media in generated sites (marker-resolution pattern)

Generated sites must NOT reference external stock image URLs (Picsum, Unsplash, etc.).
Instead the LLM emits prompt markers, and the server resolves each one: generate the asset,
store it in object storage, and replace the marker with the resulting local `/objects/...`
URL. This pattern is shared by `{{GENIMG:...}}` (AI photos) and `{{SCROLLANIM:...}}`
(Интерактивный mode — KIE video → ffmpeg frames → Canvas scroll animation); any future
generated-media marker should mirror it (resolver runs in the same post-pass).

**Why:** External stock URLs are off-theme/random AND aren't bundled by the deploy/ZIP
media bundler (see deploy-media-bundling.md), so published sites showed no photos. Only
local `/objects/` images both render in preview and survive publish/ZIP; Picsum is also
geo-unreliable in RU. Markers let the model pick visual intent while the server controls
generation, storage, deployability, cap, billing, and fallback.

**How to apply:**
- The marker-resolution post-pass MUST run AFTER final-code assembly but BEFORE any DB
  write (version snapshot, project update, file upsert), operating on an in-memory map of
  all page files, so preview, version history, deploy, and ZIP all ship baked-in URLs.
- Replace markers with a regex callback so NONE can survive unreplaced — any
  unmatched/over-cap/failed marker falls back to a deterministic gradient SVG data URI,
  never an external URL.
- Bill per generated asset with a per-request idempotency key (so retries of the same
  request don't double-charge, but a genuinely new request bills fresh); refund on
  generation failure. Once a worker has cleared the credit gate it MUST finish generating
  (and refund on failure) — never let a shared "out of credits" flag make it write a
  fallback after a successful charge. Report the post-generation balance from a fresh
  user read, not by arithmetic on a pre-image-phase balance.
- REFUND-ONLY-IF-BILLED invariant: `deductCredits` returns `{success, alreadyProcessed}`.
  An idempotent replay returns `success:true` with `alreadyProcessed:true` and charges
  NOTHING. So always compute `const billed = !deduction.alreadyProcessed`, refund only when
  `billed`, and report `creditsUsed: billed ? COST : 0`. Refunding/counting on a replay
  mints credits. (Both the SCROLLANIM marker resolver and `/api/generate-scroll-assets`
  follow this; the standalone endpoint had this exact bug and was fixed.)
- The generate endpoint must enforce project ownership — auto image-gen spends credits.
- SCROLLANIM with an uploaded product photo (Интерактивный mode): NEVER feed the raw user
  photo straight to the Kling image-to-video model — the busy original background leaks into
  the video. First regenerate the product onto a COMPLETELY SOLID single-color background
  (product on the RIGHT for "split" layout, centered for "parallax") and use that still as
  Kling's source. Reference-image regeneration must use `gpt-image-2-image-to-image`
  (`input.input_urls` array) — the dedicated KIE image-to-image model. NOTE: `nano-banana-2`
  with `image_url` and `gpt-image-2-text-to-image` both IGNORE the reference for this and
  invent a random product (a hair-wax photo came back as a gin bottle), so never use them here.
  On regen failure, leave the reference still undefined so the pipeline falls back to a
  text-to-image still — which still yields a solid background (the hard requirement).
  **Why:** users explicitly require a monochrome video background regardless of their photo.
- Ordering invariant: any external paid API call (e.g. the product-still regeneration) MUST
  happen AFTER the credit deduction succeeds, not before — otherwise a user with no balance
  can still trigger paid upstream work. Gate the spend on `deductCredits(...).success`.
- MARKER-ROBUSTNESS invariant: SCROLLANIM is detected by EXACT-string `{{SCROLLANIM:` in
  several places (the `includes()` gate, the pending-replace regex, the auto-inject gate, and
  the resolver's RE). LLMs deviate (`{{ SCROLLANIM :`, wrong case, markdown-fence/backtick
  wrapping) → all strict checks miss it → animation silently skipped AND the raw marker leaks
  to the visitor. So normalize the model output ONCE right after final-code assembly (before
  any detection): canonicalize the opener `/\{\{\s*SCROLLANIM\s*:/gi → {{SCROLLANIM:`, then
  unwrap backticks ONLY when anchored to a full `{{SCROLLANIM:...}}` (both sides) so unrelated
  `SCROLLANIM:` text in scripts is never mutated. **Why:** exact-match detection is brittle to
  normal LLM variance; first-attempt animation was failing on malformed markers.
- "BROKEN IMAGES" ON A GENERATED SITE IS USUALLY NOT A PUBLISH/LOADING BUG. Verify first: real
  `/objects/` photos that 404 or are corrupt = publish bug; but if all photos load (HTTP 200,
  valid JPEG) the "битые картинки" are almost always MIXED GRIDS — the prompt let the model put
  real {{GENIMG}} photos in some cards of a grid and CSS-drawn art (e.g. `div.css-donut`) or flat
  gradient SVG placeholders in the others. Next to photoreal images those look broken. Fixes:
  (a) prompt GRID-CONSISTENCY rule — every card in a menu/product/gallery grid uses the SAME image
  treatment (all {{GENIMG}} or none, never mixed); (b) forbid CSS-drawn objects/products as photo
  substitutes; (c) the prompt's stated GENIMG limit MUST equal the code cap `MAX_AUTO_IMAGES`
  (resolver does `entries.slice(0, MAX_AUTO_IMAGES)`; any marker past the cap silently becomes a
  gradient placeholder → reintroduces mixed grids). **Why:** capping real images at 6 + "use CSS
  gradients/inline SVG for the rest" was the prompt rule that produced half-photo/half-CSS donut menus.
- AUTO-IMAGE CONCURRENCY ≠ MAX_AUTO_IMAGES. The worker pool size must be capped separately
  (`MAX_AUTO_IMAGE_CONCURRENCY`, ~6) regardless of how high MAX_AUTO_IMAGES goes. Spawning one
  worker per marker (`Promise.all` over `batch.length`) fires N simultaneous KIE requests; >~6
  spikes 429s, and a failed image falls back to a gradient placeholder = mixed grid again. Raising
  the per-site image budget is safe ONLY with a fixed concurrency cap (12 images resolve in ~2 waves
  under the 420s phase deadline). Token cost note: max auto-image cost scales with the cap (12×15=180).
- KLING CLIP DURATION: `kling/v3-turbo-image-to-video` accepts a `duration` (seconds, passed as a
  STRING) in the range 3–15. The Интерактивный modes pick per-mode lengths: parallax/split use 5s,
  the "Экшн"/action (Hollywood-blockbuster) mode uses 10s with proportionally more sliced frames
  (ffmpeg fps = round(targetFrameCount / videoDuration)). **Why:** "longer = more frames to scrub"
  is only safe because the model documents 3–15s; do NOT exceed 15.
- RESOLVER-FINALIZE invariant: `resolveScrollAnimMarkers` MUST always reach `finalize()` (which
  replaces every remaining marker with the static fallback). Wrap the per-block body — including
  `deductCredits` and the unprotected helper awaits (product still / creative concept / vision /
  frames) — in try/catch and `continue`, refunding billed credits on throw. A single helper
  throw must NOT abort the whole function: that skips finalize() (raw marker can survive),
  strands the 2nd block, and leaks the charge. Per-block isolation = "animation always resolves".
- GENIMG REF-INDEX convention (added for "Профессионал"/multi-reference-image mode): a marker
  can carry a 3rd pipe segment, `{{GENIMG:prompt|ratio|REF<n>}}` (or `REF<n>,<m>`), where `<n>` is
  the 1-based index into the reference images the user uploaded for this generation (same order
  as upload / same order as the `reference_photos` array from mockup analysis). The resolver looks
  up `referenceImageUrls[n-1]` and passes it as `refUrls` to `generateGptImage`, which then calls
  KIE's `gpt-image-2-image-to-image` (`input_urls`) instead of the text-to-image model — this is
  how a generated site photo can preserve a REAL uploaded product/brand/person instead of the AI
  inventing one from scratch. Markers with no REF segment behave exactly as before (text-to-image).
  **Why:** generalizes the "Интерактивный" mode's dedicated `generateProductStill` image-to-image
  pattern into the shared GENIMG marker system, so any generation flow (not just scroll-anim) can
  opt a specific photo into image-to-image by referencing an uploaded image's index.
