---
name: Editor preview scroll preserve on Редактор toggle
description: Remounting preview iframe on edit/selector mode used to jump to hero; also opaque-origin crash after removing allow-same-origin
---

## Bug
Clicking **Редактор** / **Выбрать** remounts the preview iframe (`key` switches view/edit/sel), resetting scroll to the top (hero).

## Fix
1. Before toggle: `postMessage({type:'nz-get-scroll'})` → parent stores `pendingScrollYRef`.
2. Inject one-shot restore script into `srcDoc` + `nz-set-scroll` on iframe `onLoad`.
3. Do **not** read `window.parent.location` from sandboxed srcDoc (opaque origin → SecurityError aborts the whole leads/scroll script). Bake `window.location.origin` into the injected leads API URL instead.

## QA
- Project #8 description bakery + #9 interactive NovaPulse generated on prod (no publish).
- Live puppeteer: scroll Y preserved exactly across Редактор on/off.
