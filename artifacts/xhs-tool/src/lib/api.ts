const BASE = `${import.meta.env.BASE_URL}`.replace(/\/$/, "");
const API_BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  dashboard: {
    stats: () => request<any>("/dashboard/stats"),
    recentActivity: (limit = 10) => request<any[]>(`/dashboard/recent-activity?limit=${limit}`),
    contentByRegion: () => request<any[]>("/dashboard/content-by-region"),
    contentByStatus: () => request<any[]>("/dashboard/content-by-status"),
  },
  accounts: {
    list: (params?: { region?: string; status?: string }) => {
      const q = new URLSearchParams();
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
    list: (params?: { accountId?: number; status?: string; region?: string }) => {
      const q = new URLSearchParams();
      if (params?.accountId) q.set("accountId", String(params.accountId));
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
    checkSensitivity: (data: any) => request<any>("/ai/check-sensitivity", { method: "POST", body: JSON.stringify(data) }),
    generateTitle: (data: any) => request<any>("/ai/generate-title", { method: "POST", body: JSON.stringify(data) }),
    generateHashtags: (data: any) => request<any>("/ai/generate-hashtags", { method: "POST", body: JSON.stringify(data) }),
    generateImage: (data: { prompt: string; style?: string; size?: string }) =>
      request<{ imageUrl: string; objectPath: string | null; storedUrl: string | null; revisedPrompt: string }>(
        "/ai/generate-image",
        { method: "POST", body: JSON.stringify(data) }
      ),
    competitorResearch: (data: { businessDescription?: string; competitorLink?: string; niche?: string; region?: string }) =>
      request<any>("/ai/competitor-research", { method: "POST", body: JSON.stringify(data) }),
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
  },
  sensitiveWords: {
    list: () => request<any[]>("/sensitive-words"),
    create: (data: any) => request<any>("/sensitive-words", { method: "POST", body: JSON.stringify(data) }),
    delete: (id: number) => request<void>(`/sensitive-words/${id}`, { method: "DELETE" }),
  },
};
