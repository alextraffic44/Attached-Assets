---
name: Dashboard thumbnail iframes and slow project loads
description: Why opening/navigating projects felt slow or briefly showed "no site" despite being published
---

Two compounding issues caused published/existing projects to feel slow or briefly show a blank "no site" state on open:

1. **Unsandboxed preview iframes on the projects list**: each project card rendered its full `generatedCode` in an `<iframe srcDoc=...>` with NO `sandbox` attribute, so every project's scripts/animations/timers actually executed simultaneously in the background for every card on the page (100+ live pages running at once). This saturates the main thread and can make navigation elsewhere in the app sluggish.
   - **Fix**: add `sandbox="allow-same-origin"` (no `allow-scripts`) + `loading="lazy"` to list/thumbnail iframes — visual-only preview, no script execution needed.

2. **No query retry**: the global React Query client had `retry: false`. A single transient failure/slow response on `GET /api/projects/:id` left `project` as `undefined` forever (query settled, no retry), and the editor's "no code + no messages yet" empty state (new-project placeholder) was shown instead of an error — looking exactly like "site doesn't exist" until a manual page refresh.
   - **Fix**: default `retry: 2` with backoff, and explicit `isError` handling in the editor to show a distinct "failed to load, retry" UI instead of silently falling through to the empty-project placeholder.

**Why this matters**: any page that renders many live srcDoc iframes of full external/generated HTML (thumbnails, galleries) should disable scripts via `sandbox` unless interactivity is truly required — it's a common accidental perf/security foot-gun in this codebase's iframe-preview pattern (used in dashboard cards, editor preview, generations library, etc. — audit similar spots if new gallery/list views are added).
