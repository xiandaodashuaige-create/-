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
- **Competitor 24h cache:** `POST /api/competitors` and `POST /api/competitors/:id/sync` skip the external fetch (TikHub / Meta Graph) when the row's `lastSyncedAt < 24h`. `:id/sync` accepts `?force=true` (or `{force:true}` body) to bypass. This significantly cuts third-party API costs when autopilot reuses the same handles. Cache returns `_cached: true` flag so client can show "from cache" hint if needed.
- **Autopilot custom competitors + video script:** `/autopilot` now mirrors XHS workflow's competitor-link input. `customCompetitors` (textarea, comma/newline separated) is parsed for `@handle` or platform URLs (`tiktok.com/@x`, `instagram.com/x`, `facebook.com/x`); each is `competitors.add`-ed and prepended to the competitor pool, skipping `api.competitors.discover` when present. `wantVideoScript` (default true for TT/IG, false for FB) appends a hook + 分镜 + 字幕 + 封面字 spec into `customRequirements` of `strategy.generate`.
- **Sidebar grouping:** `Layout.tsx` `navItemsConfig` items now have `group: "main" | "history" | "system"`. The "历史与素材" (history) group is collapsed by default and auto-expands when on a history route. Add new menu items by setting their `group` field — don't put history items into `main`.
- **Autopilot niche-fit guard:** `/autopilot` 启动前会先调 `POST /api/ai/check-niche-fit { accountId, niche }`（gpt-4o-mini，零 credit、无 `requireCredits`），把账号 `nickname + notes + 最近 5 条 content.title` 喂给 AI 打 0-1 一致性分。`fit < 0.5 && hasHistory === true` 时弹 AlertDialog 三选一：①「改用「{suggestedNiche}」跑」用 AI 推断的赛道 ②「仍按「{niche}」跑」按用户原输入（转型场景）③ 取消。账号无内容历史时返回 `fit=1` 不拦截。校验本身失败也降级 fit=1，不阻塞主流程。`startPipelineWith(finalNiche)` 用 `setNiche + setTimeout(()=>runPipeline(),0)` 等下一帧 state 更新（runPipeline 内部读 niche state 而不是入参）。
- **Autopilot 4-step wizard:** `/autopilot` (TT/IG/FB) is a 4-step wizard mirroring `/workflow`: `setup → running → review (3 strategies) → schedule → done`. Stage 3 of `runPipeline` calls `api.strategy.generate` **3× in parallel** via `Promise.allSettled`, each with a different angle hint appended to `customRequirements` (`STRATEGY_ANGLES` const: 教学/科普, 情感共鸣, 数据反差). **One-click mode (`customMode=false`, default):** auto-picks the first surviving option → `strategy.approve` → `content.schedule` to the prefilled best-time → jumps straight to `done`. **Custom mode:** stops at `review`, user picks card → `setStep("schedule")` with prefilled time + quick picks (30min/今晚/明早) + datetime-local input → confirm. Schedule step has 「返回重选方案」 button. Mount-time `useEffect` normalizes any non-`Step` value (HMR safety against old `step="approved"`). `handleAdoptStrategy` / `handleScheduleNow` hard-guard with `isPending` checks (frontend-only debounce; backend approve+schedule are NOT yet idempotent — fast double-click via curl could still produce duplicate content/schedule rows). Costs 3× AI tokens per autopilot run vs. previous 1×.

- **`UpdateContentBody` schema 不接受 null：** `PATCH /api/content/:id` 的 zod schema 中 `videoUrl` 是 `z.string().optional()`，传 `null` 会 400。前端清空视频时**省略字段**而不是传 `null`（autopilot `handleSaveEditAndProceed` 用 `if (editForm.videoUrl) payload.videoUrl = ...` 模式）。
- **Autopilot inline edit step:** Custom-mode autopilot inserts a new `step === "edit"` between `review` and `schedule` (full Step type now `setup|running|review|edit|schedule|done`, indicator shows 5 stages with Wand2 icon for edit). After `approveMut.onSuccess`, calls `loadContentIntoEditForm(contentId)` which fetches `api.content.get` and populates `editForm = {title, body, tags, tagInput, imageUrls, videoUrl}`. Edit page is 2-col: left = live preview card (video/cover + title + body + tags + thumbnail strip); right = editable form with title input, body textarea, tag chips with inline add/remove, image grid (delete X / `AssetPicker type=image` / `ObjectUploader` 10MB / 「AI 生成」 button calling `api.ai.generateImage`), and video block (`AssetPicker type=video` / `ObjectUploader` 100MB). 「保存并去排期」calls `api.content.update` then `setStep("schedule")`. Reuses `handleGetUploadParameters` pattern from xhs workflow (`POST /api/storage/uploads/request-url` → presigned PUT → `/api/storage{objectPath}` URL). One-click mode bypasses edit (still goes review→approve→auto-schedule→done). HMR-safety valid steps array updated. `resetAll` clears `editForm`. Done step also enriched: shows real cover/video + title/body/tags from `editForm`, not just strategy summary. Mount-time normalizer accepts "edit" as valid.

## Pointers

- **Clerk Documentation:** [https://clerk.com/docs](https://clerk.com/docs)
- **Drizzle ORM Documentation:** [https://orm.drizzle.team/docs/overview](https://orm.drizzle.team/docs/overview)
- **TanStack Query Documentation:** [https://tanstack.com/query/latest](https://tanstack.com/query/latest)
- **OpenAI API Documentation:** [https://platform.openai.com/docs/api-reference](https://platform.openai.com/docs/api-reference)
- **字节跳动·火山引擎方舟 API Documentation:** _Populate as you build_
- **Ayrshare API Documentation:** [https://docs.ayrshare.com/](https://docs.ayrshare.com/)
- **TikHub API Documentation:** [https://api.tikhub.io/docs](https://api.tikhub.io/docs)