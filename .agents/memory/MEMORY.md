# Memory Index

- [Deploy media bundling](deploy-media-bundling.md) — local `/objects//uploads/` media must be downloaded & rebundled into the deploy/ZIP or it 404s on the static host (Netlify).
- [On-theme photos via GENIMG](genimg-photos.md) — generated sites use `{{GENIMG:...}}` markers resolved server-side to `/objects/` AI photos, never external stock URLs.
- [Security invariants](security-invariants.md) — private routes need auth+ownership (no shared-user fallback); large-body parser allowlisted; webhook raw body; user-URL fetches via SSRF guard.
