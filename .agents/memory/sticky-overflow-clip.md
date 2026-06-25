---
name: overflow:hidden breaks scroll-animation sticky
description: Why interactive 3D-scroll sites show only frame 0 (no animation on scroll), and the clip-not-hidden fix.
---

# `overflow-x: hidden` silently breaks the scroll animation

Symptom: an interactive ("Интерактивный" / 3D Sexy Scroll) site renders the hero (= the animation's
first frame + first text overlay) but **scrolling never advances the frames** — "анимации вообще нет
при скроле". The SCROLLANIM marker resolved fine and frames ARE in the saved code (check prod logs:
`[SCROLLANIM] produced N frames`), so the pipeline is NOT the problem.

**Root cause:** the scroll animation is driven by `position: sticky` on the canvas wrapper. Generated
CSS almost always puts `overflow-x: hidden` on `body` and/or a page wrapper (to kill horizontal
scrollbars). Per CSS spec, when one overflow axis is `hidden` (not visible/clip) and the other is
`visible`, the visible axis **computes to `auto`** → that ancestor becomes a scroll container →
`position: sticky` sticks to it instead of the viewport and effectively dies. The section then just
scrolls past as a static first frame.

**Fix:** convert ancestor `overflow-x/y: hidden` → `clip` at runtime. `clip` prevents horizontal
scroll WITHOUT creating a scroll container, so sticky works again.
**Why convert BOTH axes:** if both axes are `hidden`, converting only x→clip is useless — spec says a
`clip` paired with a non-visible/non-clip value computes BACK to `hidden`. You must set the other
axis to `clip` too. Converting a genuine `overflow-y:hidden` to `clip` is safe (clip still hard-clips;
only difference is it's not programmatically scrollable).

**How to apply:** runtime DOM walk from each `[data-craft-scrollanim]` section up through ancestors +
html/body, swapping computed `hidden`→`clip` inline. Injected in 3 paths so existing sites self-heal
without a costly regen: server `navCtl` (buildScrollAnimHtml, new gens), client `injectProjectId`
(editor preview), server publish `injectLeadsScript` (`data-craft-stickyfix`, guarded/idempotent).
Keep all injected bodies plain browser JS (see injected-browser-scripts.md). Client/preview fix needs
a deploy to reach users on craft-ai.ru.
