---
name: HTML injection must tolerate missing </body>
description: AI-generated site HTML sometimes omits the closing </body> tag; any code that injects via </body> replacement silently no-ops and the injected script never runs.
---

# HTML injection must tolerate missing </body>

The model that generates site HTML occasionally emits a document with **no closing
`</body>` tag** (and sometimes no `</html>` either). This is intermittent — ~half of
generations are fine.

**Rule:** Any helper that injects markup by replacing `</body>` MUST fall back to
`</html>`, then to plain append, when `</body>` is absent. Never gate the whole
injection behind an `if (html.includes('</body>')) return html;` early-exit — that
silently drops the injection.

**Why:** The preloader-hide script (`__craft_loader_hide__`) was injected only via
`html.replace(/<\/body>/i, ...)`, guarded by an early return when `</body>` was missing.
For sites whose AI output lacked `</body>`, the hide script was never added, so the
custom `#site-preloader` had no hide logic and covered the site forever ("loading never
disappears"). This presented as an intermittent ~50% failure that survived several
"fix the hide timers" attempts, because the real cause was the injection never landing
at all — confirmed by querying prod: broken sites had `position('</body>')=0` AND
`position('__craft_loader_hide__')=0`.

**How to apply:** The injection chain is `</body>` → `</html>` → append; apply it to
EVERY string injection into generated site HTML (loader-hide, leads script, ZIP export
for both index and extra pages). The loader-hide injection must run at every path that
produces final HTML — generation, the manual scroll-anim toolbar endpoint, AND
publish/deploy (so re-publishing self-heals older sites). Keep that injector idempotent
so re-running it on publish is safe.
