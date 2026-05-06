# 鹿联 Viral Suite

An AI-powered content creation and multi-platform publishing monorepo that helps users generate and publish viral content across platforms like XHS, TikTok, Instagram, and Facebook.

## Run & Operate

- **Run:** `pnpm dev`
- **Build:** `pnpm build`
- **Typecheck:** `pnpm typecheck`
- **Codegen:** `pnpm codegen`
- **DB Push:** `pnpm db:push`
- **Required Env Vars:** `PORT`, `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `SESSION_SECRET`, `OAUTH_TOKEN_ENCRYPTION_KEY`, `META_APP_ID`, `META_APP_SECRET`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `AYRSHARE_API_KEY`. Optional: `OPENAI_API_KEY`, `VOLCANO_ENGINE_API_KEY`, `TIKHUB_API_KEY`, `RAPIDAPI_KEY`, `INITIAL_ADMIN_EMAILS`, `TIKTOK_DATA_PROVIDER`, `VIDEO_JOBS_MAX_CONCURRENT`, `AI_RATE_LIMIT_PER_MIN`, `AI_RATE_LIMIT_PER_HOUR`, `SORA_DAILY_LIMIT_PER_USER`, `REDIS_URL`.

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
- **Multi-Platform Focus:** Content creation and publishing workflow treats "platform" (XHS, TikTok, Instagram, Facebook) as a primary dimension.
- **AI-Driven Content Workflow:** Integrates multiple AI models for strategy analysis, content generation, image/video creation, and agentic user interaction.
- **Robust OAuth & Publishing:** Employs a dedicated `oauth_states` table for secure state management and a `publishDispatcher` cron for resilient multi-platform publishing. OAuth tokens are encrypted at rest.
- **Credit System:** Credit-based system for AI and content operations with atomic debit/refund transactions.

## Product

- AI-powered content strategy and generation for XHS, TikTok, Instagram, Facebook.
- Multi-platform publishing with direct OAuth and Ayrshare integration.
- AI-driven rewriting, image/video generation (including Sora Pro), and sensitive word detection.
- Competitor analysis and market data exploration.
- Note tracking with engagement metrics and keyword ranking.
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
- **Ayrshare profileKey:** Do not use "default" as `ayrshareProfileKey` in the `Profile-Key` header.
- **XHS Specifics:** XHS uses `/workflow`, requires direct account details, and has an exclusive editor at `/content/:id`. XHS CDN images must be wrapped with `proxyXhsImage()` from `xhs-tool/src/lib/image-proxy.ts`.
- **Autopilot Workflow:** Multi-step wizard (`setup → running → review → edit → schedule → done` for single refinement or `setup → running → review → weekly-review → done` for weekly content packs). Account selector disables unauthorized accounts.
- **Sensitive Word Check:** Dual-layer check: local DFA first, then `gpt-4o-mini`.
- **Media URLs:** Must be absolute HTTPS.
- **Sora Pro Video Generation:** Gated by `user.plan === "pro"` and requires `OPENAI_API_KEY` with Sora access. Daily limit applies, admin exempted.
- **Bulk Schedule Creation:** Idempotent, ensure `ownerUserId` is always set for content insertion.
- **Weekly plan brand-profile injection:** `/api/ai/generate-weekly-plan` uses `brandProfilesTable` for (user, platform) to generate a `brandBlock` (truncated 1500 chars) for the prompt.
- **Market Data Best Times:** `/api/market-data/best-times` sources data based on user login status (real for logged-in with sufficient data, fallback for less data, mock for not logged-in). Timezone handling is critical.
- **Static Guard `check-content-owner`:** Run `pnpm --filter @workspace/scripts run check-content-owner` after changes to content insertion logic to prevent orphan rows.
- **Cron Jobs:** Tracking, publishing, category training, auto-sync, video jobs, and OAuth states cleanup run internally. Multi-instance deployments require external scheduling or DB locks.
- **Admin Publish Stats:** `/api/admin/publish-stats` is admin-only, requires `user.role === 'admin'`.
- **AI User-Level Rate Limit:** `/api/ai/*` routes are subject to dual-layer sliding window rate limits (30/min, 200/hour). Single-instance semantic; Redis required for multi-instance.
- **Brand Profile Injection and Post-Output Safeguards:** `loadBrandContext(userId, platform)` 提供 `{ promptBlock, forbiddenClaims, brand }`(promptBlock 1500 字截断,失败/空配置静默回退)。`checkForbidden`/`checkForbiddenMany` 用 NFKC + lower + 去空白归一化 (防全角绕过) 扫描 LLM 输出,跳 1 字符防误命中。**4 个文本端点 (`/ai/rewrite`, `/generate-title`, `/generate-hashtags`, `/refine-schedule-item`)** 命中追加 `_brandWarning` 字段(zod parse 之后 spread,不破坏 schema) + `req.log.warn` 埋点;**`imagePipeline`/`videoPipeline`** 命中只 `logger.warn`(不自动重写避免双倍扣费,字幕烧入视频后无法撤回)。**关键架构:`forbiddenClaims` 必须以结构化 `string[]` 通过 `PromptGenerationInput.forbiddenClaims` / `GenerateVideoPlanInput.forbiddenClaims` 直传 pipeline,严禁从 brandBlock regex 反向解析(文案格式一变就静默失败)**。所有 enqueue/调用点须同时传 `brandBlock` + `forbiddenClaims`(已覆盖:videoGen.ts 三处、strategy.ts approve、autoMediaForDraft.kickOff、ai.ts /generate-image-pipeline)。
- **`videoPipeline.brandBlock`:** Ensure `input.brandBlock` handles `null` values correctly to avoid string literal injection into prompts.
- **Sora Pro Limit Index:** `idx_video_jobs_owner_provider_created` on `(owner_user_id, (input->>'provider'), created_at)` in `video_jobs` table speeds up Sora daily limit queries. Run `pnpm --filter @workspace/db run push` after schema changes.
- **Sora Pro Pricing:** Costs 500 credits. Daily limit is 3 videos per user by default; admin exempted.
- **Dashboard API Fix:** `GET /api/dashboard/recent-activity` now uses `row.type` for activity type. Regenerate zod after `openapi.yaml` changes: `pnpm --filter @workspace/api-spec run codegen`.
- **Multi-instance Warning:** `REPLIT_DEPLOYMENT=1 && !REDIS_URL` triggers a warning about single-instance semantics for rate limiting and cron jobs, advising `maxInstances=1` or Redis for autoscale.
- **Upstream Retries:** `fetchWithRetry` (`lib/retry.ts`) is used only for idempotent polling/download paths (e.g., Sora, Seedance). Non-idempotent POST requests (`createTask`) are not retried.
- **Autopilot Auto Media Generation:** `approve` returns `mediaJobs` status. Images are fire-and-forget; videos are enqueued with free `seedance/lite` for autopilot users. Pro users can upgrade to Sora Pro. Frontend polls for media job status.

## Pointers

- **Clerk Documentation:** [https://clerk.com/docs](https://clerk.com/docs)
- **Drizzle ORM Documentation:** [https://orm.drizzle.team/docs/overview](https://orm.drizzle.team/docs/overview)
- **TanStack Query Documentation:** [https://tanstack.com/query/latest](https://tanstack.com/query/latest)
- **OpenAI API Documentation:** [https://platform.openai.com/docs/api-reference](https://platform.openai.com/docs/api-reference)
- **字节跳动·火山引擎方舟 API Documentation:** _Populate as you build_
- **Ayrshare API Documentation:** [https://docs.ayrshare.com/](https://docs.ayrshare.com/)
- **TikHub API Documentation:** [https://api.tikhub.io/docs](https://api.tikhub.io/docs)