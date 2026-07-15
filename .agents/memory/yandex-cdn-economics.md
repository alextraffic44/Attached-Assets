---
name: Yandex CDN custom-domain economics
description: Confirmed Yandex CDN pricing/limits and why the per-domain CDN approach was replaced by the Timeweb Caddy proxy
---

# Yandex CDN custom-domain economics (historical, superseded July 2026)

Confirmed by Yandex Cloud support:
- Each CDN resource costs a fixed **150 ₽/month** (+ traffic on top).
- Secondary hostnames on one resource are free, BUT only **one SSL certificate per CDN resource** — so one shared resource cannot serve independent per-client HTTPS domains without a fragile multi-SAN group certificate.
- Default quota: **20 CDN resources per cloud** (increases negotiated individually).

**Decision (superseded the earlier per-domain-CDN choice):** in July 2026 the owner approved replacing Yandex CDN entirely with a Timeweb VPS running Caddy on-demand TLS — see [timeweb-caddy-domains.md](timeweb-caddy-domains.md). All CDN/Certificate-Manager/IAM code was deleted from the publish pipeline. Default publishes stay on `craft-ai-p{id}.website.yandexcloud.net` (no CDN, near-free).

**Why:** flat ~207₽/mo for unlimited domains beats 150₽/mo × N domains + 20-resource quota; also removes cert-issuance DNS-challenge complexity.

**How to apply:** do NOT resurrect per-domain CDN resources or Certificate Manager in publish code; the pricing facts above are only useful if the Caddy-VPS approach is ever re-evaluated.
