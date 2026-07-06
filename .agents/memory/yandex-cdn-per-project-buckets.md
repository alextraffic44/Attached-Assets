---
name: Yandex CDN per-project bucket isolation
description: Why multi-tenant static sites on Yandex Cloud need one Object Storage bucket per project instead of a shared bucket with path prefixes.
---

Yandex Cloud CDN origin groups do not support origin-path prefixes: an origin source of
the form `bucket-host/some/path` is rejected as an invalid fqdn. Only a bare host (bucket
website endpoint or bucket S3 endpoint) is accepted as an origin.

**Why:** This rules out the common multi-tenant pattern of one shared bucket with a
`projects/{id}/` prefix per site plus a single CDN origin group rewriting paths. There is
no server-side path rewrite available at the origin-group level to make that work.

**How to apply:** For any per-project static site hosting on Yandex Cloud (custom domains,
white-labeled publishing, etc.), provision one dedicated Object Storage bucket per project
(e.g. `{app}-p{projectId}`) with website hosting enabled on the bucket itself, and point
custom-domain CDN resources directly at that bucket. The default (non-custom-domain)
publish URL can skip the CDN entirely and just use the bucket's own
`https://{bucket}.website.yandexcloud.net/` endpoint over HTTPS.
