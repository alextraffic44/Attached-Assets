# AGENTS.md

Project overview and architecture live in `replit.md`. Per-topic gotchas live in `.agents/memory/`.
Craft AI is a full-stack AI website builder: Express (TypeScript) backend + React/Vite frontend + PostgreSQL (Drizzle ORM). A single Express process serves both the API and (in dev) the Vite middleware on **one port (5000)**.

## Cursor Cloud specific instructions

### Services

- Single service: `npm run dev` runs `tsx server/index.ts`, which serves the API **and** the Vite dev client on `http://localhost:5000` (`PORT`, default 5000). There is no separate frontend server.
- Requires a running PostgreSQL and `DATABASE_URL`. AI features additionally need API keys (see Env vars), but the app boots and all core CRUD/auth flows work without them.

### Startup (run each session before `npm run dev`)

- PostgreSQL is NOT auto-started in a fresh VM. Start it with: `sudo pg_ctlcluster 16 main start`.
- The local dev database `craftai` (role `craft`/`craft`) and `DATABASE_URL` are provisioned during environment setup; `DATABASE_URL` is exported from `~/.bashrc`. If the DB is missing (fresh cluster), recreate it:
  `sudo -u postgres psql -c "CREATE ROLE craft LOGIN PASSWORD 'craft';" -c "CREATE DATABASE craftai OWNER craft;"`
- Apply the schema with `npm run db:push` (drizzle-kit). This is idempotent and safe to re-run.
- The app has **no dotenv loader**; env vars must be exported in the shell (that's why `DATABASE_URL` lives in `~/.bashrc`).

### Lint / type-check / build

- `npm run check` (`tsc`) currently FAILS on the pristine repo — `tsconfig.json` sets no `target` (defaults to ES5), producing pre-existing `downlevelIteration`/strict-mode errors. This is not caused by environment setup. The dev server and build use `tsx`/`esbuild`, which transpile without type-checking, so the app runs regardless. Do not "fix" these unless the task asks for it.
- `npm run build` (`tsx script/build.ts`) does a production Vite client build + esbuild server bundle into `dist/`. For development use `npm run dev`, not the build.

### Object storage

- Uploads are stored on the local filesystem, defaulting to `/data/storage` (`PRIVATE_OBJECT_DIR` / `PUBLIC_OBJECT_SEARCH_PATHS` override). `/data` may not exist/writable in the VM; this only matters when actually uploading/generating media, not for boot or core CRUD.

### Env vars / secrets (all optional for boot; needed only for the named feature)

- `DATABASE_URL` — required (set during setup).
- `GEMINI_API_KEY` — Gemini deep research/other Gemini calls.
- `KIE_API_KEY` — Claude/GPT-Image/Nano-Banana code & image generation.
- `WAVESPEED_API_KEY` — 3D model generation.
- `TELEGRAM_BOT_TOKEN`, `VITE_YANDEX_CLIENT_ID` — social login.
- `SESSION_SECRET` — required only in production (`NODE_ENV=production`).
