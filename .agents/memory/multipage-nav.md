---
name: Multi-page nav sync
description: How generated multi-page sites keep header/footer nav consistent and anchors working across pages, and the ghost "Index" link pitfall.
---

# Multi-page navigation sync

Generated sites are multi-file (index.html + sub-pages stored in project_files). A server endpoint (`/api/projects/:id/sync-nav`) is the single source of truth that repairs nav across ALL pages; the editor's create-page flow PUTs the new file then calls it.

## Invariants (must hold on every page)
- **Never** add `index.html` as a nav menu link. Doing so produces an ugly ghost "Index"/"INDEX" item. A `ghostRe` strips any existing `<a href="index.html">Index</a>` from every page to repair already-broken sites.
- Header/footer nav must be byte-identical across pages except the active-link highlight. sync-nav builds a `canonicalNav` from the (ghost-cleaned) index nav + links for any missing sub-pages, then replaces each page's FIRST `<nav>` inner HTML with it (keeping that page's own `<nav ...>` open tag).
- **Anchor context differs per page** — this is the core bug source:
  - On **index.html**, section links are in-page anchors: `href="#cases"`.
  - On **sub-pages**, the same links to homepage sections must be `href="index.html#cases"` (a bare `#cases` on a sub-page scrolls to nothing).
  - `fixHrefs(code, filename)` rewrites per context: sub-page `#x`→`index.html#x` (only when `x` is an id present on index AND absent on this page); index `index.html#x`→`#x`. Runs across the WHOLE page so FOOTER links get fixed too. Leaves external, root-absolute `/`, `mailto:`/`tel:`, bare `#`, and other `.html` untouched.

## Gotchas
- Replacing nav HTML: pass the replacement as a **function** to `String.replace` (`() => openTag + inner + "</nav>"`) — otherwise `$&`/`$'` sequences inside nav content get expanded.
- Idempotent: re-running yields identical code (missing-page check strips `./` and `#` fragments before comparing; `code === page.code` skips the DB write).
- Bare `href="#"` logo on sub-pages is intentionally left as-is (auto-rewriting bare `#` would also hijack CTAs that use `#`); sub-page section links still return home via `index.html#…`.
- Preview parity: the editor iframe intercepts clicks — `page.html#anchor` links postMessage `nz-navigate-file` to switch tabs; published(Vercel)/ZIP use real files so browser-native anchor scroll works. Root `/` resolves to index on the deployed host.
- Generation system prompt (multi-page block in server/routes.ts) also teaches the AI this anchor convention up front so freshly generated sites are already correct before sync-nav runs.
