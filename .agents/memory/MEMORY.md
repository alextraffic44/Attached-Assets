# Memory Index

- [Deploy media bundling](deploy-media-bundling.md) — local `/objects//uploads/` media must be downloaded & rebundled into the deploy/ZIP or it 404s on the static host (Netlify); 3rd regex catches bare URLs in `data-frames` JSON.
- [Generated-media markers + billing](genimg-photos.md) — `{{GENIMG}}`/`{{SCROLLANIM}}` resolved server-side to `/objects/` assets (never external URLs); refund ONLY when `!alreadyProcessed` or replays mint credits.
- [Security invariants](security-invariants.md) — private routes need auth+ownership (no shared-user fallback); large-body parser allowlisted; webhook raw body; user-URL fetches via SSRF guard.
- [Interactive-site nav transparency](interactive-nav-transparency.md) — fixed header forced transparent via `!important` while scroll-anim on screen; `craft-anim-passed` body class (set by `navCtl`) flips it colored after the animation scrolls past.
- [overflow:hidden breaks scroll-anim sticky](sticky-overflow-clip.md) — interactive site shows only frame 0 (no anim on scroll) when generated CSS puts `overflow-x:hidden` on body/wrapper (breaks position:sticky); fix = swap ancestor hidden→clip at runtime, BOTH axes.
- [Netlify deploy errors](netlify-deploy-errors.md) — Netlify puts deploy errors in `error`/`errors`, not always `message`; 403 "Account credit usage exceeded" is an account-billing block (add Netlify credits), not a code/site bug.
- [HTML injection vs missing </body>](body-tag-injection.md) — AI HTML sometimes omits </body>; inject via </body>→</html>→append, never early-return; wire preloader-hide at gen+manual+publish paths.
- [Stuck preloader on interrupted stream](preloader-stuck-on-interrupted-stream.md) — "site shows only preloader" = generation died mid-SSE before save (empty generated_code); client must drop partial streamedCode when stream ends without final code.
- [Cyrillic web fonts](cyrillic-fonts.md) — generated RU text needs Cyrillic-capable fonts; use Unbounded+Manrope, AVOID Space Grotesk/Syne (Latin-only, silently break).
- [Interactive loading UX](interactive-loading-ux.md) — keep ONE robot loader up until SCROLLANIM video is fully ready, then reveal; iframe `src` blob overrides `srcDoc` so clear it at each generation start.
- [Injected browser scripts](injected-browser-scripts.md) — `<script>` strings injected into generated sites run in the browser & aren't transpiled; TS syntax (`as HTMLElement`) = SyntaxError that kills the whole block.
- [ffmpeg deploy EIO](ffmpeg-deploy-eio.md) — fluent-ffmpeg pipe-read throws `EIO: i/o error, read` in deploy, dropping frames despite a downloaded mp4; use direct spawn w/ stdio ignored + retry + tmp-copy binary.
- [Preloader id mismatch](preloader-id-mismatch.md) — stuck splash = model named it ≠`#site-preloader`; hide net must fall back to fullscreen-guarded selectors + keep hard cap (5s), never one exact id.
- [SCROLLANIM/GENIMG wow prompts](scrollanim-wow-prompts.md) — scrubbed frames need VISIBLE motion + slow camera push-in only (never "imperceptible/ultra-slow", never pan/tilt); split keeps left-half flat; GENIMG booster only at call site, never alters dedupe key.
- [HTML extraction leak](html-extraction-leak.md) — model output sometimes has preamble + UNCLOSED ```html fence; never persist raw fullResponse, run through `cleanHtmlDoc` (slice from <!DOCTYPE/<html, strip fences) or preamble leaks as the site.
