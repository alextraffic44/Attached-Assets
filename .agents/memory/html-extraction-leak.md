---
name: HTML extraction from model output
description: Why generated sites intermittently rendered the model's preamble + markdown fence as literal text, and the invariant that fixes it.
---

# Generated-site HTML extraction must tolerate unclosed ```html fences

In v2/Gemini text-to-website generation, the model intermittently returns
conversational preamble + an UNCLOSED ```html fence (no closing ```), e.g.
"Вот готовый код файла index.html: ```html\n<!DOCTYPE html>...". This is the
cause of "каждый второй сайт криво собирается" — every other site rendered the
literal preamble + fence as text instead of HTML.

**Rule:** never persist `fullResponse` raw when extraction fails. The closed-fence
regex (`/```html...```/`) silently fails on an unclosed fence, and the old
`<!DOCTYPE`/`<html` fallback took the WHOLE response (preamble + opening fence
included). Always slice from the first `<!DOCTYPE html`/`<html` and strip stray
opening/closing fences. `cleanHtmlDoc()` in server/routes.ts does this and is
applied in the single-file fallback + as a final safety net on `mainHtmlCode`.

**Why:** the model's wrapping (prose, fences, truncation) is non-deterministic;
extraction must be defensive, not assume a well-formed closed fence.

**How to apply:** any new code path that turns model output into saved site HTML
must run it through `cleanHtmlDoc` (idempotent, safe on already-clean docs) before
persisting/previewing.
