# 鹿联 Viral Suite

An AI-powered content creation and multi-platform publishing monorepo that helps users generate and publish viral content across platforms like XHS, TikTok, Instagram, and Facebook.

## Run & Operate

- **Run:** `pnpm dev`
- **Build:** `pnpm build`
- **Typecheck:** `pnpm typecheck`
- **Codegen:** `pnpm codegen` (for Drizzle ORM)
- **DB Push:** `pnpm db:push`
- **Required Env Vars:** `PORT`, `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `SESSION_SECRET`, `OAUTH_TOKEN_ENCRYPTION_KEY` (32-byte hex), `META_APP_ID`, `META_APP_SECRET`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `AYRSHARE_API_KEY`. Optional: `OPENAI_API_KEY`, `VOLCANO_ENGINE_API_KEY`, `TIKHUB_API_KEY`, `RAPIDAPI_KEY`, `INITIAL_ADMIN_EMAILS`, `TIKTOK_DATA_PROVIDER`.

## Stack

- **Frameworks:** React, Express 5
- **Runtime:** Node.js (with TypeScript)
- **ORM:** Drizzle ORM
- **Validation:** Zod
- **Build Tool:** Vite
- **UI:** Tailwind CSS v4, shadcn/ui
- **State Management:** TanStack React Query
- **Routing:** wouter

## Where things live

- **Database Schema:** `src/db/schema.ts`
- **API Routes:** `src/routes/api/`
- **Frontend Pages:** `src/pages/`
- **UI Components:** `src/components/ui/` (shadcn/ui), `src/components/` (custom)
- **Shared Utilities:** `src/lib/`
- **AI Services:** `src/services/ai/`
- **OAuth Callbacks:** `src/routes/api/oauth/`
- **Environment Configuration:** `src/config/env.ts`

## Architecture decisions

- **Monorepo Structure:** Uses pnpm workspaces for managing multiple packages within a single repository.
- **Tenant Isolation:** All user data (accounts, content, schedules) are strictly scoped per user via `owner_user_id` and `ensureUser` middleware.
- **Multi-Platform Focus:** Content creation and publishing workflow treats "platform" (XHS, TikTok, Instagram, Facebook) as a primary dimension, managed via a `PlatformProvider` React context.
- **AI-Driven Content Workflow:** Integrates multiple AI models (GPT-4o, Seedream, ComfyUI) for strategy analysis, content generation, image/video creation, and agentic user interaction.
- **Robust OAuth & Publishing:** Employs a dedicated `oauth_states` table for secure, atomic state management across multi-instance deployments and a `publishDispatcher` cron for resilient, retriable multi-platform publishing.
- **OAuth Token Encryption:** All sensitive OAuth tokens are encrypted at rest using AES-256-GCM for enhanced security.

## Product

- AI-powered content strategy and generation for XHS, TikTok, Instagram, Facebook.
- Multi-platform publishing with direct OAuth and Ayrshare integration.
- AI-driven rewriting, image/video generation, and sensitive word detection.
- Competitor analysis and tracking across multiple social platforms.
- Market data exploration, including trending content and optimal posting times.
- Note tracking with engagement metrics and keyword ranking for published content.
- Credit-based system for AI and content operations, with admin management.
- Multi-region support (SG/HK/MY for XHS, GLOBAL for others) with region-aware AI.

## User preferences

- The user wants the AI to act as an agentic assistant that can execute commands like changing layout, modifying text, adjusting intensity, adding emojis, or regenerating content directly through function-calling.
- The user prefers an iterative development process.
- The user wants the AI to provide detailed explanations.
- The user wants the AI to ask before making major changes.
- The user prefers that the AI does not make changes to the folder `Z`.
- The user prefers that the AI does not make changes to the file `Y`.

## Gotchas

- **OAuth Account Binding:** `POST /api/strategy/:id/approve` returns `400 no_account` if a user attempts to approve a strategy without a bound platform account.
- **Ayrshare profileKey:** When using Ayrshare, ensure `ayrshareProfileKey` is not "default" when sending as a `Profile-Key` header, as this will cause a 404; "default" signifies using Ayrshare's default profile.
- **Strategy Generation:** The strategy generator uses `gpt-5-mini` (minimal reasoning) and performs niche-relevance scoring; irrelevant samples are ignored, and users are warned.
- **XHS Quick Add:** For XHS, users provide account details (nickname, region, persona) directly within the `PlatformGuard` card instead of OAuth, as XHS does not support OAuth.
- **XHS uses /workflow, not /autopilot:** XHS is the native platform with its own wizard at `/workflow` (xhs-only). `/autopilot` is the unified one-click pipeline for TikTok/IG/FB only. `AutopilotPage` auto-redirects to `/workflow` when `activePlatform === 'xhs'` (via `useEffect` + `setLocation` to keep React hooks order stable).
- **Schedules empty state:** When no schedules exist for the active platform, `AutoPlanReview` **auto-fires** `api.ai.generateWeeklyPlan` (defaults: account[0], niche from account.notes/nickname, frequency=daily) and shows the 7-day draft inline as editable cards. User clicks「全部确认」→ `bulkCreate` → schedules go live. Per-platform auto-trigger is gated by `sessionStorage["schedules:autoGen:<platform>"]` so it never re-fires after a manual delete or page revisit; the explicit「重新生成」button clears that key. Date display uses `new Date(planStartDate + "T00:00:00")` to avoid UTC weekday off-by-one.

## Pointers

- **Clerk Documentation:** [https://clerk.com/docs](https://clerk.com/docs)
- **Drizzle ORM Documentation:** [https://orm.drizzle.team/docs/overview](https://orm.drizzle.team/docs/overview)
- **TanStack Query Documentation:** [https://tanstack.com/query/latest](https://tanstack.com/query/latest)
- **OpenAI API Documentation:** [https://platform.openai.com/docs/api-reference](https://platform.openai.com/docs/api-reference)
- **字节跳动·火山引擎方舟 API Documentation:** _Populate as you build_
- **Ayrshare API Documentation:** [https://docs.ayrshare.com/](https://docs.ayrshare.com/)
- **TikHub API Documentation:** [https://api.tikhub.io/docs](https://api.tikhub.io/docs)