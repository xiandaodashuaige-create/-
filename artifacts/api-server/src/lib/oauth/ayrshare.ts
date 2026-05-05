import { logger } from "../logger.js";

const AYRSHARE_BASE = "https://api.ayrshare.com/api";

export type AyrsharePlatform = "facebook" | "instagram" | "tiktok";

function getApiKey(): string | undefined {
  return process.env["AYRSHARE_API_KEY"];
}

function authHeaders(profileKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getApiKey()}`,
    "Content-Type": "application/json",
  };
  if (profileKey) headers["Profile-Key"] = profileKey;
  return headers;
}

export function isConfigured(): boolean {
  return !!getApiKey();
}

export function getDashboardUrl(): string {
  return "https://app.ayrshare.com/social-accounts";
}

export interface PlatformInfo {
  platform: string;
  displayName: string;
  username: string;
  userImage?: string;
}

export interface PlatformStatus {
  facebook: boolean;
  instagram: boolean;
  tiktok: boolean;
  platforms: string[];
  displayNames: PlatformInfo[];
}

export async function getLinkedPlatforms(profileKey?: string): Promise<PlatformStatus> {
  const empty: PlatformStatus = {
    facebook: false,
    instagram: false,
    tiktok: false,
    platforms: [],
    displayNames: [],
  };
  if (!isConfigured()) return empty;
  try {
    const res = await fetch(`${AYRSHARE_BASE}/user`, { headers: authHeaders(profileKey) });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Ayrshare getLinkedPlatforms failed");
      return empty;
    }
    const data = (await res.json()) as {
      activeSocialAccounts?: string[];
      displayNames?: Array<{ platform: string; displayName?: string; pageName?: string; username?: string; userImage?: string }>;
    };
    const active: string[] = data.activeSocialAccounts ?? [];
    const displayNames: PlatformInfo[] = (data.displayNames ?? []).map((d) => ({
      platform: d.platform,
      displayName: d.displayName ?? d.pageName ?? "",
      username: d.username ?? "",
      userImage: d.userImage,
    }));
    return {
      facebook: active.includes("facebook"),
      instagram: active.includes("instagram"),
      tiktok: active.includes("tiktok"),
      platforms: active,
      displayNames,
    };
  } catch (err) {
    logger.error({ err }, "Ayrshare getLinkedPlatforms error");
    return empty;
  }
}

export interface PublishParams {
  platforms: AyrsharePlatform[];
  mediaUrls: string[];
  caption: string;
  hashtags?: string[];
  scheduledAt?: string;
  privacyLevel?: "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "SELF_ONLY";
  profileKey?: string;
  isVideo?: boolean;
}

export interface PublishResult {
  success: boolean;
  postId?: string;
  postIds?: Record<string, string>;
  errorMessage?: string;
  scheduledAt?: string;
}

export async function publishToSocial(params: PublishParams): Promise<PublishResult> {
  if (!isConfigured()) return { success: false, errorMessage: "AYRSHARE_API_KEY not configured" };

  const caption = params.hashtags?.length
    ? `${params.caption} ${params.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}`
    : params.caption;

  const body: Record<string, unknown> = {
    post: caption,
    platforms: params.platforms,
    mediaUrls: params.mediaUrls,
    isVideo: params.isVideo ?? false,
  };

  if (params.scheduledAt) body["scheduleDate"] = params.scheduledAt;

  if (params.platforms.includes("tiktok")) {
    body["tikTokOptions"] = {
      privacy_level: params.privacyLevel ?? "PUBLIC_TO_EVERYONE",
      disable_comment: false,
      disable_duet: false,
      disable_stitch: false,
    };
  }
  if (params.platforms.includes("instagram")) body["instagramOptions"] = { reels: !!params.isVideo };
  if (params.platforms.includes("facebook")) body["faceBookOptions"] = { mediaCaptions: caption };

  try {
    const res = await fetch(`${AYRSHARE_BASE}/post`, {
      method: "POST",
      headers: authHeaders(params.profileKey),
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as {
      id?: string;
      status?: string;
      postIds?: Record<string, string>;
      errors?: Array<{ message: string }>;
      message?: string;
    };
    if (data.status === "success" || data.id) {
      logger.info({ postId: data.id, platforms: params.platforms }, "Ayrshare post initiated");
      return { success: true, postId: data.id, postIds: data.postIds, scheduledAt: params.scheduledAt };
    }
    const errorMessage = data.errors?.[0]?.message ?? data.message ?? "Unknown error";
    logger.error({ data, platforms: params.platforms }, "Ayrshare post failed");
    return { success: false, errorMessage };
  } catch (err) {
    logger.error({ err, platforms: params.platforms }, "Ayrshare publish error");
    return { success: false, errorMessage: "Network error publishing to Ayrshare" };
  }
}

export async function getPostStatus(postId: string, profileKey?: string) {
  if (!isConfigured()) return { status: "error", errors: ["Ayrshare not configured"] };
  try {
    const res = await fetch(`${AYRSHARE_BASE}/post/${postId}`, { headers: authHeaders(profileKey) });
    const data = (await res.json()) as {
      status?: string;
      postIds?: Record<string, string>;
      errors?: Array<{ message: string }>;
    };
    return {
      status: data.status ?? "unknown",
      postIds: data.postIds,
      errors: data.errors?.map((e) => e.message),
    };
  } catch (err) {
    logger.error({ err, postId }, "Ayrshare getPostStatus error");
    return { status: "error", errors: ["Failed to check post status"] };
  }
}
