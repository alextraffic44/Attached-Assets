---
name: Yandex CDN custom domain proxy approach
description: How custom domains work with Yandex CDN + Yandex Object Storage — the only reliable architecture
---

## The Rule
Yandex CDN **always** routes `*.yandexcloud.net` origins (including `bucket.website.yandexcloud.net`) through the S3 API endpoint internally. S3 API returns 403 for root `/` (no index document serving). The ONLY solution: use our own Express app (`craft-ai.ru`) as the CDN origin and proxy requests to the bucket via S3 path.

**Why:** Yandex CDN edge servers resolve `bucket.website.yandexcloud.net` to the same IP as the S3 API endpoint (213.180.193.247 is the website endpoint IP, but CDN internally bypasses it and uses S3 API routing).

**How to apply:**
- CDN origin group: source = `craft-ai.ru` (our Express app)
- CDN resource: `originProtocol: "HTTPS"`, `customServerName: "craft-ai.ru"` (valid cert SNI), `staticRequestHeaders: { "X-Custom-Domain": domain }`
- Express proxy middleware in `server/routes.ts`: reads `X-Custom-Domain` header → looks up project by `customDomain` field → fetches `https://storage.yandexcloud.net/{bucket}{path}` (adds `/index.html` for root `/`) → streams response back
- DNS: ANAME on apex → CDN `providerCname` (Yandex DNS flattens ANAME to A)

## Cert validation (Let's Encrypt via Yandex CM)
- Cert in VALIDATING state needs `_acme-challenge.{domain}` TXT record with the challenge value
- The CNAME challenge form (`_acme-challenge` CNAME → `{certId}.cm.yandexcloud.net.`) may conflict with existing TXT records at that name — use the TXT form instead
- Both TXT values coexist OK; Let's Encrypt accepts either
- CDN `sslCertificate: { type: "CM", data: { cm: { id: certId } } }` can be attached BEFORE cert is issued; shows as `DONT_USE` until cert is `ISSUED`, then activates automatically
- DNS zone `recordSets` API may return 404 even when records exist — verify via Cloudflare DoH: `https://cloudflare-dns.com/dns-query?name=_acme-challenge.{domain}&type=TXT`

## CRITICAL: Yandex CDN DNS Override (2026-07-13)

CDN resource with `cname: hub-sync.ru` injects an internal ANAME that **overrides** the user-managed DNS zone. `updateRecordSets` returns 200 OK but DNS zone changes have no effect while CDN resource is active. CDN-managed DNS control takes ~15-30 min to release after CDN resource deletion.

## Hard Limits (confirmed by testing)
1. Yandex CDN always routes to S3 API (not website endpoint) for ANY origin config — root `/` always 403.
2. Russian edge nodes (188.72.x.x) resolve `{bucket}.website.yandexcloud.net` to S3 API internally.
3. CDN ANAME overrides DNS zone. Only fix: delete CDN resource, wait for release.
4. `POST /dns/v1/zones/{id}:updateRecordSets` is the correct REST endpoint (not `:upsert` or `/recordSets`).
5. Empty `data: []` in replacements deletes that record type.

## Correct Architecture (no CDN)
- DB: `projects.customDomain = 'hub-sync.ru'`, `projects.vercelProjectId = 'hub-sync.ru'` (bucket name)
- DNS: domain A → 34.111.179.208 (Replit deployment)
- Replit custom domain for hub-sync.ru (via Replit deployment settings UI — user action)
- Replit provisions Let's Encrypt cert automatically
- Proxy in `server/routes.ts` (~line 2279) handles Host header → S3 bucket fetch → root `/` → `/index.html`
- Works for both HTTP and HTTPS after Replit custom domain setup

## State at 2026-07-13
- CDN resource `bc8r477s2k4zw75pf3ws` DELETED
- Cert `fpqcdba0amlnqbpmo1k3` ISSUED for hub-sync.ru (in Certificate Manager)
- DNS zone A: 34.111.179.208 set (waiting for CDN ANAME override to release)
- Project 3: customDomain='hub-sync.ru', vercelProjectId='hub-sync.ru'
- User still needs to add hub-sync.ru as Replit custom domain
