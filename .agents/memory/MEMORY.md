# Memory Index

- [Deploy media bundling](deploy-media-bundling.md) — local `/objects//uploads/` media must be downloaded & rebundled into the deploy/ZIP or it 404s on the static host (Netlify); 3rd regex catches bare URLs in `data-frames` JSON.
- [Generated-media markers + billing](genimg-photos.md) — `{{GENIMG}}`/`{{SCROLLANIM}}` resolved server-side to `/objects/` assets (never external URLs); refund ONLY when `!alreadyProcessed` or replays mint credits.
- [Security invariants](security-invariants.md) — private routes need auth+ownership (no shared-user fallback); large-body parser allowlisted; webhook raw body; user-URL fetches via SSRF guard.
