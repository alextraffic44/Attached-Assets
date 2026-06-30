---
name: Stale-deployment diagnosis (Craft AI)
description: How to tell the user is testing an old published build, not current code — before chasing "my fix didn't work" ghosts.
---

# Stale-deployment diagnosis

When the user reports "your change didn't appear / it still looks broken," first decide WHETHER THEY ARE EVEN LOOKING AT CURRENT CODE before re-investigating the code.

**Decisive tell:** if the user's screenshot/quote contains UI text (or behavior) that does NOT exist anywhere in the current source, they are on a stale build — almost always the published `.replit.app` / custom-domain deployment, not the dev preview. Grep the exact visible string; if source has a different string, the running bundle is old.

**Why:** this app has a separate production deployment (Netlify-published sites + the Replit-deployed app at a custom domain). Dev-only edits never reach the user's tested URL until a redeploy. Multiple rounds were wasted "fixing" things that were already correct in dev because the user was testing old code.

**How to apply:**
1. Grep the literal text the user sees. Mismatch with source ⇒ stale bundle ⇒ stop debugging code, redeploy.
2. After confirming dev is correct, redeploy the app AND tell the user to regenerate/rebuild any previously generated SEO sites — old generated_code/project_files were produced by the old builder and won't pick up new CSS/images until regenerated.
3. Only dig into the code path itself once you've confirmed the user is actually on the current build.
