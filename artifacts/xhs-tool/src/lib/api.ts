import { getAuthToken } from "./auth";

const BASE = `${import.meta.env.BASE_URL}`.replace(/\/$/, "");
const API_BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers,
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const error = new Error(err.error || res.statusText) as any;
    error.status = res.status;
    error.required = err.required;
    error.current = err.current;
    error.operation = err.operation;
    throw error;
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  dashboard: {
    stats: (params?: { platform?: string }) => {
      const q = new URLSearchParams();
      if (params?.platform) q.set("platform", params.platform);
      return request<any>(`/dashboard/stats${q.toString() ? `?${q}` : ""}`);
    },
    recentActivity: (limit = 10, platform?: string) => {
      const q = new URLSearchParams();
      q.set("limit", String(limit));
      if (platform) q.set("platform", platform);
      return request<any[]>(`/dashboard/recent-activity?${q}`);
    },
    contentByRegion: (params?: { platform?: string }) => {
      const q = new URLSearchParams();
      if (params?.platform) q.set("platform", params.platform);
      return request<any[]>(`/dashboard/content-by-region${q.toString() ? `?${q}` : ""}`);
    },
    contentByStatus: (params?: { platform?: string }) => {
      const q = new URLSearchParams();
      if (params?.platform) q.set("platform", params.platform);
      return request<any[]>(`/dashboard/content-by-status${q.toString() ? `?${q}` : ""}`);
    },
  },
  accounts: {
    list: (params?: { platform?: string; region?: string; status?: string }) => {
      const q = new URLSearchParams();
      if (params?.platform) q.set("platform", params.platform);
      if (params?.region) q.set("region", params.region);
      if (params?.status) q.set("status", params.status);
      return request<any[]>(`/accounts?${q.toString()}`);
    },
    get: (id: number) => request<any>(`/accounts/${id}`),
    create: (data: any) => request<any>("/accounts", { method: "POST", body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/accounts/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    delete: (id: number) => request<void>(`/accounts/${id}`, { method: "DELETE" }),
  },
  content: {
    list: (params?: { accountId?: number; platform?: string; status?: string; region?: string }) => {
      const q = new URLSearchParams();
      if (params?.accountId) q.set("accountId", String(params.accountId));
      if (params?.platform) q.set("platform", params.platform);
      if (params?.status) q.set("status", params.status);
      if (params?.region) q.set("region", params.region);
      return request<any[]>(`/content?${q.toString()}`);
    },
    get: (id: number) => request<any>(`/content/${id}`),
    create: (data: any) => request<any>("/content", { method: "POST", body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/content/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    delete: (id: number) => request<void>(`/content/${id}`, { method: "DELETE" }),
    schedule: (id: number, scheduledAt: string) =>
      request<any>(`/content/${id}/schedule`, { method: "POST", body: JSON.stringify({ scheduledAt }) }),
    publish: (id: number) => request<any>(`/content/${id}/publish`, { method: "POST" }),
  },
  assets: {
    list: (params?: { accountId?: number; type?: string }) => {
      const q = new URLSearchParams();
      if (params?.accountId) q.set("accountId", String(params.accountId));
      if (params?.type) q.set("type", params.type);
      return request<any[]>(`/assets?${q.toString()}`);
    },
    create: (data: any) => request<any>("/assets", { method: "POST", body: JSON.stringify(data) }),
    delete: (id: number) => request<void>(`/assets/${id}`, { method: "DELETE" }),
  },
  ai: {
    rewrite: (data: any) => request<any>("/ai/rewrite", { method: "POST", body: JSON.stringify(data) }),
    refineScheduleItem: (data: { current: { title?: string; body?: string; tags?: string[] }; instruction: string; niche?: string; platform?: string }) =>
      request<{ title: string; body: string; tags: string[] }>("/ai/refine-schedule-item", { method: "POST", body: JSON.stringify(data) }),
    checkNicheFit: (data: { accountId: number; niche: string }) =>
      request<{ fit: number; accountSummary: string; suggestedNiche: string; reason: string; hasHistory: boolean }>(
        "/ai/check-niche-fit",
        { method: "POST", body: JSON.stringify(data) },
      ),
    checkSensitivity: (data: any) => request<any>("/ai/check-sensitivity", { method: "POST", body: JSON.stringify(data) }),
    generateTitle: (data: any) => request<any>("/ai/generate-title", { method: "POST", body: JSON.stringify(data) }),
    generateHashtags: (data: any) => request<any>("/ai/generate-hashtags", { method: "POST", body: JSON.stringify(data) }),
    generateImage: (data: { prompt: string; style?: string; size?: string }) =>
      request<{ imageUrl: string; objectPath: string | null; storedUrl: string | null }>(
        "/ai/generate-image",
        { method: "POST", body: JSON.stringify(data) }
      ),
    editImage: (data: { prompt: string; referenceImageUrl: string; size?: string }) =>
      request<{ imageUrl: string; objectPath: string | null; storedUrl: string | null }>(
        "/ai/edit-image",
        { method: "POST", body: JSON.stringify(data) }
      ),
    generateImagePipeline: (data: {
      referenceImageUrl: string;
      newTopic: string;
      newTitle?: string;
      newKeyPoints?: string[];
      mimicStrength?: "full" | "partial" | "minimal";
      customTextOverlays?: Array<{ text: string; position: string }>;
      customEmojis?: string[];
      extraInstructions?: string;
      size?: string;
      layoutMode?: "single" | "dual-vertical" | "dual-horizontal" | "grid-2x2" | "left-big-right-small";
      preferredProvider?: "seedream" | "comfyui" | "openai";
      platform?: "xhs" | "tiktok" | "instagram" | "facebook";
    }) =>
      request<{
        imageUrl: string;
        storedUrl: string;
        objectPath: string;
        analysis: any;
        promptUsed: string;
        textOverlays: Array<{ text: string; position: string; style: string }>;
        emojis: string[];
        provider: string;
        durationMs: number;
        referenceId: number | null;
        styleProfileUsed: boolean;
      }>("/ai/generate-image-pipeline", { method: "POST", body: JSON.stringify(data) }),
    imageFeedback: (data: { referenceId: number; accepted?: boolean; rating?: number; feedbackText?: string }) =>
      request<{ ok: true }>("/ai/image-feedback", { method: "POST", body: JSON.stringify(data) }),
    assistantChat: (data: {
      message: string;
      history: Array<{ role: "user" | "assistant"; content: string }>;
      context: {
        referenceImageUrl?: string | null;
        generatedImageUrl?: string | null;
        topic?: string | null;
        title?: string | null;
        layout: string;
        mimicStrength: string;
        textOverlays: Array<{ text: string; position: string; style?: string }>;
        emojis: string[];
        imagePromptUsed?: string | null;
      };
    }) =>
      request<{
        message: string;
        actions: Array<{
          type: "regenerate" | "change_layout" | "change_mimic_strength" | "edit_texts" | "set_emojis" | "extra_instructions" | "no_action";
          reason: string;
          newLayout?: string;
          newStrength?: string;
          newOverlays?: Array<{ text: string; position: string; style?: string }>;
          newEmojis?: string[];
          instructions?: string;
        }>;
      }>("/ai/assistant-chat", { method: "POST", body: JSON.stringify(data) }),
    competitorResearch: (data: { businessDescription?: string; competitorLink?: string; niche?: string; region?: string }) =>
      request<any>("/ai/competitor-research", { method: "POST", body: JSON.stringify(data) }),
    generateWeeklyPlan: (data: {
      platform: "xhs" | "tiktok" | "instagram" | "facebook";
      niche: string;
      region?: string;
      frequency?: "daily" | "twice-daily" | "every-other-day" | "weekly-3";
      audience?: string;
      styleHints?: string;
      language?: "zh" | "en";
    }) =>
      request<{
        items: Array<{ dayOffset: number; time: string; title: string; body: string; tags: string[]; imagePrompt?: string; topic?: string }>;
        viralMeta: { sampleCount: number; hasViralData: boolean; warning: string | null; topHashtags: string[] };
      }>(
        "/ai/generate-weekly-plan",
        { method: "POST", body: JSON.stringify(data) },
      ),
    myContentProfile: () =>
      request<{
        sampleSize: number;
        favoriteTags: Array<{ value: string; count: number }>;
        preferredTitlePatterns: Array<{ value: string; count: number }>;
        preferredOpenings: Array<{ value: string; count: number }>;
        preferredEmojis: Array<{ value: string; count: number }>;
        preferredRegions: Array<{ value: string; count: number }>;
        avgBodyLength: number;
        avgTagCount: number;
        lastUpdated: string | null;
      }>("/ai/my-content-profile"),
  },
  admin: {
    stats: () => request<any>("/admin/stats"),
    users: () => request<any[]>("/admin/users"),
    creditCosts: () => request<any>("/admin/credit-costs"),
    updateUser: (id: number, data: any) => request<any>(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    adjustCredits: (id: number, amount: number, description?: string) =>
      request<any>(`/admin/users/${id}/credits`, { method: "POST", body: JSON.stringify({ amount, description }) }),
    userTransactions: (id: number, limit = 50) => request<any[]>(`/admin/users/${id}/transactions?limit=${limit}`),
  },
  user: {
    me: () => request<any>("/user/me"),
    update: (data: any) => request<any>("/user/me", { method: "PATCH", body: JSON.stringify(data) }),
    transactions: (limit = 20) => request<any[]>(`/user/me/transactions?limit=${limit}`),
  },
  brandProfile: {
    get: (platform: "xhs" | "tiktok" | "instagram" | "facebook") =>
      request<{
        id: number; platform: string;
        category: string | null; products: string | null; targetAudience: string | null;
        priceRange: string | null; tone: string | null; forbiddenClaims: string[];
        conversionGoal: string | null; region: string | null; language: string | null;
        extras: Record<string, unknown> | null;
      } | null>(`/brand-profile?platform=${platform}`),
    upsert: (data: {
      platform: "xhs" | "tiktok" | "instagram" | "facebook";
      category?: string | null;
      products?: string | null;
      targetAudience?: string | null;
      priceRange?: string | null;
      tone?: string | null;
      forbiddenClaims?: string[];
      conversionGoal?: string | null;
      region?: string | null;
      language?: string | null;
    }) =>
      request<any>("/brand-profile", { method: "PUT", body: JSON.stringify(data) }),
  },
  schedules: {
    list: (params?: { accountId?: number; startDate?: string; endDate?: string }) => {
      const q = new URLSearchParams();
      if (params?.accountId) q.set("accountId", String(params.accountId));
      if (params?.startDate) q.set("startDate", params.startDate);
      if (params?.endDate) q.set("endDate", params.endDate);
      return request<any[]>(`/schedules?${q.toString()}`);
    },
    delete: (id: number) => request<void>(`/schedules/${id}`, { method: "DELETE" }),
    summary: (month?: string) => {
      const q = month ? `?month=${encodeURIComponent(month)}` : "";
      return request<{
        month: string; total: number; pending: number; paused: number; published: number; failed: number;
        byDay: { date: string; count: number }[];
        platforms: { platform: string; count: number }[];
      }>(`/schedules/summary${q}`);
    },
    update: (id: number, data: { scheduledAt?: string; title?: string; body?: string; tags?: string[]; imageUrls?: string[]; status?: "pending" | "paused" }) =>
      request<{ ok: true; id: number }>(`/schedules/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    pause: (id: number) =>
      request<{ ok: true; id: number; status: string }>(`/schedules/${id}/pause`, { method: "POST" }),
    resume: (id: number) =>
      request<{ ok: true; id: number; status: string }>(`/schedules/${id}/resume`, { method: "POST" }),
    retry: (id: number) =>
      request<{ ok: true; id: number; status: string }>(`/schedules/${id}/retry`, { method: "POST" }),
    bulkAction: (ids: number[], action: "pause" | "resume" | "delete") =>
      request<{ ok: true; affected: number }>(`/schedules/bulk-action`, { method: "POST", body: JSON.stringify({ ids, action }) }),
    bulkCreate: (data: {
      accountId: number;
      startDate: string;
      items: Array<{ dayOffset: number; time: string; title: string; body: string; tags?: string[]; imagePrompt?: string }>;
      tz?: string;
    }) => request<{ created: number; items: Array<{ contentId: number; scheduleId: number; scheduledAt: string }> }>(
      "/schedules/bulk-create",
      {
        method: "POST",
        body: JSON.stringify({
          tz: data.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
          ...data,
        }),
      },
    ),
    duplicateWeeks: (data: { accountId: number; startDate: string; endDate: string; weeks: number }) =>
      request<{ created: number; weeks: number }>(
        "/schedules/duplicate-weeks",
        { method: "POST", body: JSON.stringify(data) },
      ),
  },
  sensitiveWords: {
    list: () => request<any[]>("/sensitive-words"),
    create: (data: any) => request<any>("/sensitive-words", { method: "POST", body: JSON.stringify(data) }),
    delete: (id: number) => request<void>(`/sensitive-words/${id}`, { method: "DELETE" }),
  },
  tracking: {
    list: () => request<any[]>("/tracking/notes"),
    get: (id: number) => request<any>(`/tracking/notes/${id}`),
    add: (data: { xhsUrl: string; title?: string; targetKeywords?: string[]; contentId?: number; accountId?: number; region?: string }) =>
      request<any>("/tracking/notes", { method: "POST", body: JSON.stringify(data) }),
    refresh: (id: number) => request<any>(`/tracking/notes/${id}/refresh`, { method: "POST" }),
    remove: (id: number) => request<void>(`/tracking/notes/${id}`, { method: "DELETE" }),
    hotTopics: (niche: string, region: string = "ALL") => {
      const q = new URLSearchParams({ niche, region });
      return request<{ topics: any[]; samplesAnalyzed: number; cached: boolean; date: string }>(
        `/tracking/hot-topics?${q.toString()}`,
      );
    },
  },
  competitors: {
    list: (platform?: string) => {
      const q = new URLSearchParams();
      if (platform) q.set("platform", platform);
      return request<any[]>(`/competitors${q.toString() ? `?${q}` : ""}`);
    },
    add: (data: { platform: string; handle: string; region?: string }, opts?: { signal?: AbortSignal }) =>
      request<any>(`/competitors`, { method: "POST", body: JSON.stringify(data), signal: opts?.signal }),
    remove: (id: number) => request<void>(`/competitors/${id}`, { method: "DELETE" }),
    posts: (id: number) => request<any[]>(`/competitors/${id}/posts`),
    sync: (id: number, opts?: { signal?: AbortSignal }) =>
      request<any>(`/competitors/${id}/sync`, { method: "POST", signal: opts?.signal }),
    discover: (platform: string, keyword: string, limit = 10, opts?: { signal?: AbortSignal }) => {
      const q = new URLSearchParams({ platform, keyword, limit: String(limit) });
      return request<{ platform: string; keyword: string; creators: any[]; note?: string }>(
        `/competitors/discover?${q}`,
        { signal: opts?.signal },
      );
    },
    trending: (platform?: string, limit = 10) => {
      const q = new URLSearchParams({ limit: String(limit) });
      if (platform) q.set("platform", platform);
      return request<any[]>(`/competitors/trending?${q}`);
    },
    starPost: (postId: number, starred: boolean) =>
      request<any>(`/competitor-posts/${postId}/star`, { method: "PATCH", body: JSON.stringify({ starred }) }),
    transcribePost: (postId: number) =>
      request<{ transcript: string; cached?: boolean }>(`/competitor-posts/${postId}/transcribe`, { method: "POST" }),
    operationsStrategy: (platform: string, niche?: string, opts?: { signal?: AbortSignal }) => {
      const q = new URLSearchParams({ platform });
      if (niche) q.set("niche", niche);
      return request<{
        platform: string;
        niche: string | null;
        strategy: {
          summary: string;
          contentPillars: { name: string; ratio: number; description: string }[];
          weeklyCadence: { postsPerWeek: number; rationale: string };
          hookTemplates: { template: string; evidence: string }[];
          hashtagStrategy: { core: string[]; rotation: string[] };
          bestPostingWindows: string[];
          doList: string[];
          dontList: string[];
          next30DaysRoadmap: { week: number; focus: string; deliverables: string }[];
        };
        meta: {
          competitorsAnalyzed: number;
          starredSamples: number;
          viralSamples: number;
          totalSamplesUsed: number;
          generatedAt: string;
        };
      }>(`/competitors/strategy?${q}`, { signal: opts?.signal });
    },
    insights: (platform?: string) => {
      const q = new URLSearchParams();
      if (platform) q.set("platform", platform);
      return request<{
        platform: string;
        competitorsAnalyzed: number;
        postsAnalyzed: number;
        totalViews: number;
        totalLikes: number;
        avgEngagementRate: number;
        avgVideoLengthSec: number;
        bestPostingHoursLocal: number[];
        timezoneLabel: string;
        topHashtags: { tag: string; count: number }[];
        topMusicTracks: { track: string; count: number }[];
        viralFormula: string;
        durationStrategy: string;
        hashtagStrategy: string;
        bgmStrategy: string;
        postingStrategy: string;
        keyInsights: string[];
        competitorBreakdown: { handle: string; followers: number; posts: number; avgViews: number; topHook: string }[];
      }>(`/competitors/insights/aggregate${q.toString() ? `?${q}` : ""}`);
    },
  },
  strategy: {
    list: (platform?: string) => {
      const q = new URLSearchParams();
      if (platform) q.set("platform", platform);
      return request<any[]>(`/strategy${q.toString() ? `?${q}` : ""}`);
    },
    get: (id: number) => request<any>(`/strategy/${id}`),
    generate: (data: {
      platform: string;
      region?: string;
      niche?: string;
      competitorPostIds?: number[];
      accountIds?: number[];
      customRequirements?: string;
    }, opts?: { signal?: AbortSignal }) => request<{ id: number; status: string; platform: string; strategy: any; meta: any }>(
      `/strategy/generate`, { method: "POST", body: JSON.stringify(data), signal: opts?.signal },
    ),
    approve: (id: number) =>
      request<{ id: number; status: string; contentId: number }>(
        `/strategy/${id}/approve`, { method: "POST" },
      ),
  },
  oauth: {
    status: () =>
      request<{
        authenticated: boolean;
        configured: { meta: boolean; tiktok: boolean; ayrshare: boolean; ayrshareDashboardUrl?: string };
        connected: Record<string, Array<{ id: number; nickname: string; platformAccountId: string | null; oauthExpiresAt: string | null; ayrshareProfileKey: string | null }>>;
      }>(`/oauth/status`),
    getAuthUrl: (platform: "tiktok" | "facebook") =>
      request<{ authUrl: string; redirectUri: string }>(`/oauth/${platform}/connect?json=1`),
    disconnect: (accountId: number) =>
      request<{ ok: true }>(`/oauth/disconnect`, { method: "POST", body: JSON.stringify({ accountId }) }),
    ayrshareSync: () =>
      request<{ synced: number; accounts: string[] }>(`/oauth/ayrshare/sync`, { method: "POST" }),
  },
  marketData: {
    trending: (platform: string, keyword: string, region = "MY") => {
      const q = new URLSearchParams({ platform, keyword, region });
      return request<{ platform: string; source: string; items: any[] }>(`/market-data/trending?${q}`);
    },
    ads: (keyword: string, country = "MY") => {
      const q = new URLSearchParams({ keyword, country });
      return request<{ source: string; configured: boolean; items: any[] }>(`/market-data/ads?${q}`);
    },
    bestTimes: () => request<Record<string, { bestDays: string[]; bestHours: number[]; insight: string }>>(
      `/market-data/best-times`,
    ),
  },
};
