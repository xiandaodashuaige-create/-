# Workspace

## Overview

This project, **鹿联 Viral Suite (LuLian Viral Suite)** — formerly 鹿联小红书AI爆款创作间 — is an AI-powered content creation + multi-platform publishing monorepo that merges three predecessor Replit projects: the original xhs-tool (XHS strategy/AI), tiktok-ai (Gemini/TTS/Whisper/AdForge), and socialAuto (Meta + TikTok OAuth/Ayrshare publishing). It uses a single product, creation-centric UX with **platform as a dimension** (XHS / TikTok / Instagram / Facebook), enforced via a `PlatformProvider` React context with localStorage persistence. The platform analyzes industry content strategies, offers AI-driven rewriting and image/video generation, includes sensitive word detection, multi-region support (SG/HK/MY for XHS, GLOBAL for others), and AI-recommended posting times. Publishing strategy: Meta direct OAuth + TikTok via Ayrshare.

**Tenant isolation:** All accounts/content/schedules/dashboard endpoints enforce per-user scoping via `ensureUser` + `owner_user_id` filter. Content/schedules/dashboard tables without a direct owner column are isolated by joining through `accounts.owner_user_id`. Dashboard endpoints additionally accept an optional `platform` query param.

## User Preferences

- The user wants the AI to act as an agentic assistant that can execute commands like changing layout, modifying text, adjusting intensity, adding emojis, or regenerating content directly through function-calling.
- The user prefers an iterative development process.
- The user wants the AI to provide detailed explanations.
- The user wants the AI to ask before making major changes.
- The user prefers that the AI does not make changes to the folder `Z`.
- The user prefers that the AI does not make changes to the file `Y`.

## System Architecture

The project is structured as a pnpm workspace monorepo using TypeScript.

**UI/UX Decisions:**
- Frontend built with React, Vite, Tailwind CSS v4, and shadcn/ui.
- Routing is handled by wouter, and state management by TanStack React Query.
- The UI supports Simplified Chinese (zh), Hong Kong Traditional Chinese (zh-HK), and English (en), with a language switcher and browser language auto-detection.
- Onboarding includes a 4-step feature carousel for new users.
- A floating chat widget provides step-aware AI guidance.
- Insufficient credits trigger a dialog showing current/required credits and consultant contact info.

**Technical Implementations:**
- **Monorepo:** pnpm workspaces.
- **Backend:** Express 5 API server.
- **Database:** PostgreSQL with Drizzle ORM and Zod for validation.
- **Authentication:** Clerk (Replit-managed) for email/password and Google login, with role-based access for admin features.
- **File Storage:** Replit Object Storage (GCS-backed) for asset uploads using presigned URLs.
- **AI Integration:**
    - OpenAI's gpt-4o for vision, text, and agentic function-calling.
    - 即梦 Seedream 5.0-lite (字节跳动·火山引擎方舟 API) as the primary image generation engine for Chinese text rendering and XHS style optimization.
    - ComfyUI (Flux + Redux + ControlNet + AnyText) provides GPU-based fallback for image generation.
    - A custom backend puzzle engine (sharp + SVG) supports various image layouts.
    - GPT-4o performs 12-dimensional visual analysis of reference images.
    - An agentic AI assistant allows conversational interaction and direct execution of content modifications.
    - A learning system records user preferences (image references, style profiles) to personalize future content generation.
- **Workflow Wizard:** A guided 3-step process (Inspiration Research → Content Creation → Publish) for content generation and publication, integrating AI for strategy analysis, content generation, sensitivity checks, and cover image creation.
- **Multi-Platform Competitor Library (`/competitors`):** Per-platform (TikTok / Facebook / Instagram, with XHS analysed inline in workflow) competitor profile + post tracking. Tables `competitor_profiles` (unique on `user_id+platform+handle`) and `competitor_posts` (unique on `competitor_id+external_id`). TikTok backed by **TikHub** (`fetch_user_profile`, `fetch_user_post`, `fetch_search_user`); FB pages via Graph `/posts`; IG Business via `business_discovery` from a connected FB Page. Routes: `GET/POST/DELETE /api/competitors`, `/competitors/:id/posts`, `/competitors/:id/sync`, `/competitors/discover`, `/competitors/trending`. UI supports manual handle add + TikTok keyword discovery + per-card sync/delete + 50-post sample drawer.
- **AI Strategy Cards (`/api/strategy/*`) + Autopilot (`/autopilot`):** `POST /api/strategy/:id/approve` **returns 400 `no_account` when the user has no platform account bound** (instead of silently creating an orphan content row with `accountId=null` that the `/content` UI INNER-JOIN would hide). Single-shot pipeline that combines (1) user's authorized accounts, (2) selected/auto-loaded competitor posts, (3) niche+region inputs into a `strategies` row carrying full `strategyJson` (theme / hookFormula / scriptOutline / voiceoverScript / bgmStyle / hashtags / referenceCompetitors / targetAudience / coverPrompt / bodyDraft) generated by `gpt-5-mini` (minimal reasoning). Strategy generator includes a niche-relevance scoring with CN/EN synonym expansion (NICHE_SYNONYMS) and a `dataMode` flag (`niche_match` / `no_match_using_niche_only` / `no_niche`) so the AI ignores irrelevant samples and warns the user. `POST /api/strategy/:id/approve` creates a `content` draft row (status=draft, source-tagged in `originalReference`) bound back via `strategies.contentId`, ready for the existing workflow editor / scheduler — no AdForge/Kling video pipeline (deferred).
- **Market Data Explorer (`/market-data`):** Cross-platform trending content (TikTok via TikHub `fetch_trending_hashtag_videos`, others fall back to mock until creds present), Meta Ads Library (`/ads_archive`, gated by `FACEBOOK_ACCESS_TOKEN`, mock fallback otherwise), and per-platform best posting times.
- **Multi-Platform OAuth & Auto-Publish:** TikTok / Facebook / Instagram are connected via direct OAuth (Meta App + TikTok for Developers app) or aggregated via Ayrshare. OAuth callbacks (`/api/oauth/{tiktok,facebook}/callback`) are public; all other OAuth routes (status / connect / disconnect / sync) sit behind `requireAuth`. **State→userId binding is persisted in `oauth_states` table** with atomic `UPDATE ... WHERE consumed_at IS NULL AND expires_at > NOW() RETURNING owner_user_id` for one-shot consume + replay protection — survives restart and works across multi-instance deploys (shared helper at `lib/oauth/state.ts`). `accountsTable` enforces a unique index on `(owner_user_id, platform, platform_account_id)` and `upsertOAuthAccount` uses atomic `ON CONFLICT DO UPDATE`. A `publishDispatcher` cron (60s tick, single-instance) scans `schedules WHERE platform IN (tiktok, instagram, facebook) AND status='pending' AND scheduled_at<=NOW()` with `FOR UPDATE SKIP LOCKED`, routes each via Ayrshare if `ayrshareProfileKey` is set (and **passes that profileKey through to `publishToSocial` so multi-account doesn't all go to default profile**), otherwise direct platform API (TikTok video upload / FB photo+feed / IG media+publish). TikTok access tokens are auto-refreshed when <5min from expiry. **Retries use a real `retry_count` integer column on `schedules`**, atomically incremented in DB (`retry_count = retry_count + 1` + CASE) with status guard (`WHERE status='publishing'`) to prevent overwriting a successful publish. `markPublished` is also status-guarded to prevent double-publish. Manual `/schedules/:id/retry` resets `retry_count=0`. ≥MAX_RETRIES (3) → status='failed'. Required secrets: `META_APP_ID`, `META_APP_SECRET`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `AYRSHARE_API_KEY`. UI: `OAuthConnectPanel` on `/accounts` page shows per-platform configured/connected status, opens OAuth in popup window, listens for `postMessage('oauth-done')` to refresh.
- **Note Tracking (P0 vertical loop):** After publishing, users paste their XHS note URL + target keywords. A daily cron (12h interval, single-instance) fetches public engagement metrics (likes/collects/comments) and SEO keyword search rank via TikHub/RapidAPI search APIs. Tables: `note_tracking`, `note_metrics_daily`, `keyword_rankings_daily`. Frontend: `/tracking` list + `/tracking/:id` detail with Recharts time-series. No XHS account auth required (public-data only).
- **Hot Topics Calendar:** Per-niche/region daily-cached hashtag aggregation (`hot_topics_cache` table) computed from search results, surfaced as a sidebar card on the tracking page.
- **Credit System:** All AI and content operations consume credits, with different plans and credit pack options. Admin users bypass credit costs.
- **Admin Panel:** Provides user and credit management, transaction history, and system statistics for administrators.
- **Region-Aware AI:** AI models adapt prompts and responses based on selected regions (SG/HK/MY), including language nuances for Hong Kong Cantonese.

## External Dependencies

- **OpenAI:** gpt-4o (vision/text/agentic function-calling), gpt-image-1 (image generation, fallback).
- **字节跳动·火山引擎方舟 API:** 即梦 Seedream 5.0-lite (primary image generation).
- **ComfyUI:** For self-hosted GPU image generation fallback.
- **Clerk:** Replit-managed authentication service.
- **Replit Object Storage:** GCS-backed for file uploads.
- **TikHub (api.tikhub.io):** Priority 1 for XHS real data integration (search notes, note details).
- **RapidAPI (xiaohongshu-all-api.p.rapidapi.com):** Backup for XHS real data integration.
- **AutoDL:** Self-hosted scraper for XHS data (cookie-dependent).
- **PostgreSQL:** Primary database.
- **Express 5:** API framework.
- **React, Vite, Tailwind CSS v4, shadcn/ui:** Frontend technologies.
- **pnpm:** Monorepo package manager.