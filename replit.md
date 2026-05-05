# Workspace

## Overview

pnpm workspace monorepo using TypeScript. **鹿联小红书AI爆款创作间 (LuLian XHS Viral Creator)** — AI content creation tool that analyzes industry content strategies and helps clients create and publish original content. Features include multi-region support (SG/HK/MY), AI content strategy analysis, AI pseudo-original rewriting, pseudo-original image generation, automatic sensitive word detection and auto-fix, team video upload support, and AI-recommended posting times.

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
- **AI**:
  - OpenAI via Replit AI Integrations (gpt-4o for vision/text/agentic function-calling, gpt-image-1 for image fallback)
  - **即梦 Seedream 5.0-lite** (字节跳动·火山引擎方舟 API) — 主力出图引擎，专为中文文字渲染+小红书风格优化（需要 `ARK_API_KEY`）
  - **ComfyUI** (Flux + Redux + ControlNet + AnyText) — GPU 自部署兜底（需要 `COMFYUI_URL`）
  - **后端拼图引擎** (sharp + SVG 文字叠加) — 支持 单图/上下双图/左右双图/2×2四格/左大右双小 五种布局
  - **12 维视觉分析** — GPT-4o 拆解参考图：布局/色调/风格/氛围/主体/构图/关键元素/文字方案/字幕设计/emoji/情绪钩子/拼图结构/模仿建议(必保留+可换+避坑)
  - **Agentic AI 助手** — 结果页对话式助手 (`/ai/assistant-chat`)，GPT-4o function-calling 直接执行换布局/改文字/调强度/加emoji/重新生成
  - **学习系统** — `image_references` + `user_style_profiles` 表记录每次参考图与采用反馈，每次生成自动注入该用户的偏好色调/布局/字体/emoji/情绪
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

- `POST /api/ai/generate-image` — generates images via gpt-image-1
- `POST /api/ai/edit-image` — reference-based image generation (伪原创配图) via gpt-image-1 images.edit
  - Accepts prompt + referenceImageUrl (storage URL of uploaded competitor/viral image)
  - Fetches reference image, passes to openai.images.edit to create similar-style originals
- Accepts prompt, style (optional), size (1024x1024, 1024x1536, 1536x1024, auto)
- Default size: 1024x1536 (portrait, optimized for XHS phone display)
- Returns b64_json, auto-uploads to object storage
- Integrated in content editor and workflow wizard with Chinese prompt support

## Workflow Wizard

- Guided 3-step flow at `/workflow`: 灵感研究 → 创作内容 → 发布
- Step 1 (内容策略): Region selector with 3 region buttons (🇸🇬 SG, 🇭🇰 HK, 🇲🇾 MY), then AI Content Strategy Analysis — input business description/link/niche → AI analyzes industry content strategies → generates 3 original content plans with posting time recommendations → user picks one
- Step 2 (生成内容): Combined content creation + preview — AI-assisted editor (rewrite, title/hashtag/image generation, image/video upload) with live preview card, content stats, and sensitivity check in right sidebar. Streamlined AI image panel: auto-detects reference mode when competitor image is uploaded, otherwise generates from text prompt. When adopting a strategy suggestion, AI progress animation overlay auto-fills content, runs sensitivity check with auto-fix (rewrites flagged content automatically), AND auto-generates a cover image — delivering a complete content package ready for review.
- Step 3 (发布): AI-recommended posting times display, image/video download gallery with per-image download buttons and "download all" option, auto-copy content → open XHS Creator Studio → mark as published → success with "publish next" option
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
- Plan names: 体验版(Trial) / 续费版(Growth) / 定制版(Custom)
- Pricing tiers (USD): Trial (20 credits free), Growth $12.9/mo (100 credits, 1 account), Custom $39.9/mo (500 credits, unlimited accounts)
- Credit packs (USD): 50/$3.9, 200/$12.9, 500/$24.9
- One complete publish workflow costs ~20 credits
- Credit costs: ai-rewrite(3), ai-competitor-research(5), ai-generate-title(1), ai-generate-hashtags(1), ai-generate-image(5), ai-guide(1), ai-check-sensitivity(1), content-publish(2), content-create(1), asset-upload(1)
- Credits checked via `requireCredits()` middleware before operations
- Credits deducted via `deductCredits()` after successful operations
- Admin can manually recharge/deduct credits for any user
- Middleware: `artifacts/api-server/src/middlewares/creditSystem.ts`

## Admin Panel

- Admin-only page at `/admin` (visible in sidebar only for admin users)
- User management: view all users, change roles (user/admin), change plans (free/starter/pro)
- Credit management: prominent green "充值" button per user row + expandable recharge/deduct controls with descriptions
- Transaction history per user
- System stats: total users, free/paid breakdown, total credits consumed
- Routes: `GET/PATCH /admin/users`, `POST /admin/users/:id/credits`, `GET /admin/users/:id/transactions`, `GET /admin/stats`

## i18n (Internationalization)

- Supports Simplified Chinese (zh), Hong Kong Traditional Chinese (zh-HK), and English (en)
- Language context provider: `artifacts/xhs-tool/src/lib/i18n.tsx`
- 3-button language switcher (简体/繁體/EN) in sidebar footer and landing page header
- zh-HK translations use Hong Kong Cantonese expressions (嘅、唔、搵、啲 etc.)
- Browser language auto-detection: zh-HK/zh-TW/zh-Hant → "zh-HK", zh* → "zh", else "en"
- Language preference saved to localStorage and synced to backend user record
- Translation keys used throughout Layout, onboarding, admin page, landing page

## Onboarding Guide

- First-time welcome modal with 4-step feature carousel
- Steps: AI Competitor Research → Smart Content Creation → Safety Check & Publish → Credits System
- Tracked via localStorage (`onboarding-completed`) and synced to backend user record
- Component: `artifacts/xhs-tool/src/components/onboarding/OnboardingGuide.tsx`

## Database Schema

- **users** — App users synced from Clerk (clerkId, email, nickname, role, plan, credits, language, onboardingCompleted)
- **credit_transactions** — Credit usage/recharge history (userId, amount, balanceAfter, type, operationType, description)
- **accounts** — XHS accounts with region (SG/HK/MY), status, nickname, xhsId, authStatus (pending/authorized)
- **content** — Posts with title, body, tags, imageUrls, status (draft/published/scheduled), sensitivity info; accountId is nullable (content can exist without a bound account)
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
- `POST /ai/generate-image` — AI image generation (gpt-image-1)
- `POST /ai/edit-image` — Reference-based image generation (伪原创配图, gpt-image-1 images.edit)
- `POST /ai/competitor-research` — AI competitor analysis + content plan generation (includes posting time recommendations)
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
- `/workflow` — Guided 3-step create & publish wizard (灵感研究 → 创作内容 → 发布)
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

Supports Simplified Chinese (zh), Hong Kong Traditional Chinese (zh-HK), and English (en) with 3-button language switcher in sidebar and landing page. Default: auto-detected from browser.

## Insufficient Credits Dialog

- When AI operations return 403 (insufficient credits), a dialog shows current/required credits and consultant contact info (WeChat/WhatsApp)
- Component: `artifacts/xhs-tool/src/components/InsufficientCreditsDialog.tsx`
- All AI mutations in workflow page route errors through `handleCreditError()`

## Region-Aware AI

- AI competitor research and rewrite prompts adapt for HK region (繁體中文 + Cantonese tone)
- AI Guide chatbot detects selected region via `data-selected-account-region` DOM attribute
- HK region triggers Traditional Chinese responses with Hong Kong cultural context
- Region is selected independently; rewrite and research both use `selectedRegion`

## XHS Real Data Integration (Hybrid Mode)

- **Priority 1 — TikHub** (cheapest, $0.001/request): `api.tikhub.io`
  - Env var: `TIKHUB_API_KEY`
  - Endpoints: /api/v1/xiaohongshu/web_v3/fetch_search_notes, fetch_note_detail
  - Free daily check-in credits, no credit card required
- **Priority 2 — RapidAPI** (backup): `xiaohongshu-all-api.p.rapidapi.com`
  - Env var: `RAPIDAPI_KEY`
  - Free plan: 20 requests/month; Pro: $39.99/mo for 1,800 requests
- **Priority 3 — AutoDL** (self-hosted scraper, cookie-dependent)
  - Env vars: `AUTODL_XHS_URL`, `AUTODL_API_KEY`
  - Requires XHS cookie refresh, subject to anti-bot detection
- **Priority 4 — AI-only** (always available, no real data)
- **Hybrid Mode**: `tryFetchXhsData()` in xhs.ts cascades: TikHub → RapidAPI → AutoDL → AI-only. The competitor-research endpoint in ai.ts injects real note data into the AI prompt when available. Frontend shows "含真实数据" or "AI智能分析" badge. Response includes `dataSource` field.
- Route file: `artifacts/api-server/src/routes/xhs.ts`
- API endpoints:
  - `GET /api/xhs/health` — Check all data source availability
  - `POST /api/xhs/search` — Search XHS notes by keyword
  - `GET /api/xhs/note/:noteId` — Get note details
  - `GET /api/xhs/user/:userId/notes` — Get user's published notes

## Admin Auto-Assignment

- Admin emails configured in `creditSystem.ts`: xiandao456@gmail.com, xiandaodashuaige@gmail.com
- When these emails register via Clerk, they are automatically assigned "admin" role on first login
- Admin users bypass credit costs and see the admin panel in sidebar
