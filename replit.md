# 鹿联 Viral Suite

An AI-powered content creation and multi-platform publishing monorepo that helps users generate and publish viral content across platforms like XHS, TikTok, Instagram, and Facebook.

## Run & Operate

- **Run:** `pnpm dev`
- **Build:** `pnpm build`
- **Typecheck:** `pnpm typecheck`
- **Codegen:** `pnpm codegen`
- **DB Push:** `pnpm db:push`
- **Required Env Vars:** `PORT`, `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `SESSION_SECRET`, `OAUTH_TOKEN_ENCRYPTION_KEY`, `META_APP_ID`, `META_APP_SECRET`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `AYRSHARE_API_KEY`. Optional: `OPENAI_API_KEY`, `VOLCANO_ENGINE_API_KEY`, `TIKHUB_API_KEY`, `RAPIDAPI_KEY`, `INITIAL_ADMIN_EMAILS`, `TIKTOK_DATA_PROVIDER`, `VIDEO_JOBS_MAX_CONCURRENT` (1~8, 默认 4，非法回退 4 并告警), `AI_RATE_LIMIT_PER_MIN` (默认 30), `AI_RATE_LIMIT_PER_HOUR` (默认 200).

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
- **Autopilot Workflow:** `/autopilot` 是多步向导,Step union: `setup → running → review → edit → schedule → done` (单条精修流) **或** `setup → running → review → weekly-review → done` (P1-1 一周内容包流)。setup 步骤的账号选择器对未授权账号 `disabled` 灰掉(P1-3,用 `isAccountReady(acc)` 帮助函数,与后端 `isAccountReadyToPublish` 同口径:`platform==='xhs' || authStatus==='authorized' || ayrshareProfileKey`),避免用户走完才被后端 400。默认选中也优先 ready 账号。
- **Autopilot 一周内容包(P1-1 / P1-2)主流程:** review 步底部 CTA "帮我排满一周(7条)" → 调 `/api/ai/generate-weekly-plan` (gpt-4o-mini, 文案免费) → 进 `weekly-review` 步:7 个可编辑卡片(标题/正文/时间) + 每卡片 "✨ 生成配图" 按钮(按需付费,`generateImage` 基础版省 token,Pro 用户后续可升级 `generateImagePipeline`/Sora) → "确认排期 N 条" → `schedules.bulkCreate` 用「明天 00:00」做 startDate(避免和当天撞日)+ 已生成的 imageUrl 通过 `content.update` 批量回写到对应 contentId(因为 bulk-create schema 暂不支持 imageUrls)。**素材分层逻辑:文案免费 → 图片按需 → 视频 Pro 升级**,避免一次烧 7 × 250 积分。原有"单条精修"流(adopt 策略 → edit → schedule)保留不变,两条路并行可选。
- **Sensitive Word Check:** Dual-layer check: local DFA first (high-risk words block LLM call), then `gpt-4o-mini`.
- **Media URLs:** Must be absolute HTTPS; relative paths are converted using `toAbsoluteUrl()` for external platforms.
- **Sora Pro Video Generation:** Gated by `user.plan === "pro"` and requires `OPENAI_API_KEY` with Sora access; check for `pro_only` gate happens before credit deduction.
- **Bulk Schedule Creation:** Idempotent, with in-process pre-check and DB unique index `schedules_account_scheduled_at_uniq` for concurrency. **Always write `ownerUserId: u.id` on `contentTable.insert`** in `schedules.ts` bulk-create / duplicate-weeks; `/api/content` filters by `c.owner_user_id` and orphan rows become invisible to the user.
- **Weekly plan brand-profile injection:** `/api/ai/generate-weekly-plan` reads `brandProfilesTable` per (user, platform) and assembles a `brandBlock` (truncated 1500 chars) passed to `planGenerator.generateWeeklyPlan`. Forbidden claims must be enforced as absolute (incl. synonyms/implications). Without this, drafts can violate ad-law.
- **`/api/market-data/best-times` 三档来源：** 端点接受可选认证：登录用户聚合自己 `competitor_posts.published_at` 按用户本地时区分桶（≥10 条样本 → `source: "real"`，否则 `source: "fallback"`）；未登录 → `source: "mock"`。前端 `SourceBadge`（绿/黄/灰）必须按此分流显示，避免给运营误导性信号。**时区链路：** `?tz=` query > `user.region` 推 IANA（SG/HK/MY/CN/GLOBAL → Asia/Singapore/Hong_Kong/Kuala_Lumpur/Shanghai/Singapore）> SGT 兜底；`ALLOWED_TZ` 白名单防注入；insight 文案显示 tzLabel（SGT/HKT/MYT/CST）。
- **静态守卫 `pnpm --filter @workspace/scripts run check-content-owner`：** 防止 `routes/services` 里 `db.insert(contentTable).values({...})` 漏写 `ownerUserId` 字段（孤儿 bug 防回归）。改 `schedules.ts` / `content.ts` 等涉及 content 插入的代码后必跑。
- **Cron 列表（process-internal, single-instance only）：** trackingHours=12 / publishSeconds=60 / categoryTrainingHours=6 / autoSyncHours=24 / videoJobsSeconds=30 / **oauthStatesCleanupHours=24**（删 24h 前过期/消费的 `oauth_states`）。多实例部署需切换到 DB lock 或外部调度器。
- **`GET /api/admin/publish-stats?windowHours=24`：** Admin-only 多平台发布失败率聚合（successRate / avgDurationMs / recentFailures top 20），用于运营巡检；`requireAdmin` 中间件需 `user.role === 'admin'`（首次注册时由 `INITIAL_ADMIN_EMAILS` 决定）。
- **AI 用户级 rate limit (`middlewares/aiRateLimit.ts`)：** 所有 `/api/ai/*` 路由经过双层滑动窗口限流：30 次/min（短突发）+ 200 次/h（长持续）。命中返回 `429 { error: "rate_limited", retryAfterSec }` 并带 `Retry-After` 头。**进程内 Map，单实例语义**（与 cron 一致）；多实例部署需切换 Redis。可用 `AI_RATE_LIMIT_PER_MIN/_PER_HOUR` 环境变量调整。
- **上游重试 (`lib/retry.ts` → `fetchWithRetry`)：** 仅 **幂等** 的轮询/下载路径包重试（Sora 2 处 + Seedance 1 处）；指数 800ms × 2^n + 0~30% jitter，上限 20s，429 尊重 `Retry-After`。**`createTask` POST 不重试**（Sora/Volcano Ark 都不支持 `Idempotency-Key`，重试会造成双重扣费 + 双重视频）。
- **Autopilot 自动出图/出视频（`services/autoMediaForDraft.ts` + `routes/strategy.ts` approve）：** approve 后立即返回 `mediaJobs: { image: "pending"|"skipped", videoJobId?, videoSkipReason? }`。**Image：** fire-and-forget background → 高级 pipeline（首张同行爆款图 vision 分析 + 风格化 prompt + gpt-image-1）→ 失败降级到简单 prompt + gpt-image-1 → 全失败时写 `originalReference.autoMediaImageStatus="failed"` 让前端早停。**Video：** `enqueueVideoJob` 用 provider="seedance"/tier="lite" 且 `charge.amount=0`（autopilot 自动驾驶免费送 ~0.125 元/5s）。**Pro 用户保留 edit 步"升级到 Sora Pro 1080p"按钮**，不默认烧 250 积分。前端 `autopilot.tsx` edit 步轮询：image 每 3s 拉 `content.get`（90s 超时），video 每 5s 拉 `ai.videoJob`（succeeded 后 PATCH `content.update` 写回 videoUrl，因为 cron 只更新 videoJobsTable 不联动 contentTable）。**改 approve handler 后必跑 `pnpm --filter @workspace/scripts run check-content-owner`**。

## Pointers

- **Clerk Documentation:** [https://clerk.com/docs](https://clerk.com/docs)
- **Drizzle ORM Documentation:** [https://orm.drizzle.team/docs/overview](https://orm.drizzle.team/docs/overview)
- **TanStack Query Documentation:** [https://tanstack.com/query/latest](https://tanstack.com/query/latest)
- **OpenAI API Documentation:** [https://platform.openai.com/docs/api-reference](https://platform.openai.com/docs/api-reference)
- **字节跳动·火山引擎方舟 API Documentation:** _Populate as you build_
- **Ayrshare API Documentation:** [https://docs.ayrshare.com/](https://docs.ayrshare.com/)
- **TikHub API Documentation:** [https://api.tikhub.io/docs](https://api.tikhub.io/docs)