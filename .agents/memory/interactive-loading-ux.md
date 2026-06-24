---
name: Interactive mode loading UX
description: How the SCROLLANIM (Интерактивный) generation should present loading in the editor preview.
---

# Interactive (SCROLLANIM) loading UX

The editor must show a **single** loading screen — the robot "Генерируем сайт..." overlay
(shown while `isGenerating === true` in `client/src/pages/editor.tsx`) — from the start of
generation until the FULL site, including the scroll-bound video animation, is ready. Then
reveal the finished site exactly once.

**Why:** The user repeatedly rejected the multi-screen flow (robot → dark "video pending"
placeholder → final site). Seeing several different loaders in sequence reads as one
"бесконечная анимация" / broken state. They explicitly asked: keep one loader up until fully
ready, don't overcomplicate — applies to all modes.

**How to apply:**
- The server still streams `done:true, animPending:true` and stores a `data-scroll-anim-pending="1"`
  placeholder; the background pipeline IS reliable in deployment (BG ANIM completes, frames produced).
- Client keeps `isGenerating` true while waiting: set a local `waitingForAnim` flag in the
  `data.done` handler, and the `finally` block must skip `setIsGenerating(false)` when it's set.
- Poll `GET /api/projects/:id` until the code no longer contains `data-scroll-anim-pending="1"`,
  then reveal + `setIsGenerating(false)`. Hard timeout (~20 min) so it never hangs forever; on
  timeout STRIP the pending `<section ... data-scroll-anim-pending="1" ...>...</section>` before
  revealing so the dark placeholder is never shown.
- Only enter the wait branch if the delivered code actually contains the pending marker
  (immediate-complete otherwise).

**iframe gotcha:** the preview `<iframe>` is driven by `srcDoc`, but a DOM `src` (blob URL) set
anywhere takes precedence and React won't clear it on re-render — this freezes the preview across
generations ("all modes"). At the START of every generation, `iframeRef.current.removeAttribute("src")`
so `srcDoc` controls the preview; only set a fresh blob `src` at the final reveal.

## Per-site preloader (the loader baked INTO the generated site, for visitors)

Separate from the editor robot overlay above: the published video site itself needs a preloader so
visitors don't see a blank/black canvas while the heavy WebP frames load. Two requirements the user
gave: (1) preloader ONLY on video-anim sites — already gated by the `interactiveMode || hasScrollMarkers`
condition around the `injectLoadingOverlay` calls; (2) the preloader must be UNIQUE per site, matching
its style — so the AI authors it, not a hardcoded spinner.

**Contract (don't break the handshake):**
- The interactive SYSTEM_PROMPT instructs the model to emit a full-screen `<div id="site-preloader">`
  (exact id) as the first `<body>` child, on-brand, inline styles, and explicitly NO hide JS.
- `injectLoadingOverlay` keeps the AI's visuals if `id="site-preloader"` exists, else injects a neutral
  palette-adaptive fallback with the same id. It ALWAYS appends the hide script `#__craft_loader_hide__`
  (idempotency guard is on that id). Reapplied to final `animatedCode` (derived from original
  `mainHtmlCode`, so the guard doesn't block it).
- **Hiding is event-driven, not `window.load`.** `new Image()` frame loads do NOT delay `window.load`,
  so hiding on load reveals a black canvas. Instead `buildScrollAnimHtml` dispatches a window
  `craft:anim-ready` event when frame 0 paints; the hide script waits for it (15s hard fallback).
  Only the FIRST `[data-frames]` block fires it (`document.querySelector('[data-frames]')===root`) so a
  below-fold animation can't hide the loader before the hero paints. Pages with no `[data-frames]`
  (static SCROLLANIM fallback) hide on `window.load` + 9s. `window.__craftAnimReady` covers the
  load-before-script race.
