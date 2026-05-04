# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Xiaohongshu (Little Red Book) AI content management tool with multi-region account management, AI content rewriting, sensitive word detection, and scheduled posting.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui
- **Routing**: wouter
- **State**: TanStack React Query
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **AI**: OpenAI via Replit AI Integrations
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

## Database Schema

- **accounts** — XHS accounts with region (SG/HK/MY), status, nickname
- **content** — Posts with title, body, tags, status (draft/published/scheduled), sensitivity info
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
- `GET /dashboard/stats` — Dashboard statistics
- `GET /dashboard/recent-activity` — Recent activity log
- `GET /dashboard/content-by-region` — Content distribution by region
- `GET /dashboard/content-by-status` — Content distribution by status
- `GET/POST /sensitive-words` — List/create sensitive words
- `DELETE /sensitive-words/:id` — Delete sensitive word
- `GET /schedules` — List schedules
- `DELETE /schedules/:id` — Delete schedule

## Frontend Pages

- `/` — Dashboard with stats, region/status charts, recent activity
- `/accounts` — Account management with region filter, CRUD
- `/content` — Content list with status/region filters
- `/content/new` — Content editor with AI tools (rewrite, sensitivity check, title/hashtag generation)
- `/content/:id` — Edit existing content
- `/assets` — Asset library (images/videos)
- `/schedules` — Publishing schedule view
- `/sensitive-words` — Sensitive word dictionary management
- `/settings` — System configuration info

## UI Language

All UI text is in Simplified Chinese (简体中文).
