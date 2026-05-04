# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Xiaohongshu (Little Red Book) AI content management tool with multi-region account management, AI content rewriting, sensitive word detection, AI image generation, file uploads, and scheduled posting.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Frontend**: React + Vite + Tailwind CSS v4 + shadcn/ui
- **Routing**: wouter
- **State**: TanStack React Query
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **AI**: OpenAI via Replit AI Integrations (gpt-4o-mini for text, dall-e-3 for images)
- **Auth**: Clerk (Replit-managed)
- **File Storage**: Replit Object Storage (GCS-backed, presigned URL uploads)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

- **xhs-tool** — Frontend React app (path: `/`, port from PORT env)
- **api-server** — Express API backend (path: `/api`, port 8080)

## Authentication

- Uses Clerk (Replit-managed) with email/password and Google login
- Frontend: `@clerk/react` with `ClerkProvider` in App.tsx
- Backend: `@clerk/express` middleware in app.ts with proxy middleware
- Landing page at `/` for unauthenticated users
- Sign-in at `/sign-in`, sign-up at `/sign-up`
- All app routes protected — redirect to `/` if not signed in
- After sign-in, redirects to `/dashboard`
- User profile + logout button in sidebar footer

## File Upload

- Object storage provisioned via Replit (GCS-backed)
- Server routes: `POST /api/storage/uploads/request-url`, `GET /api/storage/objects/*`, `GET /api/storage/public-objects/*`
- Client: `@workspace/object-storage-web` lib with `ObjectUploader` component (Uppy v5)
- Two-step flow: request presigned URL → upload directly to GCS
- Used in Assets page and Content Editor for image uploads

## AI Image Generation

- `POST /api/ai/generate-image` — generates images via DALL-E 3
- Accepts prompt, style (optional), size (1024x1024, 1024x1792, 1792x1024)
- Auto-saves generated images to object storage
- Returns both direct URL and stored object path
- Integrated in content editor and workflow wizard with Chinese prompt support

## Workflow Wizard

- Guided 4-step flow at `/workflow`: 选择账号 → 创作内容 → 预览检查 → 发布
- Step 1: Select or create XHS account with visual card selection
- Step 2: AI-assisted content creation (rewrite, title/hashtag generation, image generation/upload)
- Step 3: XHS-style preview card + sensitivity check + content stats with tips
- Step 4: One-click copy content → open XHS Creator Studio → mark as published
- Dashboard has prominent gradient CTA card linking to workflow
- Sidebar has highlighted "创建发布" nav item

## AI Guide / Assistant

- Floating chat widget on all authenticated pages (bottom-right corner)
- `POST /api/ai/guide` — context-aware XHS operations assistant (gpt-4o-mini)
- Knows current page context and provides relevant quick prompts
- Specialized in XHS platform rules, content strategy, algorithm tips
- Minimizable/closable, persists conversation during session

## Database Schema

- **accounts** — XHS accounts with region (SG/HK/MY), status, nickname
- **content** — Posts with title, body, tags, imageUrls, status (draft/published/scheduled), sensitivity info
- **assets** — Uploaded images/videos with metadata
- **schedules** — Content publishing schedule entries
- **sensitive_words** — Custom sensitive word dictionary with category and severity
- **activity_log** — Activity tracking for dashboard

## API Routes (all under /api)

- `GET/POST /accounts` — List/create accounts
- `GET/PATCH/DELETE /accounts/:id` — Account CRUD
- `GET/POST /content` — List/create content
- `GET/PATCH/DELETE /content/:id` — Content CRUD
- `POST /content/:id/schedule` — Schedule content
- `POST /content/:id/publish` — Mark content published
- `GET/POST /assets` — List/create assets
- `DELETE /assets/:id` — Delete asset
- `POST /ai/rewrite` — AI content rewriting
- `POST /ai/check-sensitivity` — Sensitivity check
- `POST /ai/generate-title` — AI title generation
- `POST /ai/generate-hashtags` — AI hashtag generation
- `POST /ai/generate-image` — AI image generation (DALL-E 3)
- `POST /ai/guide` — AI operations guide chatbot
- `GET /dashboard/stats` — Dashboard statistics
- `GET /dashboard/recent-activity` — Recent activity log
- `GET /dashboard/content-by-region` — Content distribution by region
- `GET /dashboard/content-by-status` — Content distribution by status
- `GET/POST /sensitive-words` — List/create sensitive words
- `DELETE /sensitive-words/:id` — Delete sensitive word
- `GET /schedules` — List schedules
- `DELETE /schedules/:id` — Delete schedule
- `POST /storage/uploads/request-url` — Request presigned upload URL
- `GET /storage/objects/*` — Serve uploaded objects
- `GET /storage/public-objects/*` — Serve public assets

## Frontend Pages

- `/` — Landing page (unauthenticated) / redirect to dashboard (authenticated)
- `/sign-in` — Clerk sign-in page (Chinese localized)
- `/sign-up` — Clerk sign-up page (Chinese localized)
- `/dashboard` — Dashboard with stats, workflow CTA, region/status charts, recent activity
- `/workflow` — Guided 4-step create & publish wizard
- `/accounts` — Account management with region filter, CRUD
- `/content` — Content list with status/region filters
- `/content/new` — Content editor with AI tools (rewrite, sensitivity, title/hashtag, image generation)
- `/content/:id` — Edit existing content
- `/assets` — Asset library with file upload (ObjectUploader)
- `/schedules` — Publishing schedule view
- `/sensitive-words` — Sensitive word dictionary management
- `/settings` — System configuration info

## UI Language

All UI text is in Simplified Chinese (简体中文).
