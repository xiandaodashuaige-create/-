# Workspace

## Overview

This project, **鹿联小红书AI爆款创作间 (LuLian XHS Viral Creator)**, is an AI-powered content creation monorepo designed to help users generate and publish viral content on Xiaohongshu (XHS). It analyzes industry content strategies, offers AI-driven rewriting and image generation, and includes features like sensitive word detection, multi-region support (SG/HK/MY), and AI-recommended posting times. The platform aims to streamline content creation for clients, from strategy analysis to final publication, leveraging advanced AI models to produce original and engaging content.

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