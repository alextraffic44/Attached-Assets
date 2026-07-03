---
name: Object storage download route crash (req undefined)
description: The /objects/* file-serving route threw a silent ReferenceError that broke image/site rendering for every request through it.
---

The `downloadObject` helper in the object-storage integration referenced `req` (to wire up a `close` listener that aborts the GCS read stream on client disconnect) without that helper ever receiving `req` as a parameter. Any call to the `/objects/*` route threw `ReferenceError: req is not defined`, caught by a generic try/catch that logged it and returned a 500 — so it looked like a narrow, occasional failure in logs ("Error downloading file: ReferenceError: req is not defined") rather than a total outage.

**Why:** because `/objects/*` is how ALL generated-site images (GENIMG markers, uploaded reference photos, scroll-anim frames, published assets) are served, this single missing parameter silently broke image loading — and by extension made it look like whole site generations "didn't display" even though the AI generation itself succeeded and images were created upstream.

**How to apply:** when a generated/published site "doesn't show up" or images don't load despite generation completing successfully, check for `Error downloading file` / `ReferenceError` in deployment logs around the `/objects/*` route before assuming the bug is in the generation pipeline itself. Any helper method that needs `req` (for abort/close handling, IP, headers, etc.) must receive it explicitly as a parameter — never assume it's in closure scope when the function is extracted into a separate class/module.
