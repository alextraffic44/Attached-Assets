---
name: Netlify deploy error surfacing
description: How Netlify reports deploy/site errors and what a 403 "credit usage exceeded" actually means.
---

# Netlify deploy error surfacing

Publishing uses Netlify (`NETLIFY_TOKEN`), even though replit.md still mentions Vercel and the DB
column is `vercelProjectId`. `server/netlify-deploy.ts` `ensureSite()` (site create) and
`deployToNetlify()` (deploy create) call the Netlify API.

**Error fields:** Netlify does NOT always use `message`. It may return `error` (a string) or
`errors` (object). Always read `message || error || JSON.stringify(errors)` before falling back to
the bare status, or you surface a cryptic "Netlify deploy error: 403". The publish endpoint forwards
`err.message` straight to the client modal, so a clear thrown message reaches the user.

**403 "Account credit usage exceeded - new deploys are blocked until credits are added":** this is an
ACCOUNT-LEVEL billing block on the shared Netlify account — NOT a bug in the site or animated
content, and not specific to animated sites. The only resolution is adding credits to the Netlify
account. Code maps this case (regex on credit/usage/exceeded/blocked/payment/billing) to a friendly
Russian message telling the user to top up the Netlify balance.

**How to apply:** when defensively parsing Netlify responses with `.json().catch(()=>null)`, also
guard `!deploy?.id` / `!site?.id` before dereferencing — a malformed 2xx body would otherwise
null-deref. To read the real reason from prod, grep deployment logs for `[Netlify deploy] Error`.
