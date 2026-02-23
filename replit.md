# НейроЗодчий — ИИ-конструктор сайтов

## Overview
AI-powered website builder that generates HTML/CSS/JS websites from text prompts, templates, or screenshots. Built with React + Express + PostgreSQL + Gemini AI.

## Architecture
- **Frontend**: React with Tailwind CSS, Framer Motion, shadcn/ui components
- **Backend**: Express.js with session-based authentication (Passport.js)
- **Database**: PostgreSQL with Drizzle ORM
- **AI Code**: Gemini 3.1 Pro via Replit AI Integrations (@google/genai SDK)
- **AI Images**: Nano Banana via KIE API (KIE_API_KEY env var, async task-based)
- **Web Research**: Gemini with Google Search grounding (auto-research before first generation)
- **Routing**: wouter for client-side routing

## Pages
- `/` — Landing page with features and pricing
- `/auth` — Login/Register with email + password
- `/dashboard` — User's projects list with create modal
- `/editor/:id` — Split-pane editor: chat (left) + live preview (right)

## Database Schema
- `users` — id, email, password, displayName, credits, plan, createdAt
- `projects` — id, userId, title, description, generatedCode, createdAt, updatedAt
- `project_messages` — id, projectId, role, content, createdAt
- `project_images` — id, projectId, name, url, prompt, createdAt (named image library)
- `project_versions` — id, projectId, code, label, createdAt (version history/rollback)
- `session` — auto-managed by connect-pg-simple

## Key Features
- Text-to-website generation via Gemini 3.1 Pro
- Auto web research before first generation (Google Search grounding, 7+ sources)
- Auto image generation: Gemini outputs {{GENERATE_IMG:prompt||WxH}} markers, system auto-generates via KIE API
- Photo/screenshot to website (Vision API)
- Manual AI image generation via Nano Banana (create task → poll → insert into HTML)
- Named image library with {{IMG:name}} marker system
- Template-based generation
- Live preview with responsive device switching
- Chat-based iterative editing
- ZIP export with all images as local files (images/ folder)
- Version history with manual checkpoints and auto-save before each generation
- One-click rollback to any previous version
- Credit-based usage system

## API Endpoints (Images)
- `POST /api/images/generate` — Create Nano Banana image task (prompt, imageSize, outputFormat)
- `GET /api/images/status/:taskId` — Poll task status (waiting/success/fail)
- `POST /api/projects/:id/insert-image` — Insert image URL into project code (modes: replace-first-placeholder, replace-all-placeholders, append)

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
