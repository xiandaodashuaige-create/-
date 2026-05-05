import { logger } from "../lib/logger";

// TikHub TikTok 抓取服务 — 用户画像 + 视频列表 + 关键词发现
const TIKHUB_BASE = "https://api.tikhub.io/api/v1";
const TIKHUB_API_KEY = process.env.TIKHUB_API_KEY || "";

export interface TikTokProfileData {
  handle: string;
  displayName: string;
  avatarUrl: string;
  bio: string;
  followerCount: number;
  followingCount: number;
  postCount: number;
  likeCount: number;
  verified: boolean;
  region?: string;
  secUid?: string;
}

export interface TikTokVideoData {
  externalId: string;
  description: string;
  coverUrl: string;
  videoUrl: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  duration: number;
  musicName: string;
  musicAuthor: string;
  hashtags: string[];
  publishedAt: Date | null;
  isViral: boolean;
}

export interface TikTokDiscoveredCreator {
  handle: string;
  displayName: string;
  avatarUrl: string;
  followerCount: number;
  videoCount: number;
  bio: string;
  category: string;
}

export function isTikHubConfigured(): boolean {
  return !!TIKHUB_API_KEY;
}

function isViral(playCount: number, likeCount: number): boolean {
  return playCount >= 100_000 || likeCount >= 10_000;
}

async function tikhubGet(path: string, params: Record<string, string | number>): Promise<any> {
  if (!TIKHUB_API_KEY) throw new Error("TIKHUB_API_KEY not configured");
  const url = new URL(`${TIKHUB_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url.toString(), {
    method: "GET",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${TIKHUB_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  if (!res.ok || (json?.code && json.code !== 200 && json.code !== 0)) {
    const msg = json?.message || json?.detail || text.slice(0, 300);
    throw new Error(`TikHub ${res.status}: ${msg}`);
  }
  return json?.data ?? null;
}

export async function fetchTikTokProfile(username: string): Promise<TikTokProfileData | null> {
  const handle = username.replace(/^@/, "").trim();
  if (!handle) return null;
  try {
    const data = await tikhubGet("/tiktok/web/fetch_user_profile", { uniqueId: handle });
    const ui = data?.userInfo;
    const u = ui?.user;
    const stats = ui?.stats || ui?.statsV2 || {};
    if (!u?.uniqueId) return null;
    return {
      handle: u.uniqueId,
      displayName: u.nickname || u.uniqueId,
      avatarUrl: u.avatarLarger || u.avatarMedium || u.avatarThumb || "",
      bio: u.signature || "",
      followerCount: Number(stats.followerCount) || 0,
      followingCount: Number(stats.followingCount) || 0,
      postCount: Number(stats.videoCount) || 0,
      likeCount: Number(stats.heartCount || stats.heart) || 0,
      verified: !!u.verified,
      region: u.region,
      secUid: u.secUid,
    };
  } catch (err: any) {
    logger.error({ err: err.message, handle }, "TikHub fetchTikTokProfile failed");
    return null;
  }
}

export async function fetchTikTokUserVideos(secUid: string, count = 12): Promise<TikTokVideoData[]> {
  if (!secUid) return [];
  try {
    const data = await tikhubGet("/tiktok/web/fetch_user_post", {
      secUid,
      cursor: 0,
      count: Math.min(Math.max(count, 1), 30),
    });
    const items = data?.itemList || [];
    return items.slice(0, count).map((it: any): TikTokVideoData => {
      const s = it.stats || {};
      const playCount = Number(s.playCount) || 0;
      const likeCount = Number(s.diggCount) || 0;
      const tags = Array.isArray(it.challenges)
        ? it.challenges.map((c: any) => `#${c.title || c.name || ""}`).filter((x: string) => x !== "#")
        : [];
      return {
        externalId: String(it.id || ""),
        description: String(it.desc || ""),
        coverUrl: it.video?.cover || it.video?.dynamicCover || it.video?.originCover || "",
        videoUrl: it.video?.playAddr || it.video?.downloadAddr || "",
        viewCount: playCount,
        likeCount,
        commentCount: Number(s.commentCount) || 0,
        shareCount: Number(s.shareCount) || 0,
        duration: Number(it.video?.duration) || 0,
        musicName: it.music?.title || "",
        musicAuthor: it.music?.authorName || "",
        hashtags: tags,
        publishedAt: it.createTime ? new Date(Number(it.createTime) * 1000) : null,
        isViral: isViral(playCount, likeCount),
      };
    });
  } catch (err: any) {
    logger.error({ err: err.message, secUid }, "TikHub fetchTikTokUserVideos failed");
    return [];
  }
}

export async function discoverTikTokCreators(keyword: string, count = 10): Promise<TikTokDiscoveredCreator[]> {
  if (!keyword.trim()) return [];
  try {
    const data = await tikhubGet("/tiktok/web/fetch_search_user", {
      keyword,
      count: Math.min(Math.max(count, 1), 30),
      cursor: 0,
    });
    const list = data?.user_list || [];
    if (!Array.isArray(list)) return [];
    return list
      .map((item: any): TikTokDiscoveredCreator => {
        const u = item.user_info || item;
        const avatars = u.avatar_thumb?.url_list;
        return {
          handle: u.unique_id || u.uniqueId || "",
          displayName: u.nickname || u.unique_id || "",
          avatarUrl: Array.isArray(avatars) && avatars.length > 0 ? avatars[0] : (u.avatarThumb || ""),
          followerCount: Number(u.follower_count) || 0,
          videoCount: Number(u.aweme_count) || 0,
          bio: u.signature || "",
          category: u.custom_verify || "",
        };
      })
      .filter((c: TikTokDiscoveredCreator) => !!c.handle)
      .sort((a: TikTokDiscoveredCreator, b: TikTokDiscoveredCreator) => b.followerCount - a.followerCount);
  } catch (err: any) {
    logger.error({ err: err.message, keyword }, "TikHub discoverTikTokCreators failed");
    return [];
  }
}

export async function fetchTrendingHashtagVideos(keyword: string, region = "MY", count = 20): Promise<TikTokVideoData[]> {
  if (!TIKHUB_API_KEY) return [];
  try {
    const url = `${TIKHUB_BASE}/tiktok/app/v3/fetch_trending_hashtag_videos?keyword=${encodeURIComponent(keyword)}&region=${region}&count=${count}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${TIKHUB_API_KEY}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const json = await res.json() as any;
    const videos = json?.data?.videos ?? [];
    return videos.map((v: any): TikTokVideoData => {
      const playCount = Number(v.play_count) || 0;
      const likeCount = Number(v.digg_count) || 0;
      return {
        externalId: String(v.id || v.aweme_id || ""),
        description: String(v.desc || ""),
        coverUrl: v.video?.cover || v.cover || "",
        videoUrl: v.video?.play_addr || "",
        viewCount: playCount,
        likeCount,
        commentCount: Number(v.comment_count) || 0,
        shareCount: Number(v.share_count) || 0,
        duration: Number(v.duration) || 0,
        musicName: v.music?.title || "",
        musicAuthor: v.music?.author || "",
        hashtags: [],
        publishedAt: v.create_time ? new Date(Number(v.create_time) * 1000) : null,
        isViral: isViral(playCount, likeCount),
      };
    });
  } catch (err: any) {
    logger.error({ err: err.message, keyword, region }, "TikHub fetchTrendingHashtagVideos failed");
    return [];
  }
}
