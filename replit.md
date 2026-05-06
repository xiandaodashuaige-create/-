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
- **`POST /content/:id/publish` 真发：** 老版本只是把 DB status 翻成 `published` 不调外部 API（假发布）。已改为通过 `dispatchContentToProvider`（`publishDispatcher.ts` 导出）真调 FB/IG/TT/Ayrshare；失败返回 502 + 不改 status 也不扣积分；成功后写真 `remote_post_id` + `publish_logs` 一条。XHS 仍走旧"标记已发"语义。
- **`publish_logs.schedule_id` 已放宽为 nullable：** 手动立即发布无对应 schedule，写 `schedule_id=NULL` + `attempt=1`。已对 prod DB 做 `ALTER TABLE publish_logs ALTER COLUMN schedule_id DROP NOT NULL`。
- **敏感词检查双层：** `POST /api/ai/check-sensitivity` 先走本地 DFA（`mint-filter` + `data/sensitive-words/{political,porn,general}.txt` + 内置广告法极限词列表 `services/sensitiveWordFilter.ts`）。命中高危直接返回不调 LLM、不扣积分；无高危才走 gpt-4o-mini。词库通过 esbuild `loader: { ".txt": "text" }` 打包进 dist。
- **侧边栏 nonXhs / xhsOnly：** `Layout.tsx` NavItem 支持 `xhsOnly`（仅 XHS 显示，如 `/workflow` `/tracking` `/sensitive-words`）和 `nonXhs`（XHS 模式下隐藏，如 `/autopilot` `/quick-publish`）。
- **媒体 URL 必须是绝对 https：** `dispatchContentToProvider` 入口用 `toAbsoluteUrl()` 把 `/api/storage/objects/...` 这类相对路径补成 `https://${REPLIT_DOMAINS}{path}`，否则 TikTok / FB / IG 服务器拉不到媒体会报 "Media URLs invalid"。
- **`/credits` 是普通用户的积分页：** `/admin` 只 admin 可见，`/credits` 给所有用户看自己的「余额 + 累计 + 套餐 + 最近 100 条流水（含操作类型 emoji + 金额涨跌）+ 顾问联系方式」。流水通过 `api.user.transactions(100)` 取，operationType 复用 `cost.*` i18n key 显示。Layout 侧边栏 system 组里在 settings 上方。
- **设置页 5 模块：** `/settings` = 个人资料（nickname via `PATCH /user/me`）+ 创作偏好（默认平台/地区/行业，存 localStorage `pref.region`/`pref.niche`，平台直连 `setActivePlatform`）+ 积分速览（链接到 /credits）+ 语言（同步保存到后端 `user.language`）+ 退出登录二次确认。系统信息卡已迁移到 `/admin` 底部。
- **autopilot.tsx 已全 i18n：** 所有 toast、step 标签、setup/running/review/edit/schedule/done 6 步的 UI 字符串、按钮、placeholder、STRATEGY_ANGLES 的 labelKey/hintKey 都走 `t()`。`i18n.tsx` 三语段（zh/en/zh-HK）加了 `autopilot.*` 165+ key。仅 pipeline `pushLog` 控制台中文日志（30+ 处）未改，作低优先（用户看的是结果不是 log 文本）。
- **品牌画像（按平台）：** `GET/PUT /api/brand-profile?platform=xhs|tiktok|instagram|facebook`，per-user per-platform upsert。`settings.tsx` 第 3 张卡片填写后会被注入到后续 AI 策略/文案生成 prompt（`category/products/targetAudience/priceRange/tone/forbiddenClaims/conversionGoal`）。前端 `api.brandProfile.{get,upsert}`。
- **bulk-create schedules 幂等去重：** `POST /api/schedules/bulk-create` 写入前查 `accountId` 已有 `scheduledAt`，对 (1) DB 已有 (2) 同批 items 重复 三种重叠都跳过，返回 `{ created, skipped, items }`。注：跨请求并发仍可能撞日，后续应给 `schedules(account_id, scheduled_at)` 加唯一索引 + ON CONFLICT 才彻底闭环。
- **ObjectUploader allowedFileTypes：** `@workspace/object-storage-web` 现支持 `allowedFileTypes?: string[]` prop（透传到 Uppy `restrictions.allowedFileTypes`），workflow / autopilot 等上传点用 `["image/*"]` / `["video/*"]` 限制。
- **Sora 2 Pro 高清电影级视频（pro 专享）：** `POST /api/ai/generate-video-sora` 250 积分，仅 `user.plan === "pro"` 可调（否则 403 `pro_only`）。复用 `videoJobs` 异步队列，`input.provider="sora-pro"` 在 `processJob` 里分支：planning 步还是走 `videoPipeline.generateVideoCreativePlan`（保留同行/类目/品牌画像 prompt 注入），generate 步走 `services/sora.ts`（OpenAI `POST/GET /v1/videos` + `/content` 二进制下载）；默认 1080P 12s 竖屏（1024x1792），16:9/4:3 时换横屏（1792x1024）。失败按 provider 退款（250 vs 15）。前端 `autopilot.tsx` 只对 pro 显示紫色「Sora 高清电影级 (Pro · 250)」按钮，二次 `confirm("250 积分≈43 元")` → 5s 轮询 `/ai/video-job` → 成功自动填 `editForm.videoUrl`。需要 `OPENAI_API_KEY` 已开通 Sora 权限。
- **已知遗留：视频任务 enqueue+扣费非原子：** `enqueueVideoJob` 内部 in-flight 去重 + 路由层 `if (created) deductCredits` 不在事务内。极端并发下 created=false 命中老 job，但若那个老 job 后续失败会触发全额退款 → 净增积分。Sora 250 分放大了风险。后续应给 video_jobs 加 `charged_amount` 字段+原子事务。
- **市场数据 trending 真接：** `/api/market-data/trending?platform=xhs` 已接 `hotTopics.searchXhsNotes`（TikHub 优先，RapidAPI 兜底，地区 SG/HK/MY→中文 region 词），返回 `source: "xhs"`。`platform=tiktok` 走 TikHub。FB/IG 仍 mock + 引导去同行库。前端按 `data.source === "mock"` 显示黄色提示横幅。

## Pointers

- **Clerk Documentation:** [https://clerk.com/docs](https://clerk.com/docs)
- **Drizzle ORM Documentation:** [https://orm.drizzle.team/docs/overview](https://orm.drizzle.team/docs/overview)
- **TanStack Query Documentation:** [https://tanstack.com/query/latest](https://tanstack.com/query/latest)
- **OpenAI API Documentation:** [https://platform.openai.com/docs/api-reference](https://platform.openai.com/docs/api-reference)
- **字节跳动·火山引擎方舟 API Documentation:** _Populate as you build_
- **Ayrshare API Documentation:** [https://docs.ayrshare.com/](https://docs.ayrshare.com/)
- **TikHub API Documentation:** [https://api.tikhub.io/docs](https://api.tikhub.io/docs)