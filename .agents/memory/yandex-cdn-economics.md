---
name: Yandex CDN custom-domain economics
description: Confirmed pricing/limits from Yandex support and the chosen per-domain CDN architecture decision
---

# Yandex CDN custom-domain economics (decision, July 2026)

Confirmed by Yandex Cloud support:
- Each CDN resource costs a fixed **150 ₽/month** (+ traffic on top).
- Secondary hostnames on one resource are free, BUT only **one SSL certificate per CDN resource** — so one shared resource cannot serve independent per-client HTTPS domains without a fragile multi-SAN group certificate.
- Default quota: **20 CDN resources per cloud** (increases negotiated individually).
- CDN can forward/rewrite the Host header to origin (configurable per resource).

**Decision:** keep the current architecture — 1 client custom domain = 1 dedicated CDN resource (150 ₽/mo each). Default publishes stay on `craft-ai-p{id}.website.yandexcloud.net` with NO CDN (near-free).

**Why:** owner explicitly chose simplicity over cost optimization. Alternatives evaluated and rejected for now: (a) shared CDN resource + multi-SAN Let's Encrypt cert — cert reissue on every domain add, one broken client DNS endangers the whole group; (b) own VPS with Caddy on-demand TLS (~300–500 ₽/mo flat, unlimited domains) — rejected to avoid extra infrastructure; note the Replit-hosted app CANNOT do this itself (no port-443/SNI control, Replit routes by Host).

**How to apply:** don't re-litigate per-domain CDN in publish code; when approaching ~20 custom domains, request a quota increase from Yandex support or revisit the Caddy-VPS option. Consider billing clients ~200–300 ₽/mo for the custom-domain feature to cover CDN cost (not implemented yet).
