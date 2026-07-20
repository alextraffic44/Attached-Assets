# Craft AI — ИИ-конструктор сайтов

## Overview
AI-powered website builder that generates HTML/CSS/JS websites from text prompts, templates, or screenshots. Built with React + Express + PostgreSQL + Gemini AI.

## Architecture
- **Frontend**: React with Tailwind CSS, Framer Motion, shadcn/ui components
- **Backend**: Express.js with session-based authentication (Passport.js)
- **Database**: PostgreSQL with Drizzle ORM
- **AI Code (new site)**: Claude Sonnet 5 via KIE API (KIE_API_KEY env var, POST https://api.kie.ai/claude/v1/messages, Anthropic Messages API shape — `system` field + `messages` array, `max_tokens`, `thinkingFlag`, streaming SSE with `content_block_delta`/`text_delta` events, manual conversation history)
- **AI Code (edit)**: Claude Sonnet 5 via KIE API for editing with SEARCH/REPLACE diff patches (falls back to full HTML if needed); base64 images stripped before sending to reduce context size
- **"Профессионал" mode (formerly "По фото" / Mockup Mode)**: Dashboard start mode + in-editor toggle for attaching reference images. Supports MULTIPLE reference images (up to 5) — any mix of design-reference screenshots (competitor sites, mockups) and/or real product/brand/person photos. AI is given MAXIMUM CREATIVE FREEDOM (no pixel-perfect/exact-recreation rules) — treats references as inspiration only, and is free to improve layout, copy, and visual details.
- **Two-Step Mockup Analysis**: Step 1 extracts a JSON design spec (colors, typography, layout, sections, effects) via a separate KIE sync call, plus a `reference_photos` array describing EACH attached image with its role (`design_reference` vs `product_photo`/`logo`/`person`/`brand_asset`); Step 2 uses that analysis as inspiration (not a strict blueprint) to generate the site
- **Reference-aware image generation (REF markers)**: When the AI decides a generated site photo should feature the user's actual uploaded product/brand/person (not an invented stock photo), it emits `{{GENIMG:<prompt>|<ratio>|REF<n>}}` (or `REF<n>,<m>` for multiple refs) where `<n>` is the 1-based index of the reference image (matching upload/`reference_photos` order). `resolveGenImgMarkers` resolves `REF` indices against the reference image URLs passed in and calls `generateGptImage` with `refUrls`, which switches KIE model to `gpt-image-2-image-to-image` (`input_urls`) for true image-to-image generation — preserving the real product/brand/person while placing it in a new professional scene. Markers without `REF` use plain text-to-image as before. This mirrors the "Интерактивный" mode's `generateProductStill` pattern but generalized to any GENIMG marker.
- **AI Enhance**: Claude Sonnet 5 via KIE API for prompt enhancement (5 tokens)
- **Deep Research**: Gemini Interactions API with deep-research-pro-preview-12-2025 agent (10 tokens, optional toggle)
- **AI Images**: GPT Image-2 (primary) via KIE API (model `gpt-image-2-text-to-image`, 2K resolution, 15 tokens); falls back to Nano Banana 2 on creation error or when reference images provided (gpt-image-2 is text-to-image only)
- **AI 3D Models**: Hunyuan3D V3 via WaveSpeed API (WAVESPEED_API_KEY env var, image-to-3D, GLB output, 100 tokens)
- **Интерактивный режим (3D Sexy Scroll)**: dashboard start option that auto-generates a cinematic scroll-bound animation. Two-step pipeline: (1) `generateStillForVideo` creates a photorealistic 16:9 still via `nano-banana-2` (returns raw CDN URL); (2) `generateScrollFrames` feeds that URL + motion prompt to `kling/v3-turbo-image-to-video` → polls for mp4 → slices with fluent-ffmpeg into ~90 WebP frames (sharp) stored in Object Storage → injects self-contained Canvas section bound to scroll progress with fade-in/out text layers. 120 tokens per animation. Mirrors the {{GENIMG}} marker system via `{{SCROLLANIM:videoPrompt|T1::S1||T2::S2||T3::S3}}`, auto-injected right under the Hero. Every marker is always finalized (static text fallback on failure/out-of-credits — no marker ever leaks). Retry: up to 3 attempts on API `fail` state; overall 40-min deadline. When the user uploads a product photo (split mode), `generateProductStill` first regenerates it onto a solid/monochrome background (product on the RIGHT) via the `gpt-image-2-image-to-image` model (`input_urls` reference array), and that regenerated still — not the raw photo — becomes the Kling source, so the video always has a clean uniform background. It runs once, only after the credit deduction succeeds. Helpers in `server/routes.ts`: `generateProductStill`, `generateStillForVideo`, `generateScrollFrames`, `buildScrollAnimHtml`, `scrollAnimFallbackHtml`, `resolveScrollAnimMarkers`.
- **Generations Library**: Button in editor header shows all project's generated images and 3D models; items can be added to chat or deleted
- **Auto-save to Object Storage**: Generated images (Nano Banana) are automatically downloaded from CDN, re-uploaded to Object Storage, and saved to project_images; 3D models also auto-saved on download
- **Gemini Retry**: Auto-retry on 503/429 errors (up to 3 attempts with 3/6/9s delays)
- **3D Upload**: GLB/GLTF files (max 50MB) uploaded via chat → stored in Object Storage → AI embeds via `<model-viewer>` tag
- **Routing**: wouter for client-side routing

## Pages
- `/admin` — Admin panel (только для user ID=1): статистика, список пользователей, история транзакций, начисление/списание токенов, проекты пользователя
- `/` — Landing page with features and pricing
- `/auth` — Login/Register with email + password
- `/dashboard` — User's projects list with create modal + leads/generations buttons
- `/generations` — All user's AI-generated images across all projects
- `/leads` — Leads management page (all form submissions from generated sites)
- `/oferta` — Договор публичной оферты (legal)
- `/privacy` — Политика конфиденциальности (legal, 152-ФЗ)
- `/terms` — Пользовательское соглашение (legal)
- `/editor/:id` — Split-pane editor: chat (left) + live preview (right)

## Database Schema
- `users` — id, email, password, displayName, credits, plan, createdAt
- `projects` — id, userId, title, description, generatedCode, geminiInteractionId, createdAt, updatedAt
- `project_messages` — id, projectId, role, content, createdAt
- `project_images` — id, projectId, name, url, prompt, createdAt (named image library)
- `project_versions` — id, projectId, code, label, createdAt (version history/rollback)
- `project_files` — id, projectId, filename, code, createdAt (multi-page support: extra HTML files beyond index.html)
- `leads` — id, projectId, name, email, phone, message, source, isRead, createdAt (form submissions from generated sites)
- `payment_orders` — id, userId, amount, tokens, status, orderId, paymentUrl, createdAt, paidAt
- `session` — auto-managed by connect-pg-simple

## Key Features
- Text-to-website generation via Gemini 3.1 Pro with premium design system prompt
- "Интерактивный" start mode: auto-generated scroll-bound Canvas animation ("3D Sexy Scroll") injected under the Hero (KIE video → ffmpeg frames → Object Storage → Canvas)
- Auto web research before first generation (Google Search grounding, 7+ sources)
- High-end design output: Awwwards-level quality with scroll animations, glassmorphism, noise textures, deep shadows
- "Профессионал" start mode: multi-reference-image (design screenshots + product/brand photos) to website with full creative freedom (Vision API)
- Video upload support: attach video files in chat → uploaded to object storage → AI embeds `<video>` tags (mp4/webm/mov/ogg, max 100MB)
- Manual AI image generation via Nano Banana 2 (create task → poll → insert into HTML, 2K resolution, 10 tokens)
- Named image library with {{IMG:name}} marker system
- Styled gradient placeholder blocks for images (users replace via AI generator or upload)
- Visual WYSIWYG editor: inline text editing + image replacement via popup picker
- Image picker dialog: choose from generated library or upload from PC
- Live preview with responsive device switching
- Multi-page website support: separate HTML files per page with file tabs in editor
- Inter-page navigation: links like `about.html` switch tabs, work in preview and export
- Chat-based iterative editing with version history
- ZIP export with all pages and images as local files (images/ folder)
- Auto-save before each generation (version history)
- Credit-based usage system

## API Endpoints (Images)
- `POST /api/images/generate` — Create Nano Banana image task (prompt, imageSize, outputFormat)
- `GET /api/images/status/:taskId` — Poll task status (waiting/success/fail)
- `POST /api/projects/:id/insert-image` — Insert image URL into project code (modes: replace-first-placeholder, replace-all-placeholders, append)

## API Endpoints (Интерактивный / Scroll Animation)
- Auto path: send `interactiveMode: true` to `POST /api/projects/:id/generate` (set via dashboard "Интерактивный" card → `?interactive=1`); the model emits a `{{SCROLLANIM:...}}` marker that `resolveScrollAnimMarkers` resolves after `resolveGenImgMarkers` (max 2 blocks/site, 120 tokens each, idempotency-keyed deduct + refund-on-failure)
- `POST /api/generate-scroll-assets` — Standalone: { prompt, idempotencyKey } → renders video, slices frames, returns { frames, count, creditsUsed, newBalance } (120 tokens; refunds only when actually billed, never on idempotent replay)

## API Endpoints (3D Models)
- `POST /api/3d/generate` — Create WaveSpeed 3D task (imageUrl, enablePbr, generateType, faceCount) — 20 tokens
- `GET /api/3d/status/:taskId` — Poll task status (waiting/success/fail), returns GLB URL on success

## API Endpoints (Leads)
- `POST /api/leads/:projectId` — Public endpoint, generated sites POST form data here (no auth)
- `GET /api/leads` — Get all leads for current user across all projects
- `GET /api/leads/unread-count` — Get unread lead count for badge display
- `PATCH /api/leads/:id/read` — Mark a lead as read
- `DELETE /api/leads/:id` — Delete a lead

## API Endpoints (Payments)
- `POST /api/payments/create` — Create 1payment SBP payment form (price), returns { url, orderId }
- `POST /api/payments/webhook` — Webhook from 1payment (status 3=success, 4=fail), credits tokens
- `GET /api/payments/history` — Get user's payment orders

## Payment System (1payment SBP)
- 4 token packages: Старт (1000/990₽), Базовый (1900/1690₽), Профи (4500/3990₽), Ультра (10000/9990₽)
- Flow: user clicks package → backend creates order + calls 1payment init_form → user redirected to SBP payment page → 1payment sends webhook → tokens credited
- Sign: MD5 of "init_form" + sorted params + API key
- Env vars: ONEPAYMENT_PARTNER_ID, ONEPAYMENT_PROJECT_ID, ONEPAYMENT_API_KEY
- DB table: `payment_orders` (id, userId, amount, tokens, status, orderId, paymentUrl, createdAt, paidAt)
- Webhook URL: configured in 1payment dashboard → `https://craft-ai.ru/api/payments/webhook`

## Leads System
- SYSTEM_PROMPT instructs Gemini to generate forms with `data-lead-form` attribute
- Forms POST to `/api/leads/:projectId` with { name, email, phone, message, source }
- `window.__PROJECT_ID__` is injected into iframe via `injectProjectId()` in editor
- Dashboard shows unread lead count badge, `/leads` page shows full lead management

## Publishing (Yandex Object Storage + Timeweb Caddy proxy for custom domains)
- Button "Опубликовать" in editor header → publish modal
- `POST /api/projects/:id/publish` — deploys to a dedicated Yandex Object Storage bucket (`craft-ai-p{projectId}`) with static website hosting enabled, uploads all pages + images; if the project has a custom domain, files are also mirrored into the domain-named bucket
- `POST /api/projects/:id/unpublish` — suspends site (overwrites bucket(s) with "suspended" placeholder page)
- Default publish URL (no custom domain): `https://craft-ai-p{projectId}.website.yandexcloud.net/` — served directly from Object Storage
- **Custom domains (NO CDN, no Certificate Manager)**: bucket-per-domain + Caddy reverse proxy with on-demand TLS
  - `POST /api/projects/:id/domain` — stores apex domain (www stripped, ≤63 chars, uniqueness across projects → 409), creates a Yandex bucket named exactly the apex domain (website hosting on), copies project files into it, returns `{ verified, aRecordIp }`
  - User adds two DNS **A records**: `@` and `www` → `DOMAIN_PROXY_IP` (env var, currently 45.153.69.131)
  - `GET /api/projects/:id/domain/status` — resolve4 == DOMAIN_PROXY_IP → `dnsReady`, then HEAD `https://{domain}` (25s) → `verified`; returns `aRecordIp`
  - `GET /api/domains/check?domain=` — PUBLIC Caddy "ask" endpoint: 200 for apex+www of any known custom domain (incl. suspended), 404 otherwise; rejects deeper subdomains
  - Timeweb VPS (ID 8611593, IP 45.153.69.131, Ubuntu 24.04, 1CPU/1GB, ~207₽/mo, ru-2) runs Caddy: on-demand TLS (Let's Encrypt per domain, issued on first request after ask-approval), www→apex 308 redirect, `reverse_proxy https://website.yandexcloud.net` with `header_up Host {host}.website.yandexcloud.net` (bucket name == apex domain). Config: `/etc/caddy/Caddyfile`; SSH key `craft-ai-agent` registered in Timeweb (key id 719979)
  - IMPORTANT: cert issuance only works when production `craft-ai.ru` serves `/api/domains/check` — requires prod redeploy after this change
- Env vars/secrets required: `YC_FOLDER_ID`, `YC_KEY_ID`, `YC_SECRET` (S3-compatible static keys for Object Storage), `DOMAIN_PROXY_IP` (Caddy VPS IP), `TIMEWEB_API_TOKEN` (VPS management). `YC_SERVICE_ACCOUNT_KEY` no longer used by publish code (CDN/CM removed)
- Published URL stored in `projects.published_url`, status in `projects.publish_status`, bucket name stored in `projects.vercel_project_id` (column name kept from the earlier Vercel/Netlify integration, now holds the Yandex bucket name)
- Publish statuses: `draft`, `publishing`, `published`, `suspended`, `error`
- Dashboard cards show green "Live" badge when published, red "Приостановлен" when suspended
- Editor button changes to "Опубликован" with green checkmark when published
- Yandex helper: `server/yandex-deploy.ts` (`deployFilesToBucket`, `deployToYandex(projectId, files, customDomain?)`, `unpublishFromYandex`, `addCustomDomain`, `removeCustomDomain`, `checkDomainStatus`, `deleteProjectFromYandex`)

## Publish Limits & Billing
- No per-plan limit on number of published sites (all tariffs can publish unlimited sites)
- Daily cost: 35 tokens per published site, charged at 03:00 via setInterval/setTimeout cron
- If user has insufficient balance: sites are suspended (unpublished from Yandex Cloud with placeholder page)
- Suspended sites can be re-published when user tops up balance
- `DAILY_PUBLISH_COST` constant in server/routes.ts

## Tech Stack Details
- Auth: express-session + passport-local + scrypt hashing
- Session store: connect-pg-simple (PostgreSQL)
- ZIP: JSZip (client-side)
- Streaming: Server-Sent Events for generation progress

## Object Storage
- All uploaded images stored in Replit Object Storage (GCS-backed, persistent)
- `uploadToObjectStorage()` helper in routes.ts saves buffer to bucket, returns `/objects/uploads/uuid.ext` URL
- `/objects/*` route serves files from object storage via `ObjectStorageService`
- Old `/uploads/` static folder kept for backward compatibility with existing images
- Integration: `server/replit_integrations/object_storage/`

## Important Files
- `shared/schema.ts` — Database schema and types
- `server/routes.ts` — API endpoints
- `server/auth.ts` — Authentication setup
- `server/storage.ts` — Database CRUD operations
- `server/db.ts` — Database connection
- `server/replit_integrations/object_storage/` — Object storage integration
- `client/src/lib/auth.tsx` — Auth context/hook
- `client/src/pages/` — All page components
