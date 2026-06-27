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
fullscreen guard on fallback selectors and keep a hard timeout as the last resort.

**Reveal timing (user requirement):** preloader self-hides at a FIXED 5s — no early
reveal. The generated site itself carries a `setTimeout(hide,5000)` script (both
master prompts emit it; anim prompt previously forbade model hide-JS, now reversed),
and `injectLoadingOverlay`'s backstop is also a single fixed `setTimeout(hide,5000)`.
The earlier `craft:anim-ready` / `load`+delay early-hide triggers were intentionally
dropped. `craft:anim-ready` is still dispatched by scroll-anim scripts but now unused
by hiding. **Why:** user wants the full 5s so all content loads before reveal.
**Tradeoff:** on slow CDN/clients frame-0 may not be decoded by 5s → brief blank hero;
accepted per explicit user request. If revisited, add an in-section frame-0 placeholder
rather than re-introducing early fullscreen-blocker reveal.
Master prompts also enforce exactly one `#site-preloader`, no second intro/splash overlay.
