# 鹿联 Viral Suite

An AI-powered content creation and multi-platform publishing monorepo that helps users generate and publish viral content across platforms like XHS, TikTok, Instagram, and Facebook.

## Run & Operate

- **Run:** `pnpm dev`
- **Build:** `pnpm build`
- **Typecheck:** `pnpm typecheck`
- **Codegen:** `pnpm codegen`
- **DB Push:** `pnpm db:push`
- **Required Env Vars:** `PORT`, `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `SESSION_SECRET`, `OAUTH_TOKEN_ENCRYPTION_KEY`, `META_APP_ID`, `META_APP_SECRET`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `AYRSHARE_API_KEY`. Optional: `OPENAI_API_KEY`, `VOLCANO_ENGINE_API_KEY`, `TIKHUB_API_KEY`, `RAPIDAPI_KEY`, `INITIAL_ADMIN_EMAILS`, `TIKTOK_DATA_PROVIDER`.

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
- **UI Components:** `src/components/ui/`, `src/components/`
- **Shared Utilities:** `src/lib/`
- **AI Services:** `src/services/ai/`
- **OAuth Callbacks:** `src/routes/api/oauth/`
- **Environment Configuration:** `src/config/env.ts`

## Architecture decisions

- **Monorepo Structure:** Uses pnpm workspaces for managing multiple packages.
- **Tenant Isolation:** All user data is strictly scoped per user via `owner_user_id` and `ensureUser` middleware.
- **Multi-Platform Focus:** Content creation and publishing workflow treats "platform" (XHS, TikTok, Instagram, Facebook) as a primary dimension, managed via a `PlatformProvider` React context.
- **AI-Driven Content Workflow:** Integrates multiple AI models for strategy analysis, content generation, image/video creation, and agentic user interaction.
- **Robust OAuth & Publishing:** Employs a dedicated `oauth_states` table for secure state management and a `publishDispatcher` cron for resilient multi-platform publishing. OAuth tokens are encrypted at rest.

## Product

- AI-powered content strategy and generation for XHS, TikTok, Instagram, Facebook.
- Multi-platform publishing with direct OAuth and Ayrshare integration.
- AI-driven rewriting, image/video generation, and sensitive word detection.
- Competitor analysis and market data exploration.
- Note tracking with engagement metrics and keyword ranking.
- Credit-based system for AI and content operations.
- Multi-region support with region-aware AI.

## User preferences

- The user wants the AI to act as an agentic assistant that can execute commands like changing layout, modifying text, adjusting intensity, adding emojis, or regenerating content directly through function-calling.
- The user prefers an iterative development process.
- The user wants the AI to provide detailed explanations.
- The user wants the AI to ask before making major changes.
- The user prefers that the AI does not make changes to the folder `Z`.
- The user prefers that the AI does not make changes to the file `Y`.

## Gotchas

- **OAuth Account Binding:** `POST /api/strategy/:id/approve` returns `400 no_account` if no platform account is bound.
- **Ayrshare profileKey:** Do not use "default" as `ayrshareProfileKey` in the `Profile-Key` header; it causes a 404.
- **Strategy Generation:** Uses `gpt-5-mini` and performs niche-relevance scoring; irrelevant samples are ignored.
- **XHS Quick Add:** For XHS, users provide account details directly within the `PlatformGuard` card as XHS does not support OAuth.
- **XHS uses /workflow, not /autopilot:** XHS has its own wizard at `/workflow`. `/autopilot` is for TikTok/IG/FB and auto-redirects to `/workflow` for XHS.
- **Schedules empty state:** If no schedules exist, `AutoPlanReview` automatically triggers `api.ai.generateWeeklyPlan` and displays a 7-day draft. This auto-trigger is gated by `sessionStorage` to prevent re-firing.
- **Competitor 24h cache:** `POST /api/competitors` and `POST /api/competitors/:id/sync` skip external fetches if `lastSyncedAt < 24h`. `?force=true` bypasses this.
- **Autopilot custom competitors + video script:** `/autopilot` accepts `customCompetitors` (parsed for handles/URLs) and `wantVideoScript` (influences `customRequirements` for `strategy.generate`).
- **Sidebar grouping:** `Layout.tsx` `navItemsConfig` items have `group` (`main`, `history`, `system`). History group is collapsed by default.
- **Autopilot niche-fit guard:** Before starting `/autopilot`, `POST /api/ai/check-niche-fit` checks niche consistency (0-1 score). Low fit (<0.5) with history prompts user to confirm or change niche.
- **Autopilot 4-step wizard:** `/autopilot` (TT/IG/FB) is a 4-step wizard: `setup → running → review (3 strategies) → schedule → done`. One-click mode auto-picks and schedules. Custom mode allows user selection and manual scheduling.
- **`/content/:id` is XHS-exclusive editor:** This page is designed specifically for XHS content. Do not link to it from TikTok/IG/FB autopilot flows.
- **`UpdateContentBody` schema does not accept null:** When clearing video, omit the `videoUrl` field from the payload, do not send `null`.
- **AI strategy generation schema description leakage:** The `strategyGenerator.ts` system prompt's field descriptions (`"bodyDraft": "若是图文平台..."`) can be echoed into generated content. This is mitigated by prompt refinements and a `stripLeakedLabel` regex.
- **Autopilot done step must actively backfill editForm:** In one-click mode, the `editForm` is empty in the "done" step. A `useEffect` loads content into `editForm` for preview if `editForm` is empty.
- **Autopilot recommended timeslot cards:** The schedule step dynamically generates 5 candidate timeslot cards based on `marketInsights.bestTimes`. The first card is pre-selected.
- **Autopilot inline edit step:** Custom-mode autopilot includes an `edit` step where users can live-preview and edit content (title, body, tags, images, video) before scheduling.

## Pointers

- **Clerk Documentation:** [https://clerk.com/docs](https://clerk.com/docs)
- **Drizzle ORM Documentation:** [https://orm.drizzle.team/docs/overview](https://orm.drizzle.team/docs/overview)
- **TanStack Query Documentation:** [https://tanstack.com/query/latest](https://tanstack.com/query/latest)
- **OpenAI API Documentation:** [https://platform.openai.com/docs/api-reference](https://platform.openai.com/docs/api-reference)
- **字节跳动·火山引擎方舟 API Documentation:** _Populate as you build_
- **Ayrshare API Documentation:** [https://docs.ayrshare.com/](https://docs.ayrshare.com/)
- **TikHub API Documentation:** [https://api.tikhub.io/docs](https://api.tikhub.io/docs)