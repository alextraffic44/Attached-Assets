# Memory Index

- [Deploy media bundling](deploy-media-bundling.md) — local `/objects//uploads/` media must be downloaded & rebundled into the deploy/ZIP or it 404s on the static host (Netlify); 3rd regex catches bare URLs in `data-frames` JSON.
- [Generated-media markers + billing](genimg-photos.md) — `{{GENIMG}}`/`{{SCROLLANIM}}` resolved server-side to `/objects/` assets (never external URLs); refund ONLY when `!alreadyProcessed` or replays mint credits.
- [Security invariants](security-invariants.md) — private routes need auth+ownership (no shared-user fallback); large-body parser allowlisted; webhook raw body; user-URL fetches via SSRF guard.
- [Cyrillic web fonts](cyrillic-fonts.md) — generated RU text needs Cyrillic-capable fonts; use Unbounded+Manrope, AVOID Space Grotesk/Syne (Latin-only, silently break).
- [Interactive loading UX](interactive-loading-ux.md) — keep ONE robot loader up until SCROLLANIM video is fully ready, then reveal; iframe `src` blob overrides `srcDoc` so clear it at each generation start.
- [Injected browser scripts](injected-browser-scripts.md) — `<script>` strings injected into generated sites run in the browser & aren't transpiled; TS syntax (`as HTMLElement`) = SyntaxError that kills the whole block.
