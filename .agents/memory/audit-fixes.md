---
name: Audit fixes batch (security, billing, agent, UX)
description: Fixes from deep audit — iframe sandbox, idempotency, refunds, GENIMG persist, live preview, etc.
---

## Critical / High
- Preview iframe (editor/SEO): removed `allow-same-origin`; validate `postMessage` source; wheel via postMessage
- Project list thumbnails: empty `sandbox` (no scripts, opaque origin) — perf + XSS isolation
- Trusted UI template cards keep `allow-same-origin` only (needed for hover via contentDocument; no scripts)
- `deductCredits`: atomic claim-then-debit; reject key reuse across ops/users/amounts
- Refunds on enhance/research/generate/image/3d failures
- GENIMG secondary pages persisted after resolve
- BG scroll-anim merges into latest HTML via pending replace (no full overwrite)
- SVG uploads blocked; existing SVG served as attachment + CSP
- Payment webhook: reject test, verify userId/amount/order_id
- Admin: `ADMIN_USER_IDS` / `ADMIN_TELEGRAM_ID` preferred over bare id=1

## Agent / UX
- Tool-fallback rebuilds multipage prompt with `useToolsHint:false`
- History no longer duplicates current prompt
- Gemini heredoc keeps filenames as FILE markers
- `apply_patch` requires unique SEARCH match
- Live preview streams during generation; multipage optimistic files
- Saves check `resp.ok` + save sequencing
- Dashboard: upload assets before create; payment popup opens sync; create state reset

## Billing / schema
- First-day hosting charge on publish + advisory lock for plan limits
- Unique index `(project_id, filename)` on `project_files` (boot + schema)
- `safeFetch` re-validates DNS before user-URL fetches
