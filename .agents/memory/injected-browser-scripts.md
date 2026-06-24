---
name: Injected browser <script> strings must be plain JS
description: Template-literal scripts in server/routes.ts that get injected into generated sites run in the browser and are NOT transpiled.
---

# Injected browser `<script>` strings must be plain JS

Any `<script>` body built as a template-literal string in `server/routes.ts` and injected into
generated/published site HTML (e.g. `injectLoadingOverlay`, the scroll-anim canvas builders) runs
**in the end-user's browser** and is shipped verbatim. tsx/TypeScript does **not** type-check or
transpile the *contents* of those strings.

**Why it bites:** TypeScript-only syntax inside such a string — casts like `(el as HTMLElement)`,
type annotations, non-null `!` in cast position — compiles fine server-side but is a **SyntaxError**
in the browser. A SyntaxError aborts the *entire* `<script>` block, so any init/`hide()` logic in it
never runs. Symptom seen: the branded page-load overlay (`__craft_loader__`) never hid and its
runtime `adapt()` color logic never ran → a white spinner permanently covered every generated site
("вторая заглушка заблокировала сайт").

**How to apply:** When editing or adding injected browser-script strings, write strictly browser
JS — no `as`, no `: Type`, no generics. Grep injected templates for ` as `/`: HTMLElement`/`<...>`
casts before shipping. Server-side `as any` elsewhere in routes.ts is fine; only the injected
string bodies matter.
