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

## Verified working (2026-07-13)
- `http://hub-sync.ru/` → 200 OK (CDN → craft-ai.ru proxy → S3 bucket)
- NS: ns1/ns2.yandexcloud.net ✓
- `_acme-challenge` TXT values visible in global DNS ✓
- HTTPS pending cert issuance (cert ID `fpqi7j6lanercg5p0qjh` attached to CDN resource `bc8r477s2k4zw75pf3ws`)
