const GRAPH_API = "https://graph.facebook.com/v22.0";

const FACEBOOK_SCOPES = [
  "pages_manage_posts",
  "pages_read_engagement",
  "pages_show_list",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
].join(",");

import { generateState, consumeState } from "./state.js";

// state 持久化到 oauth_states 表 — 多实例 / 重启 / serverless 冷启不再丢失
export async function generateOAuthState(userId: number): Promise<string> {
  return generateState(userId, "meta");
}

export async function consumeOAuthState(state: string): Promise<number | null> {
  return consumeState(state, "meta");
}

export function isConfigured(): boolean {
  return !!(process.env["META_APP_ID"] && process.env["META_APP_SECRET"]);
}

export function getMetaConfig() {
  const appId = process.env["META_APP_ID"];
  const appSecret = process.env["META_APP_SECRET"];
  if (!appId || !appSecret) throw new Error("META_APP_ID 或 META_APP_SECRET 未配置");
  return { appId, appSecret };
}

export function buildAuthUrl(redirectUri: string, state: string): string {
  const { appId } = getMetaConfig();
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    scope: FACEBOOK_SCOPES,
    response_type: "code",
  });
  return `https://www.facebook.com/v22.0/dialog/oauth?${params}`;
}

export async function exchangeCodeForToken(code: string, redirectUri: string) {
  const { appId, appSecret } = getMetaConfig();
  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  });
  const res = await fetch(`${GRAPH_API}/oauth/access_token?${params}`);
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok || data["error"]) {
    throw new Error(`获取 Token 失败: ${JSON.stringify(data["error"] ?? data)}`);
  }
  return data as { access_token: string; expires_in?: number };
}

export async function getLongLivedToken(shortToken: string): Promise<string> {
  const { appId, appSecret } = getMetaConfig();
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortToken,
  });
  const res = await fetch(`${GRAPH_API}/oauth/access_token?${params}`);
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok || data["error"]) {
    throw new Error(`换取长效 Token 失败: ${JSON.stringify(data["error"] ?? data)}`);
  }
  return data["access_token"] as string;
}

export interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
  category?: string;
  instagram_business_account?: { id: string };
}

export async function getUserPages(userToken: string): Promise<FacebookPage[]> {
  const res = await fetch(
    `${GRAPH_API}/me/accounts?fields=id,name,access_token,category,instagram_business_account&access_token=${userToken}`,
  );
  const data = (await res.json()) as { data?: FacebookPage[]; error?: unknown };
  if (!res.ok || data.error) {
    throw new Error(`获取 Pages 失败: ${JSON.stringify(data.error ?? data)}`);
  }
  return data.data ?? [];
}

export async function getInstagramAccount(pageId: string, pageToken: string) {
  const res = await fetch(
    `${GRAPH_API}/${pageId}?fields=instagram_business_account{id,name,username}&access_token=${pageToken}`,
  );
  const data = (await res.json()) as {
    instagram_business_account?: { id: string; name: string; username: string };
  };
  return data.instagram_business_account ?? null;
}

export async function publishToFacebookPage(
  pageId: string,
  pageToken: string,
  message: string,
  imageUrl?: string,
): Promise<{ id: string }> {
  const endpoint = imageUrl ? `${GRAPH_API}/${pageId}/photos` : `${GRAPH_API}/${pageId}/feed`;
  const body: Record<string, string> = { access_token: pageToken, message };
  if (imageUrl) body["url"] = imageUrl;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { id?: string; error?: unknown };
  if (!res.ok || data.error || !data.id) {
    throw new Error(`Facebook 发布失败: ${JSON.stringify(data.error ?? data)}`);
  }
  return { id: data.id };
}

// 轮询 IG 媒体容器状态，直到 FINISHED（视频/Reels 必需，否则 media_publish 必失败）
async function waitForIgContainerReady(
  containerId: string,
  pageToken: string,
  opts: { maxWaitMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const maxWaitMs = opts.maxWaitMs ?? 5 * 60 * 1000; // 5 分钟
  const intervalMs = opts.intervalMs ?? 4000;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const res = await fetch(
      `${GRAPH_API}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(pageToken)}`,
    );
    const data = (await res.json()) as { status_code?: string; status?: string; error?: unknown };
    if (!res.ok || data.error) {
      throw new Error(`Instagram 容器状态查询失败: ${JSON.stringify(data.error ?? data)}`);
    }
    if (data.status_code === "FINISHED" || data.status_code === "PUBLISHED") return;
    if (data.status_code === "ERROR" || data.status_code === "EXPIRED") {
      throw new Error(`Instagram 媒体处理失败: ${data.status_code} ${data.status ?? ""}`);
    }
    // IN_PROGRESS 继续轮询
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Instagram 媒体处理超时（5 分钟），请稍后重试");
}

export async function publishToInstagram(
  igAccountId: string,
  pageToken: string,
  caption: string,
  media: { imageUrl?: string; videoUrl?: string },
): Promise<{ id: string }> {
  const isVideo = !!media.videoUrl;
  const body: Record<string, string> = { caption, access_token: pageToken };
  if (isVideo) {
    body["media_type"] = "REELS"; // 2024+ 视频必须走 Reels
    body["video_url"] = media.videoUrl!;
  } else if (media.imageUrl) {
    body["image_url"] = media.imageUrl;
  } else {
    throw new Error("Instagram 必须提供图片或视频 URL");
  }
  const mediaRes = await fetch(`${GRAPH_API}/${igAccountId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const mediaData = (await mediaRes.json()) as { id?: string; error?: unknown };
  if (!mediaRes.ok || mediaData.error || !mediaData.id) {
    throw new Error(`Instagram 创建媒体失败: ${JSON.stringify(mediaData.error ?? mediaData)}`);
  }
  // 视频必须轮询，图片为安全起见也轻量轮询一次
  await waitForIgContainerReady(mediaData.id, pageToken, isVideo
    ? { maxWaitMs: 5 * 60 * 1000, intervalMs: 4000 }
    : { maxWaitMs: 30 * 1000, intervalMs: 2000 });
  const publishRes = await fetch(`${GRAPH_API}/${igAccountId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: mediaData.id, access_token: pageToken }),
  });
  const publishData = (await publishRes.json()) as { id?: string; error?: unknown };
  if (!publishRes.ok || publishData.error || !publishData.id) {
    throw new Error(`Instagram 发布失败: ${JSON.stringify(publishData.error ?? publishData)}`);
  }
  return { id: publishData.id };
}
