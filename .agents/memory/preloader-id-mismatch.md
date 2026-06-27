---
name: Preloader stuck on id mismatch
description: Why an AI-authored splash never hides, and how the hide net is made robust.
---

# Stuck preloader from id / overlay mismatch

The auto-injected preloader-hide script (`injectLoadingOverlay` in `server/routes.ts`)
originally keyed strictly on `id="site-preloader"`. The model sometimes names its
splash differently (`#preloader`, `.loader`, a separate intro/splash overlay), so
the strict lookup matched nothing — not even the hard cap fired — and the splash
covered the site forever (observed: S.PELLEGRINO splash stuck).

**Rule:** the hide path must never depend solely on one exact id.
- Trust canonical `#site-preloader` directly.
- Fall back to a querySelector over common preloader selectors, BUT only accept a
  candidate that is an actual fullscreen overlay (position fixed/absolute AND
  covers ≥90% of viewport) — generic `#loader`/`.preloader` can be small nested
  spinners; hiding those would be wrong and could even touch the scroll-anim canvas.
- Keep three independent triggers: `craft:anim-ready`, `load`+delay, hard cap.

**Why:** prompt-only enforcement is fragile (LLM deviates), so the runtime net must
catch deviations; the fullscreen guard prevents the broad selectors from removing
unrelated elements.

**How to apply:** any change to preloader detection/hiding must preserve the
fullscreen guard on fallback selectors and keep the hard cap as the last resort.
Hard cap is 5s (user requirement: animation-site preloaders reveal within ~5s).
Master prompts (anim + regular) also enforce exactly one `#site-preloader`, no
second intro/splash overlay, ~5s cycle, and no model-authored hide JS.
