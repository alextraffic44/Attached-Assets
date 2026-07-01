---
name: Editor diff-patch silent no-op
description: Why the site editor reported "я изменил X" but nothing changed, and the invariants any SEARCH/REPLACE edit path must keep.
---

# Editor SEARCH/REPLACE edits must never report a phantom success

The regular site editor (`/editor/:id`) edit path applies the model's ` ```diff `
SEARCH/REPLACE blocks to the stored HTML. The reported bug ("агент пишет что изменил,
но по факту ничего не изменилось / обновлений код не подтягивается") was a **silent
no-op**: when no SEARCH block matched, the *unchanged* code was still saved as success,
credits were charged, and the model's "I changed X" text reply was returned — so the
user saw nothing change.

## Invariants (keep these on any diff-apply edit path)

1. **0 applied patches ≠ success.** If diff blocks are present but `applied === 0`
   (including `total === 0` when nothing even parsed), do NOT save, snapshot, or report
   success. Emit a visible error to the client and stop. Silent no-op is the whole bug.
2. **Matching must be whitespace/indentation/CRLF tolerant.** Exact `String.includes`
   matching is the dominant cause of skipped patches (the model reindents / reformats).
   Fall back to a regex that escapes regex-specials then collapses whitespace runs to
   `\s+`; make the pair-delimiter regex accept `\r?\n` and trailing spaces.
   **Why:** an earlier "fuzzy" fallback was a no-op identity regex (`m.replace(/ /g,' ')`)
   so any whitespace mismatch failed silently.
3. **Replacement must be index/slice based, not `String.replace(search, replace)`** —
   otherwise `$`, `$1`, `$&` in the new code get interpreted and corrupt output.
4. **Refunds only when this request actually billed.** Gate on
   `billed = deduction.success && !deduction.alreadyProcessed`. `POST /generate` accepts a
   client `idempotencyKey`; an idempotent replay charged nothing, so an unconditional
   refund lets a caller mint credits. Same invariant as the scroll-anim / GENIMG paths.
5. **Surface partial application** (`applied < total`): append a note to the reply so the
   parts that didn't land don't read as success.

## Client side (already correct)
On `data.error` without `data.done`, `gotFinalCode` stays false, the `finally` sets
`streamedCode=""`, and the preview falls back to the saved (unchanged) project code — not
blank. Apply `newBalance` from the error payload so a refund shows immediately.
