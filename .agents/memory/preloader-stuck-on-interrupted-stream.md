---
name: Stuck preloader on interrupted generation stream
description: Why an interactive site can show a frozen custom preloader and nothing else, and the client-side invariant that prevents it.
---

# Stuck preloader = interrupted generation, not a render bug

When a user reports an interactive/scroll-anim site shows ONLY a custom intro/preloader
(e.g. a branded `<div id="site-preloader">`) and nothing else, the usual cause is that
the generation **died mid-SSE-stream before the server persisted the site**, NOT a
broken animation or a broken hide-script.

**How to confirm (prod read-only replica):** the project row has `created_at == updated_at`,
`length(generated_code) == 0`, and only the user prompt message exists with **no model reply**.
That means the request never reached the `updateProject(immediateHtml)` save. Common trigger:
a deploy/server restart (or a 503/timeout/dropped connection) interrupting an in-flight stream.

**Why the preloader freezes (client):** during streaming the editor keeps the half-streamed
HTML in `streamedCode`. That partial HTML contains the AI's custom `site-preloader` but NOT
the server-injected `__craft_loader_hide__` script (server injects that only on successful
completion). When `isGenerating` flips off, the preview renders `currentCode` (= `streamedCode`
fallback), so the un-hideable preloader shows forever.

**Invariant / fix:** the SSE consumer must treat "stream ended without a final `done`+code
event" as a failure. Track a `gotFinalCode` flag (true only when `data.done` delivers code);
in the `finally`, if `!gotFinalCode && !waitingForAnim`, clear `streamedCode` + `streamingReply`
+ `generationStatus` so the preview falls back to saved code (blank for new project / prior
version for an edit) and prompt the user to retry. Do NOT clear on the `animPending` path
(`waitingForAnim=true`, `gotFinalCode=true`) — the background poll owns completion there.

**Why:** an interrupted stream must never leave a frozen partial buffer on screen; the saved
DB state (empty or previous) is the source of truth once the stream fails.
