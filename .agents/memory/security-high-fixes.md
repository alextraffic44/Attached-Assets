---
name: Security high fixes (refund idempotency, SVG proxy, Yandex origin, merchant_price)
description: Closes remaining HIGH audit items except ADMIN_TELEGRAM_ID hardcode
---

## Fixes
1. **refundCredits(userId, amount, idempotencyKey?)** — credits at most once per `refund:key`, renames original debit key so replay of the same key charges again (no free retry after refund).
2. **proxy-image / proxy-base64** — allow only png/jpeg/webp/gif; reject SVG; `X-Content-Type-Options: nosniff`.
3. **Yandex OAuth** — popup posts `{type:'yandex_oauth', hash}` to `window.location.origin` only; auth page checks `event.origin` + message shape.
4. **Payment webhook** — for status=3 (paid), `merchant_price` is required and must match `order.amount`.

Skipped by request: hardcoded `ADMIN_TELEGRAM_ID` fallback.
