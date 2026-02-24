# НейроЗодчий — ИИ-конструктор сайтов

## Overview
AI-powered website builder that generates HTML/CSS/JS websites from text prompts, templates, or screenshots. Built with React + Express + PostgreSQL + Gemini AI.

## Architecture
- **Frontend**: React with Tailwind CSS, Framer Motion, shadcn/ui components
- **Backend**: Express.js with session-based authentication (Passport.js)
- **Database**: PostgreSQL with Drizzle ORM
- **AI Code**: Gemini 3.1 Pro via direct official API (@google/genai SDK, GEMINI_API_KEY env var, thinkingConfig support)
- **AI Images**: Nano Banana via KIE API (KIE_API_KEY env var, async task-based)
- **Web Research**: Gemini with Google Search grounding (auto-research before first generation)
- **Routing**: wouter for client-side routing

## Pages
- `/` — Landing page with features and pricing
- `/auth` — Login/Register with email + password
- `/dashboard` — User's projects list with create modal + leads button with unread badge
- `/leads` — Leads management page (all form submissions from generated sites)
- `/editor/:id` — Split-pane editor: chat (left) + live preview (right)

## Database Schema
- `users` — id, email, password, displayName, credits, plan, createdAt
- `projects` — id, userId, title, description, generatedCode, createdAt, updatedAt
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
- Manual AI image generation via Nano Banana (create task → poll → insert into HTML)
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

## Tech Stack Details
- Auth: express-session + passport-local + scrypt hashing
- Session store: connect-pg-simple (PostgreSQL)
- ZIP: JSZip (client-side)
- Streaming: Server-Sent Events for generation progress

## Important Files
- `shared/schema.ts` — Database schema and types
- `server/routes.ts` — API endpoints
- `server/auth.ts` — Authentication setup
- `server/storage.ts` — Database CRUD operations
- `server/db.ts` — Database connection
- `client/src/lib/auth.tsx` — Auth context/hook
- `client/src/pages/` — All page components
