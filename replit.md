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

- Guided 5-step flow at `/workflow`: 选择账号 → 灵感研究 → 创作内容 → 预览检查 → 发布
- Step 1: Select or create XHS account with visual card selection
- Step 2: AI Competitor Research — input business description/link/niche → AI analyzes competitors → generates 3 content plans → user picks one to pre-fill editor
- Step 3: AI-assisted content creation (rewrite, title/hashtag generation, image generation/upload), pre-filled if user adopted a research suggestion
- Step 4: XHS-style preview card + sensitivity check + content stats with tips
- Step 5: One-click copy content → open XHS Creator Studio → mark as published
- Dashboard has prominent gradient CTA card linking to workflow
- Sidebar has highlighted "创建发布" nav item

## AI Guide / Assistant

- Floating chat widget on all authenticated pages (bottom-right corner)
- `POST /api/ai/guide` — step-aware XHS operations assistant (gpt-4o-mini)
- Sends current workflow step number + account region to backend for precise context
- Different quick prompts per page (dashboard, workflow, content, accounts)
- Proactive tips when entering workflow, encourages and guides users through each step
- Specialized in XHS platform rules, content strategy, algorithm tips
- Minimizable/closable, persists conversation during session

## Credits System

- All AI and content operations consume credits
- Free users start with 20 credits (1 full workflow trial), admin users bypass credit costs
- Pricing tiers: Free (20 credits), Starter ¥99/mo (100 credits, 1 account), Pro ¥299/mo (500 credits, unlimited accounts)
- Credit packs: 50 credits/¥29, 200 credits/¥99, 500 credits/¥199
- One complete publish workflow costs ~20 credits
- Credit costs: ai-rewrite(3), ai-competitor-research(5), ai-generate-title(1), ai-generate-hashtags(1), ai-generate-image(5), ai-guide(1), ai-check-sensitivity(1), content-publish(2), content-create(1), asset-upload(1)
- Credits checked via `requireCredits()` middleware before operations
- Credits deducted via `deductCredits()` after successful operations
- Admin can manually recharge/deduct credits for any user
- Middleware: `artifacts/api-server/src/middlewares/creditSystem.ts`

## Admin Panel

- Admin-only page at `/admin` (visible in sidebar only for admin users)
- User management: view all users, change roles (user/admin), change plans (free/paid)
- Credit management: recharge/deduct credits with descriptions
- Transaction history per user
- System stats: total users, free/paid breakdown, total credits consumed
- Routes: `GET/PATCH /admin/users`, `POST /admin/users/:id/credits`, `GET /admin/users/:id/transactions`, `GET /admin/stats`

## i18n (Internationalization)

- Supports Chinese (zh) and English (en)
- Language context provider: `artifacts/xhs-tool/src/lib/i18n.tsx`
- Language switcher button in sidebar footer
- Language preference saved to localStorage and synced to backend user record
- Translation keys used throughout Layout, onboarding, admin page

## Onboarding Guide

- First-time welcome modal with 4-step feature carousel
- Steps: AI Competitor Research → Smart Content Creation → Safety Check & Publish → Credits System
- Tracked via localStorage (`onboarding-completed`) and synced to backend user record
- Component: `artifacts/xhs-tool/src/components/onboarding/OnboardingGuide.tsx`

## Database Schema

- **users** — App users synced from Clerk (clerkId, email, nickname, role, plan, credits, language, onboardingCompleted)
- **credit_transactions** — Credit usage/recharge history (userId, amount, balanceAfter, type, operationType, description)
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
- `POST /ai/competitor-research` — AI competitor analysis + content plan generation
- `POST /ai/guide` — AI operations guide chatbot (step-aware in workflow)
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
- `GET /user/me` — Get current user info (credits, role, plan)
- `PATCH /user/me` — Update user preferences (language, onboarding, nickname)
- `GET /user/me/transactions` — Current user's credit history
- `GET /admin/users` — List all users (admin only)
- `PATCH /admin/users/:id` — Update user role/plan (admin only)
- `POST /admin/users/:id/credits` — Recharge/deduct credits (admin only)
- `GET /admin/users/:id/transactions` — User credit history (admin only)
- `GET /admin/stats` — System statistics (admin only)
- `GET /admin/credit-costs` — Credit cost config (admin only)

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
- `/admin` — Admin panel (admin-only, user/credit management)

## UI Language

Supports Simplified Chinese (zh) and English (en) with language switcher in sidebar. Default: Chinese.
