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
- **Ayrshare profileKey:** Do not use "default" as `ayrshareProfileKey` in the `Profile-Key` header; it causes a 404.
- **XHS Specifics:** XHS uses `/workflow` (not `/autopilot`), requires direct account details (no OAuth), and has an exclusive editor at `/content/:id`.
- **XHS image anti-hotlinking:** All XHS CDN images (`*.xhscdn.com` etc.) must be wrapped with `proxyXhsImage()` from `xhs-tool/src/lib/image-proxy.ts` (routes through `/api/xhs/image-proxy` server endpoint). Direct `<img src>` to xhscdn returns 403 due to Referer check. Server proxy uses strict hostname-suffix allowlist + manual redirect with per-hop revalidation (anti-SSRF).
- **Autopilot Workflow:** `/autopilot` is a 4-step wizard (setup → running → review → schedule → done) with niche-fit checks and dynamic timeslot suggestions. Default account selection MUST prefer ready accounts (`xhs` OR `authStatus==='authorized'` OR has `ayrshareProfileKey`); falling back to `list[0]` blindly hits backend `isAccountReadyToPublish` 400.
- **Sensitive Word Check:** Dual-layer check: local DFA first (high-risk words block LLM call), then `gpt-4o-mini`.
- **Media URLs:** Must be absolute HTTPS; relative paths are converted using `toAbsoluteUrl()` for external platforms.
- **Sora Pro Video Generation:** Gated by `user.plan === "pro"` and requires `OPENAI_API_KEY` with Sora access; check for `pro_only` gate happens before credit deduction.
- **Bulk Schedule Creation:** Idempotent, with in-process pre-check and DB unique index `schedules_account_scheduled_at_uniq` for concurrency. **Always write `ownerUserId: u.id` on `contentTable.insert`** in `schedules.ts` bulk-create / duplicate-weeks; `/api/content` filters by `c.owner_user_id` and orphan rows become invisible to the user.
- **Weekly plan brand-profile injection:** `/api/ai/generate-weekly-plan` reads `brandProfilesTable` per (user, platform) and assembles a `brandBlock` (truncated 1500 chars) passed to `planGenerator.generateWeeklyPlan`. Forbidden claims must be enforced as absolute (incl. synonyms/implications). Without this, drafts can violate ad-law.
- **`/api/market-data/best-times` 三档来源：** 端点接受可选认证：登录用户聚合自己 `competitor_posts.published_at` 按 SGT 分桶（≥10 条样本 → `source: "real"`，否则 `source: "fallback"`）；未登录 → `source: "mock"`。前端 `SourceBadge`（绿/黄/灰）必须按此分流显示，避免给运营误导性信号。
- **静态守卫 `pnpm --filter @workspace/scripts run check-content-owner`：** 防止 `routes/services` 里 `db.insert(contentTable).values({...})` 漏写 `ownerUserId` 字段（孤儿 bug 防回归）。改 `schedules.ts` / `content.ts` 等涉及 content 插入的代码后必跑。
- **Cron 列表（process-internal, single-instance only）：** trackingHours=12 / publishSeconds=60 / categoryTrainingHours=6 / autoSyncHours=24 / videoJobsSeconds=30 / **oauthStatesCleanupHours=24**（删 24h 前过期/消费的 `oauth_states`）。多实例部署需切换到 DB lock 或外部调度器。
- **`GET /api/admin/publish-stats?windowHours=24`：** Admin-only 多平台发布失败率聚合（successRate / avgDurationMs / recentFailures top 20），用于运营巡检；`requireAdmin` 中间件需 `user.role === 'admin'`（首次注册时由 `INITIAL_ADMIN_EMAILS` 决定）。

## Pointers

- **Clerk Documentation:** [https://clerk.com/docs](https://clerk.com/docs)
- **Drizzle ORM Documentation:** [https://orm.drizzle.team/docs/overview](https://orm.drizzle.team/docs/overview)
- **TanStack Query Documentation:** [https://tanstack.com/query/latest](https://tanstack.com/query/latest)
- **OpenAI API Documentation:** [https://platform.openai.com/docs/api-reference](https://platform.openai.com/docs/api-reference)
- **字节跳动·火山引擎方舟 API Documentation:** _Populate as you build_
- **Ayrshare API Documentation:** [https://docs.ayrshare.com/](https://docs.ayrshare.com/)
- **TikHub API Documentation:** [https://api.tikhub.io/docs](https://api.tikhub.io/docs)