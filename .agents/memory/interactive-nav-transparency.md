---
name: Interactive-site header transparency over scroll animation
description: How the fixed nav stays transparent during the 3D-scroll animation and turns colored only after it's scrolled past.
---

# Interactive-site header transparency

For "Интерактивный" (3D Sexy Scroll) generated sites the fixed top `<header>` must be FULLY
transparent (no bg/blur/border/shadow) while the scroll animation is on screen, and only become
colored/solid once the animation is fully scrolled past. A glassmorphism bar over the animation
"ruins the effect" (explicit user complaint).

**Mechanism (in `buildScrollAnimHtml`, `server/routes.ts`):** a guarded global `navCtl` block
(`window.__craftNavCtl`) is appended to BOTH parallax and split return strings. It injects:
- CSS that FORCES transparency deterministically: `body:not(.craft-anim-passed) header{background/backdrop-filter/border/box-shadow ... !important}` plus a transition on `header`.
- JS that toggles `craft-anim-passed` on `<body>` once every animation section (matched by the
  dedicated attribute `data-craft-scrollanim`, NOT the generic `data-frames`) has scrolled above the
  header (threshold = live `header.offsetHeight`, fallback 64).

**Why this is robust:** the `!important` transparency is enforced server-side, so it works even if
the generated CSS hardcodes an opaque header or ignores the prompt. Whatever colored header styles
the model writes simply take over once `craft-anim-passed` is set (the `:not()` override stops
applying). The interactive-mode system prompt also instructs the model to keep the base header
transparent and style the colored state via `body.craft-anim-passed header`.

**How to apply:** only affects NEW generations — already-generated sites keep their baked-in header.
Keep the injected script as plain browser JS (see injected-browser-scripts.md). If adding more
scroll-anim layouts, append `navCtl` and put `data-craft-scrollanim` on the section.
