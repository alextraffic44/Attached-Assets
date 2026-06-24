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
