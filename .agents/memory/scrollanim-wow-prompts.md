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
(2) cinematic camera movement (layout-aware, see below), plus
(3) cinematic lighting/color grade instead of flat studio.

# Background policy: ANY full scene is allowed (NOT forced solid) — readability is engineered, not by emptiness
- The hard requirement is ONLY that overlaid text stays readable; the background can be a full
  immersive Hollywood scene/environment for any niche (real estate: camera flies toward villa,
  doors open; cream: butterfly lands; jewelry/auto/restaurant/etc.).
- Readability is protected by the OVERLAY, not by keeping the bg empty:
  - **Parallax** (`buildScrollAnimHtml`): white text + blurred dark radial scrim (`.text::before`)
    + edge vignette (`.veil`) + text-shadow → legible on ANY scene. Safe to go fully immersive.
  - **Split**: dark text on LEFT 52% panel. It had NO scrim and relied on a clean light left —
    now it has a soft left→right LIGHT gradient scrim on `.panel` as insurance, so the right side
    (and product bg) can be richer/darker without breaking the dark left text.
- **Camera (layout-aware in `generateScrollFrames` animPrompt):** parallax = BOLD immersive
  forward dolly/push-in that pulls the viewer INTO the scene and reveals depth (toward a doorway,
  through the space); split = GENTLE push-in only (no pan/tilt/pull-back/edge-reveal) to protect
  product fidelity + the calm left text zone. Forward reveal is FINE on real scenes (the old
  "no edge reveal" ban was a solid-background concern, now relaxed for parallax only).
- **`generateProductStill` / `generateCreativeConcept` / `generateMotionPromptFromStill`** no longer
  force a flat single-color bg — they allow "a clean dramatic backdrop OR a tasteful softly-out-of-focus
  contextual environment", product = untouchable faithful hero, LEFT half kept calmer/softer for text.
  Keep these three HARMONIZED — if one still says "solid background" it contradicts the others.

# Invariants these words must NOT break (string-only changes are safe *because* they respect these)
- **Split layout:** product on the RIGHT third; keep the LEFT half calmer/softer/uncluttered (NOT
  necessarily flat-color anymore — the panel scrim covers readability). Keep ALL effects + glow on
  the right; push-in gentle ~5-8%.
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
