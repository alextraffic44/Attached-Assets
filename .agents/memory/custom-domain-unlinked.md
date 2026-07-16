---
name: craft-ai.ru custom-domain unlink diagnosis
description: How to tell the Replit deployment is fine but the custom domain lost its link — edge 404s everything while the .replit.app URL works.
---

# Custom domain unlinked from Replit deployment

**Symptom:** every request to `craft-ai.ru` (root AND all /api routes) returns a bare 404 (`via: 1.1 google`, text/html) or the "This app isn't live yet" placeholder, and NO request lines appear in deployment logs — yet the deployment logs show the app booted fine ("serving on port 5000").

**Diagnosis:** call `getDeploymentInfo()`. If `isDeployed: true`, `hasSuccessfulBuild: true`, but `additionalUrls: []` — the custom domain is not linked to the deployment. Verify by curling the `primaryUrl` (`https://attached-assets-johnmaskot00.replit.app`): if the app answers there, the build/code is fine and the ONLY problem is the domain link.

**Why:** craft-ai.ru DNS points at Replit edge (34.111.179.208), but the edge routes by Host header; an unlinked hostname gets a generic 404 without ever reaching the app. Boot-time "healthcheck failed 500" noise in deploy logs is a red herring (proxy noise while the port opens).

**How to apply:**
1. Don't debug code or healthchecks first — curl the `.replit.app` primaryUrl and check `additionalUrls`.
2. Fix = user relinks the domain in the Publishing pane (Settings → Link a domain → craft-ai.ru), then re-verify TXT/A records.
3. Consequences while unlinked: 1payment webhooks to craft-ai.ru are dead (payments not credited), and Caddy on-demand TLS is dead (ask endpoint `https://craft-ai.ru/api/domains/check` unreachable) — client custom domains can't get certs.
