---
name: Security invariants (Craft AI)
description: Non-obvious security constraints that must hold across auth, body parsing, payments, and outbound fetch — easy to silently break.
---

# Security invariants

This app stores per-user data (projects, leads, images, files). The following are deliberate decisions; breaking them silently reintroduces real vulnerabilities.

## Auth + ownership
- Every `/api/*` route (except explicitly public ones) must require an authenticated session AND verify resource ownership (`resource.project.userId === req.user.id`), not just authentication.
- **Why:** the codebase once shipped a middleware that impersonated a fixed user for ALL requests, and the frontend's route-guard component existed but was never wired in — so the entire app silently ran with no real auth. A future "simplification" of auth must never add a shared/default-user fallback.
- **How to apply:** when adding a route that takes an `:id` / `projectId` / child id, load the parent, confirm ownership, and 403/404 before any read/write. Child-resource deletes/creates (images, files, models) must confirm the child belongs to the owned project — do not trust the child id alone.
- Public, intentionally-unauthenticated routes: the lead intake `POST /api/leads/:projectId` (sites submit forms here) and the payment webhook. Everything else is private.

## Body parsing
- Global JSON/urlencoded limit is intentionally small (1mb). A large-body parser (~50mb) is applied ONLY to the base64-heavy upload routes (image upload, project save).
- **Why:** unbounded large JSON on every route is a DoS/memory vector; only a couple of routes legitimately need big payloads.
- **How to apply:** a new route that accepts base64/images must be added to the large-body allowlist or it will 413. Do NOT raise the global limit to "fix" it.

## Payment webhook raw body
- The 1payment webhook signature is verified against the RAW request body. The body-parser `verify` callback that captures rawBody must remain on whatever parser handles the webhook path.
- **Why:** re-serialized JSON changes byte order/spacing and breaks MD5 signature verification, silently rejecting (or worse, mis-trusting) callbacks.

## Outbound fetch / SSRF
- Any endpoint that fetches a user-supplied URL (image proxy, base64 proxy) must pass the URL through the public-URL guard first: http/https only, block localhost/.internal/.local hostnames and private/loopback/link-local/CGNAT/cloud-metadata IPs via DNS resolution. Then fetch with `redirect:"error"`, an AbortController timeout, an `image/*` content-type check, and a size cap.
- **Residual (accepted):** DNS-rebinding/TOCTOU — the guard resolves DNS, then `fetch` re-resolves at connect time. Closing it fully needs a connect-time lookup (undici Agent custom `lookup`). Not added because it couldn't be verified in-sandbox (external DNS hangs) and risks breaking image proxying. Recommended follow-up if SSRF hardening is revisited.
- **Preferred pattern when feasible — read your own bytes, don't fetch:** the SCROLLANIM creative-concept vision step needs the product image bytes. Instead of HTTP-fetching the (user-controllable) product URL, it reads ONLY `/objects/...` paths straight from object storage by entity id (host part ignored), size-capped via metadata before download. Non-`/objects/` URLs are skipped (graceful fallback to the generic prompt), so there is NO server-side fetch of an external URL and thus no SSRF/redirect/rebind surface at all. **Why:** uploaded photos always live under `/objects/`, so the external-fetch branch was pure attack surface with no real benefit. Prefer this over re-hardening a `fetch` whenever the bytes are something we already host.

## Environment quirks (this repo)
- `npx tsc --noEmit` and `npx tsx <one-off-script>` are too slow / time out on this project — verify changes by restarting the workflow and curling the running server instead.
- Dev script runs `tsx server/index.ts` with NO watch — you MUST restart the `Start application` workflow after any server edit.
- External DNS lookups hang in the sandbox; don't write tests that depend on reaching the public internet.
