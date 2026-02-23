# НейроЗодчий — ИИ-конструктор сайтов

## Overview
AI-powered website builder that generates HTML/CSS/JS websites from text prompts, templates, or screenshots. Built with React + Express + PostgreSQL + Gemini AI.

## Architecture
- **Frontend**: React with Tailwind CSS, Framer Motion, shadcn/ui components
- **Backend**: Express.js with session-based authentication (Passport.js)
- **Database**: PostgreSQL with Drizzle ORM
- **AI**: Gemini 2.5 Flash via Replit AI Integrations (no API key needed)
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
- `session` — auto-managed by connect-pg-simple

## Key Features
- Text-to-website generation via Gemini AI
- Photo/screenshot to website (Vision API)
- Template-based generation
- Live preview with responsive device switching
- Chat-based iterative editing
- ZIP export with separate HTML/CSS/JS files
- Credit-based usage system

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
