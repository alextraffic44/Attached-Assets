# Craft AI — ИИ-конструктор сайтов

## Overview
AI-powered website builder that generates HTML/CSS/JS websites from text prompts, templates, or screenshots. Built with React + Express + PostgreSQL + Gemini AI.

## Architecture
- **Frontend**: React with Tailwind CSS, Framer Motion, shadcn/ui components
- **Backend**: Express.js with session-based authentication (Passport.js)
- **Database**: PostgreSQL with Drizzle ORM
- **AI Code (new site)**: Gemini 3.1 Pro via direct API (@google/genai SDK, GEMINI_API_KEY env var, generateContentStream, manual conversation history)
- **AI Code (edit)**: Gemini 3.1 Pro for editing with SEARCH/REPLACE diff patches (falls back to full HTML if needed); base64 images stripped before sending to reduce context size
- **Design-to-Code (Mockup Mode)**: Toggle in chat when images attached — sends specialized prompt to Gemini Vision to analyze screenshot/mockup and recreate exact layout as HTML/CSS/JS (not embed as img)
- **Two-Step Mockup Analysis**: Step 1 extracts detailed JSON design spec (colors, typography, layout, sections, effects) via separate Gemini call; Step 2 uses that structured analysis to generate pixel-perfect code
- **AI Enhance**: Gemini 2.5 Flash for prompt enhancement (5 tokens)
- **Deep Research**: Gemini Interactions API with deep-research-pro-preview-12-2025 agent (10 tokens, optional toggle)
- **AI Images**: Nano Banana 2 via KIE API (KIE_API_KEY env var, async task-based, 2K resolution, 15 tokens)
- **AI 3D Models**: Hunyuan3D V3 via WaveSpeed API (WAVESPEED_API_KEY env var, image-to-3D, GLB output, 100 tokens)
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
- `session` — auto-managed by connect-pg-simple

## Key Features
- Text-to-website generation via Gemini 3.1 Pro with premium design system prompt
- Auto web research before first generation (Google Search grounding, 7+ sources)
- High-end design output: Awwwards-level quality with scroll animations, glassmorphism, noise textures, deep shadows
- Photo/screenshot to website (Vision API)
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

## API Endpoints (3D Models)
- `POST /api/3d/generate` — Create WaveSpeed 3D task (imageUrl, enablePbr, generateType, faceCount) — 20 tokens
- `GET /api/3d/status/:taskId` — Poll task status (waiting/success/fail), returns GLB URL on success

## API Endpoints (Leads)
- `POST /api/leads/:projectId` — Public endpoint, generated sites POST form data here (no auth)
- `GET /api/leads` — Get all leads for current user across all projects
- `GET /api/leads/unread-count` — Get unread lead count for badge display
- `PATCH /api/leads/:id/read` — Mark a lead as read
- `DELETE /api/leads/:id` — Delete a lead

## Leads System
- SYSTEM_PROMPT instructs Gemini to generate forms with `data-lead-form` attribute
- Forms POST to `/api/leads/:projectId` with { name, email, phone, message, source }
- `window.__PROJECT_ID__` is injected into iframe via `injectProjectId()` in editor
- Dashboard shows unread lead count badge, `/leads` page shows full lead management

## Publishing (Vercel)
- Button "Опубликовать" in editor header → publish modal
- `POST /api/projects/:id/publish` — deploys to Vercel via API, uploads all pages + images
- `POST /api/projects/:id/unpublish` — suspends site (deploys "suspended" placeholder)
- `POST /api/projects/:id/domain` — add custom domain to Vercel project
- `GET /api/projects/:id/domain/status` — check domain verification status
- `VERCEL_TOKEN` secret + `VERCEL_TEAM_ID` env var required
- Published URL stored in `projects.published_url`, status in `projects.publish_status`
- Publish statuses: `draft`, `publishing`, `published`, `suspended`, `error`
- Dashboard cards show green "Live" badge when published, red "Приостановлен" when suspended
- Editor button changes to "Опубликован" with green checkmark when published
- Vercel helper: `server/vercel-deploy.ts`

## Publish Limits & Billing
- Plan limits: bronze=1 site, silver=2, gold=3, platinum=5
- Publish endpoint checks current published count vs plan limit before allowing new publish
- Daily cost: 20 tokens per published site, charged at 03:00 via setInterval/setTimeout cron
- If user has insufficient balance: sites are suspended (unpublished from Vercel with placeholder page)
- Suspended sites can be re-published when user tops up balance
- `PLAN_PUBLISH_LIMITS` and `DAILY_PUBLISH_COST` constants in server/routes.ts

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
