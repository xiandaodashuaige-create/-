const TIKTOK_AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const TIKTOK_SCOPES = ["user.info.basic", "video.publish", "video.upload"].join(",");

import { generateState, consumeState } from "./state.js";

// state 持久化到 oauth_states 表 — 多实例 / 重启 / serverless 冷启不再丢失
export async function generateOAuthState(userId: number): Promise<string> {
  return generateState(userId, "tiktok");
}

export async function consumeOAuthState(state: string): Promise<number | null> {
  return consumeState(state, "tiktok");
}

export function isConfigured(): boolean {
  return !!(process.env["TIKTOK_CLIENT_KEY"] && process.env["TIKTOK_CLIENT_SECRET"]);
}

export function getTikTokConfig() {
  const clientKey = process.env["TIKTOK_CLIENT_KEY"];
  const clientSecret = process.env["TIKTOK_CLIENT_SECRET"];
  if (!clientKey || !clientSecret) throw new Error("TIKTOK_CLIENT_KEY 或 TIKTOK_CLIENT_SECRET 未配置");
  return { clientKey, clientSecret };
}

export function buildAuthUrl(redirectUri: string, state: string): string {
  const { clientKey } = getTikTokConfig();
  const params = new URLSearchParams({
    client_key: clientKey,
    redirect_uri: redirectUri,
    state,
    scope: TIKTOK_SCOPES,
    response_type: "code",
  });
  return `${TIKTOK_AUTH_URL}?${params}`;
}

export async function exchangeCodeForToken(code: string, redirectUri: string) {
  const { clientKey, clientSecret } = getTikTokConfig();
  const res = await fetch(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok || (data["error"] && data["error"] !== "ok")) {
    throw new Error(`TikTok Token 获取失败: ${JSON.stringify(data)}`);
  }
  return data as {
    access_token: string;
    expires_in: number;
    refresh_token: string;
    refresh_expires_in: number;
    open_id: string;
  };
}

export async function refreshAccessToken(refreshToken: string) {
  const { clientKey, clientSecret } = getTikTokConfig();
  const res = await fetch(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok || (data["error"] && data["error"] !== "ok")) {
    throw new Error(`TikTok Token 刷新失败: ${JSON.stringify(data)}`);
  }
  return data as {
    access_token: string;
    expires_in: number;
    refresh_token: string;
    refresh_expires_in: number;
  };
}

export async function publishVideoToTikTok(
  accessToken: string,
  videoUrl: string,
  title: string,
  options: { privacyLevel?: string; mode?: "auto" | "direct" | "inbox" } = {},
): Promise<{ publish_id: string; mode: "direct" | "inbox"; note?: string }> {
  const mode = options.mode || "auto";
  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) throw new Error(`下载视频失败 (${videoRes.status}): ${videoUrl}`);
  const videoBuf = Buffer.from(await videoRes.arrayBuffer());
  const videoSize = videoBuf.length;
  if (videoSize < 5 * 1024) throw new Error(`视频太小（${videoSize} bytes），TikTok 要求最少 5KB`);
  if (videoSize > 64 * 1024 * 1024)
    throw new Error(`视频太大（${(videoSize / 1024 / 1024).toFixed(1)} MB），单分片上传 ≤ 64MB`);

  async function putBytes(uploadUrl: string) {
    const r = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(videoSize),
        "Content-Range": `bytes 0-${videoSize - 1}/${videoSize}`,
      },
      body: videoBuf,
    });
    if (!r.ok) throw new Error(`TikTok 视频字节上传失败 (${r.status}): ${await r.text()}`);
  }

  async function tryDirect(): Promise<{ publish_id: string; mode: "direct" }> {
    const privacyLevel = options.privacyLevel || "SELF_ONLY";
    const initRes = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        post_info: {
          title: title.slice(0, 2200),
          privacy_level: privacyLevel,
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
          video_cover_timestamp_ms: 1000,
        },
        source_info: { source: "FILE_UPLOAD", video_size: videoSize, chunk_size: videoSize, total_chunk_count: 1 },
      }),
    });
    const initData = (await initRes.json()) as {
      data?: { publish_id?: string; upload_url?: string };
      error?: { code?: string; message?: string };
    };
    if (!initRes.ok || (initData.error?.code && initData.error.code !== "ok")) {
      const err: Error & { code?: string } = new Error(
        `TikTok Direct init 失败: ${JSON.stringify(initData.error ?? initData)}`,
      );
      err.code = initData.error?.code;
      throw err;
    }
    const { publish_id, upload_url } = initData.data || {};
    if (!publish_id || !upload_url) throw new Error(`TikTok init 缺字段: ${JSON.stringify(initData)}`);
    await putBytes(upload_url);
    return { publish_id, mode: "direct" };
  }

  async function tryInbox(): Promise<{ publish_id: string; mode: "inbox" }> {
    const initRes = await fetch("https://open.tiktokapis.com/v2/post/publish/inbox/video/init/", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        source_info: { source: "FILE_UPLOAD", video_size: videoSize, chunk_size: videoSize, total_chunk_count: 1 },
      }),
    });
    const initData = (await initRes.json()) as {
      data?: { publish_id?: string; upload_url?: string };
      error?: { code?: string; message?: string };
    };
    if (!initRes.ok || (initData.error?.code && initData.error.code !== "ok")) {
      throw new Error(`TikTok Inbox init 失败: ${JSON.stringify(initData.error ?? initData)}`);
    }
    const { publish_id, upload_url } = initData.data || {};
    if (!publish_id || !upload_url) throw new Error(`TikTok inbox init 缺字段: ${JSON.stringify(initData)}`);
    await putBytes(upload_url);
    return { publish_id, mode: "inbox" };
  }

  if (mode === "direct") return tryDirect();
  if (mode === "inbox") {
    const r = await tryInbox();
    return { ...r, note: "已上传到 TikTok 草稿箱，请打开手机 App 确认发布" };
  }
  try {
    return await tryDirect();
  } catch (err: unknown) {
    const e = err as Error & { code?: string };
    const code = e.code ?? "";
    const msg = e.message ?? "";
    const shouldFallback =
      code === "unaudited_client_can_only_post_to_private_accounts" ||
      code === "spam_risk_user_banned_from_posting" ||
      msg.includes("unaudited_client") ||
      msg.includes("private_accounts");
    if (!shouldFallback) throw err;
    const r = await tryInbox();
    return { ...r, note: "Direct Post 受 Sandbox 限制，已自动改为草稿箱模式 — 请打开 TikTok App 确认发布" };
  }
}

export async function getUserInfo(accessToken: string) {
  const res = await fetch(
    "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const data = (await res.json()) as {
    data?: { user?: Record<string, unknown> };
    error?: { code?: string; message?: string };
  };
  if (!res.ok || (data.error?.code && data.error.code !== "ok")) {
    throw new Error(`获取 TikTok 用户信息失败: ${JSON.stringify(data.error ?? data)}`);
  }
  return data.data?.user as { open_id: string; display_name: string; avatar_url: string };
}
