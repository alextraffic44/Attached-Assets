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
1. NON-frame rasters (product photos etc.) compressed at publish via `compressImageForPublish`
   (≤300KB). For product-heavy sites (e.g. donut: 6 PNGs ~4MB each = 24MB) this is the dominant win.
2. Canvas frame loader is windowed (MAXP=4, frame 0 first) with a per-frame 12s timeout +
   `settled` guard so a hung request always frees its slot and `signalReady()` always fires
   (no deadlock). New animations only.

**Frame-specific levers were TRIED then REVERTED by the user (do not re-add without asking):**
- Frame compression (`compressFrameForPublish` 1280px+q72 at publish) AND ffmpeg downscale/`-q:v 4`
  at extraction — both REMOVED; frames are back to full-res `-q:v 1`, uncompressed. The user found
  the quality loss too visible and accepted that heavy all-frame sites may need a VPN in Russia.
- Frame-count reduction (90→72 / 160→120) — REVERTED; counts stay 90 / 160 for scroll smoothness.
- Net: the load win now comes from #1 (+ #2). All-frame sites (e.g. bank: ~90 full-res frames)
  may still be heavy. If they fail without VPN, the real fix is the Yandex CDN below, NOT
  re-compressing frames.

**Critical operational facts:**
- Static Netlify sites do NOT change until a fresh **re-publish**. Code changes #2/#3/#4 only
  affect NEWLY generated animations; only #1 (+ existing non-frame compression) helps already-
  published sites, and ONLY after they are re-published.
- Backend changes must be **deployed to prod (craft-ai.ru)** before re-publishing has any effect.
- Verify with the publish log line `total media payload X MB` and test from a real Russian
  network WITHOUT a VPN (a non-RU vantage / VPN always works and proves nothing).

**Update:** Full hosting migration off Netlify to Yandex Cloud (Object Storage + CDN +
Certificate Manager) was completed with user sign-off. See
[Yandex CDN per-project buckets](yandex-cdn-per-project-buckets.md) and
[Yandex CDN SSL cert attach](yandex-cdn-ssl-cert.md) for the resulting architecture. All
publishing (default URL + custom domains) now serves from Russia-accessible Yandex
infrastructure, so this whole throttling class of bug should no longer occur for newly
published sites.

## RKN blocks Tailwind / framework CDNs in Russia

`cdn.tailwindcss.com` (and other foreign CSS/JS framework CDNs) are RKN-blocked in Russia, so any
GENERATED site that pulls a framework from a CDN breaks without a VPN. **Rule:** generated sites must
ship only self-contained `<style>` CSS — no Tailwind/Bootstrap/unpkg/jsdelivr. `SYSTEM_PROMPT`
forbids external CDNs/libraries and now names Tailwind explicitly; all generation paths (new/edit/
mockup) reuse `SYSTEM_PROMPT`, so the rule is inherited everywhere. **Google Fonts is the one allowed
external dependency** (works in RU, on every site).

**The builder app's OWN Tailwind is fine** — it's compiled at build time (`tailwind.config.ts` +
`@tailwind` directives → static bundled CSS on craft-ai.ru), so there is NO runtime call to
`cdn.tailwindcss.com`. RKN blocking the CDN does not affect compiled Tailwind. Do NOT rip Tailwind
out of the builder over this — only the CDN form is the problem, and the builder doesn't use it.
**Do NOT auto-strip a Tailwind CDN `<script>` from generated HTML:** if a site relies on the Play
CDN it's already broken in RU; stripping it would also break it everywhere else. Prevent at the
prompt, don't sanitize after.
