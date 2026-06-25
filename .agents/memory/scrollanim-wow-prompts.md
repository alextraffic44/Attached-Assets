---
name: SCROLLANIM / GENIMG "wow" prompt philosophy
description: How the Craft AI still/motion/image prompts must be worded so first-try output looks cinematic, not dull — and the invariants that bound those words.
---

# Why output looked "уныло" (dull) and how the prompts must be worded

**Root cause of dull results (diagnosed once, keep in mind):**
- Stills were forced to flat white-studio / even lighting → no atmosphere.
- Every motion prompt said "imperceptible / ultra-slow / barely" → because the scroll
  animation is *scrubbed frame-by-frame* (≈90 WebP frames bound to scroll), imperceptible
  motion makes the whole section read as a frozen static image. Visible, evolving motion is
  REQUIRED, not optional.
- No camera movement at all + timid system-prompt examples.

**The rule:** every still/motion/image prompt source must demand
(1) clearly VISIBLE motion that evolves across the 5s, plus
(2) a slow cinematic camera PUSH-IN (push-in only — never pan/tilt/pull-back/edge-reveal,
those break the looped scrub and the solid background), plus
(3) cinematic lighting/color grade instead of flat studio.

**Why push-in only:** pan/tilt/pull-back reveal frame edges and change the background,
which collides with the "solid uniform background" invariant and looks broken when scrubbed.

# Invariants these words must NOT break (string-only changes are safe *because* they respect these)
- **Split layout:** product on the RIGHT third, entire LEFT half a perfectly flat uniform
  single matte color (text area). Keep ALL effects + any glow on the right; push-in gentle
  ~5-8%. Concentrate lighting around the product so the left half never gets a gradient/glow
  (the image model can read "brightness falloff" as a gradient — scope it to the product).
- **Marker delimiters:** never put `|`, `::`, or `}}` inside SCROLLANIM VIDEO_PROMPT examples
  (only commas) or the marker parser mis-splits.
- **GENIMG quality boost:** apply the booster ONLY at the `generateGptImage(...)` call site.
  The ORIGINAL parsed marker prompt must stay the dedupe/cache key and the library name.
  Booster is additive quality only — do NOT add "no text/no logo": the system prompt
  intentionally allows text inside generated images.
- Prompt/string-only edits do not touch billing, idempotency, refunds, retries, or fallbacks.

# Helpers involved (server/routes.ts), so future-me knows where the wording lives
`generateStillForVideo`, `generateProductStill`, `generateCreativeConcept`,
`generateMotionPromptFromStill`, `generateScrollFrames` (animPrompt suffix), the interactive
SYSTEM_PROMPT split + parallax SCROLLANIM blocks, and `withImageQualityBooster` for GENIMG.
