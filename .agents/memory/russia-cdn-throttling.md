---
name: Russia CDN throttling of heavy deploys
description: Why heavy interactive (animation) published sites show broken images for Russian users without a VPN, while light sites load fine — and how the payload is kept small.
---

# Russia foreign-CDN throttling × deploy page weight

**Symptom:** A user in Russia reported that published "Интерактивный"/animation sites
(scroll-bound canvas) loaded the HTML but showed **broken images + black hero** WITHOUT a VPN,
while "По описанию" (plain text-to-website) sites loaded fully. With a VPN ON, everything worked.

**Root cause (architect-confirmed):** page weight × Russian ISP DPI throttling/RST of large
sustained transfers from foreign CDNs (Netlify). It is NOT a blocked domain or broken asset:
- All assets are bundled as relative `assets/...` on the SAME Netlify origin as the HTML and
  return HTTP 200 with valid bytes/Content-Type from a non-RU vantage.
- The only external hosts are Google Fonts (on ALL sites), the lead-form POST to craft-ai.ru,
  and a fake og:image meta domain — none of which can break same-origin images/canvas frames.
- The discriminator is purely SIZE: measured animation sites were 20-40MB (e.g. a donut site =
  40MB: 6 product PNGs ~4MB EACH uncompressed + ~90 frames; a bank site = 20MB of ~90 frames).
  Description sites are a few MB. Light payloads slip under the throttle; heavy ones get
  throttled/reset so images+frames never finish. A VPN bypasses DPI.

**Why "it worked yesterday":** Russian DPI throttling of foreign CDNs fluctuates; the same site
can load one day and fail the next with no code change.

**Fix applied (payload reduction, all `server/routes.ts`):**
1. Frames compressed at publish via `compressFrameForPublish` (scale 1280 + mozjpeg q72) — the
   key lever, because it ALSO shrinks already-published sites on re-publish.
2. `extractFramesWithFfmpeg` now actually scales (`scale='min(1280,iw)':-2`) and uses `-q:v 4`
   (was `-q:v 1`, no scale — `SCROLL_FRAME_WIDTH` was declared but never used).
3. (Frame-count reduction was tried — 90→72 / 160→120 — but the user REVERTED it; counts stay
   90 (`SCROLL_FRAME_COUNT`) and 160 (`SCROLL_ACTION_FRAME_COUNT`). Do not lower them: per-frame
   compression already carries the payload win, and the user values scroll smoothness.)
4. Canvas frame loader is windowed (MAXP=4, frame 0 first) with a per-frame 12s timeout +
   `settled` guard so a hung request always frees its slot and `signalReady()` always fires
   (no deadlock). New animations only.

**Critical operational facts:**
- Static Netlify sites do NOT change until a fresh **re-publish**. Code changes #2/#3/#4 only
  affect NEWLY generated animations; only #1 (+ existing non-frame compression) helps already-
  published sites, and ONLY after they are re-published.
- Backend changes must be **deployed to prod (craft-ai.ru)** before re-publishing has any effect.
- Verify with the publish log line `total media payload X MB` and test from a real Russian
  network WITHOUT a VPN (a non-RU vantage / VPN always works and proves nothing).

**Escalation if payload reduction is not enough:** serve heavy assets from a Russia-accessible
CDN/object storage (Yandex Object Storage — note `YC_KEY_ID`/`YC_SECRET` are configured-but-missing
secrets) while keeping Netlify for HTML; full hosting migration is a larger billing/domain decision.
This needs the user's sign-off — do NOT do it unilaterally.
