# Craft AI — agent working rules

## Source of truth

- **`main` is the only production source of truth.**
- Amvera (`attached-assets`) must be deployed **from `main`**, never from a feature branch that forked before previous work landed.
- Open draft PRs that were never merged do **not** count as shipped — if it is not on `main`, the next feature branch will overwrite it on Amvera.

## Required workflow for every change

1. Branch from **up-to-date `main`**: `git fetch origin && git checkout -b cursor/<name>-1645 origin/main`
2. Implement + commit on the feature branch.
3. Open a PR → get it **merged into `main`** (draft is fine while working; merge before deploy).
4. Deploy Amvera **only after merge**, from `main`:
   ```bash
   git checkout main && git pull origin main
   python3 scripts/deploy-amvera.py
   ```
5. Do **not** upload random files from a feature branch that is behind `main`.

## Why previous deploys “rolled back”

Amvera stores the last uploaded version of each file. Uploading `dashboard.tsx` / `routes.ts` / `editor.tsx` from a branch based on stale `main` silently replaces earlier fixes that lived only on Amvera.

## Hot files (extra care)

These are touched by most features — merge conflicts here are expected; never “force upload” an older copy:

- `client/src/pages/dashboard.tsx`
- `client/src/pages/editor.tsx`
- `server/routes.ts`
- `server/auth.ts`
