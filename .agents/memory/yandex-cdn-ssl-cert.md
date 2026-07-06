---
name: Yandex CDN SSL certificate attachment
description: Exact JSON field schema for attaching a Certificate Manager cert to a Yandex CDN resource, plus where to read DNS challenge records.
---

To attach a Certificate Manager-issued certificate to a Yandex Cloud CDN resource, the
`sslCertificate` field must be shaped as:

```json
{ "sslCertificate": { "type": "CM", "data": { "cm": { "id": "<certificateId>" } } } }
```

**Why:** Yandex's REST API docs render this as a nested `data.cm.id` oneof, which is easy
to miss — plausible-looking guesses like `cmData.id`, `cmId`, `certificateId`, or
`certificateManagerId` at the top level of `sslCertificate` all fail with a misleading
"empty CM data for CM cert type" error instead of a schema/field-name error.

To retrieve the DNS TXT challenge record for a certificate (needed before it can be
issued), call `GET /certificates/{id}?view=FULL` on the Certificate Manager API — the
default view omits `challenges`. There is no separate `/challenges` sub-resource endpoint.

**How to apply:** When integrating with Yandex CDN + Certificate Manager for custom-domain
HTTPS, use this exact schema for `sslCertificate` on CDN resource create/update (PATCH
needs `?updateMask=sslCertificate`), and always fetch certs with `view=FULL` to read
challenge data.
