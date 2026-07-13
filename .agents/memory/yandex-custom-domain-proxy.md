---
name: Yandex CDN custom domain proxy approach
description: How custom domains work with Yandex CDN + Object Storage + Express proxy — verified working architecture and API pitfalls
---

## The Architecture (VERIFIED WORKING 2026-07-13, hub-sync.ru live on HTTP+HTTPS)
Custom domains ARE served via Yandex CDN. Chain:
user domain → (DNS ANAME) → CDN edge (cname = user domain, serves the LE cert) → origin `craft-ai.ru` (Express on Replit) → proxy middleware fetches `https://storage.yandexcloud.net/{bucket}{path}`.

**Why CDN + Express-proxy origin:** Yandex CDN always routes `*.yandexcloud.net` origins through the S3 API endpoint internally (root `/` → 403, no index serving), so the bucket can never be the origin directly. And Replit's edge routes by Host header, so the CDN must send `Host: craft-ai.ru`, not the custom domain.

**CDN resource options that MUST be set (reconcile on every add, not only create):**
- `hostOptions: { host: { enabled: true, value: "craft-ai.ru" } }` — CRITICAL; default forwardHostHeader sends Host:<custom-domain> which Replit's edge 404s before Express sees it
- `customServerName: "craft-ai.ru"` (TLS SNI to origin)
- `staticRequestHeaders: { "X-Custom-Domain": <apex> }` (tells proxy which bucket)
- `edgeCacheSettings: 86400` (24h — safe because every publish/unpublish purges the cache)
- `stale: { enabled, value: ["error","updating","timeout","invalid_header","http_500","http_502","http_503","http_504","http_429"] }` — edge keeps serving cached copy when origin (the app server) is down; deliberately excludes 403/404 so real missing content doesn't serve stale forever. GET `/resources/{id}` returns ONLY non-default options — absence of `stale` in GET before setting it doesn't mean the field is unsupported.
- `sslCertificate: { type: "CM", data: { cm: { id } } }` — attach via PATCH `/resources/{id}` WITHOUT `?updateMask` (updateMask query param → 404); PATCH without mask merges, doesn't wipe other options

## Cert issuance + AUTO-RENEWAL (the right way)
Write CNAME delegation `_acme-challenge.<apex>.` → `<certId>.cm.yandexcloud.net.` — Certificate Manager serves the ACME TXT itself, so both issuance AND ~90-day renewals work. A static TXT value works ONLY for initial issuance and silently kills renewal.
- CNAME cannot coexist with a stale TXT at the same name: swap atomically via `POST /dns/v1/zones/{id}:updateRecordSets` with `replacements` (TXT with `data: []` deletes it).
- Write the challenge record in its OWN update, separate from ANAME/www, so a conflict can't sink the whole DNS setup.
- Cert can be attached to CDN before issuance; shows `DONT_USE` until ISSUED, then activates.

## Propagation behavior (don't panic-debug)
- New/recreated CDN resource takes ~15-40 min to reach edge nodes; symptoms while propagating: nginx 404 (edge doesn't know the cname), wildcard `*.yccdn.cloud.yandex.net` cert, intermittent 000/SSL aborts.
- Yandex GSLB DNS pulls un-updated edge IPs out of the A-record rotation itself — per-IP testing (`curl --resolve`) distinguishes propagation from real misconfig.
- Cache purge: `POST /cdn/v1/cache/{resourceId}:purge` body `{resourceId, paths: []}` = full purge (does NOT fix propagation 404s). MUST be called after every content-changing deploy for a custom-domain project — including secondary publish paths (SEO editor) — or the 24h TTL serves the old site; purge-after-upload order has no re-cache race.
- Origin `Cache-Control` takes precedence over `edgeCacheSettings.defaultValue`, so the Express proxy must send `max-age=86400` on ALL success paths (incl. the 404→index.html SPA fallback) to actually get 24h edge caching.

## Proxy hardening (server/routes.ts custom-domain middleware)
- Send `Vary: X-Custom-Domain` (same path serves different projects — cache poisoning otherwise).
- Reject `..`/`%2e`/`%2f`/`%5c` in `req.path` — WHATWG URL normalizes encoded dot segments → cross-bucket reads.

## Misc confirmed API facts
- `POST /dns/v1/zones/{id}:upsertRecordSets` (`merges`) and `:updateRecordSets` (`replacements`) both work from server code.
- DNS zone `recordSets` GET may 404 even when records exist — verify via DoH instead.
- www is NOT supported: cert has no www SAN and CDN cname is apex-only; product copy says site opens without www. DNS www CNAME exists but https://www.<domain> fails — known accepted limitation.
