import { logger } from "../lib/logger";

// Meta Graph 公开页抓取（FB Page / IG Business）— 不需要单独密钥，
// 使用用户已绑定的 Meta OAuth Page Access Token。
// 仅支持公开页面 / 用户已授权访问的对象。

export interface MetaPostData {
  externalId: string;
  caption: string;
  mediaType: string; // photo | video | link | status | reels
  mediaUrl: string;
  postUrl: string;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  publishedAt: Date | null;
}

export interface MetaProfileData {
  handle: string;
  displayName: string;
  avatarUrl: string;
  followerCount: number;
  postCount: number;
  bio: string;
}

const FB_GRAPH_BASE = "https://graph.facebook.com/v19.0";

async function graphGet(pathOrUrl: string, accessToken: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(pathOrUrl.startsWith("http") ? pathOrUrl : `${FB_GRAPH_BASE}${pathOrUrl}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", accessToken);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  if (!res.ok || json?.error) {
    throw new Error(`Graph ${res.status}: ${json?.error?.message || text.slice(0, 200)}`);
  }
  return json;
}

// === Facebook ===
export async function fetchFacebookPageProfile(pageId: string, accessToken: string): Promise<MetaProfileData | null> {
  try {
    const data = await graphGet(`/${pageId}`, accessToken, {
      fields: "id,name,username,picture.type(large),fan_count,followers_count,about",
    });
    return {
      handle: data.username || data.id,
      displayName: data.name || data.username || data.id,
      avatarUrl: data.picture?.data?.url || "",
      followerCount: Number(data.followers_count || data.fan_count) || 0,
      postCount: 0,
      bio: data.about || "",
    };
  } catch (err: any) {
    logger.error({ err: err.message, pageId }, "FB fetchFacebookPageProfile failed");
    return null;
  }
}

export async function fetchFacebookPagePosts(pageId: string, accessToken: string, limit = 12): Promise<MetaPostData[]> {
  try {
    const data = await graphGet(`/${pageId}/posts`, accessToken, {
      fields: "id,message,created_time,permalink_url,attachments{media_type,url,media,subattachments},likes.summary(true),comments.summary(true),shares",
      limit: String(limit),
    });
    const items = data?.data ?? [];
    return items.map((p: any): MetaPostData => {
      const att = p.attachments?.data?.[0];
      const mediaUrl = att?.media?.image?.src || att?.media?.source || att?.url || "";
      const mediaType = att?.media_type || "status";
      return {
        externalId: String(p.id),
        caption: p.message || "",
        mediaType: String(mediaType).toLowerCase(),
        mediaUrl,
        postUrl: p.permalink_url || "",
        likeCount: Number(p.likes?.summary?.total_count) || 0,
        commentCount: Number(p.comments?.summary?.total_count) || 0,
        shareCount: Number(p.shares?.count) || 0,
        publishedAt: p.created_time ? new Date(p.created_time) : null,
      };
    });
  } catch (err: any) {
    logger.error({ err: err.message, pageId }, "FB fetchFacebookPagePosts failed");
    return [];
  }
}

// === Instagram Business ===
export async function fetchInstagramBusinessProfile(igUserId: string, accessToken: string): Promise<MetaProfileData | null> {
  try {
    const data = await graphGet(`/${igUserId}`, accessToken, {
      fields: "id,username,name,profile_picture_url,followers_count,media_count,biography",
    });
    return {
      handle: data.username || data.id,
      displayName: data.name || data.username || data.id,
      avatarUrl: data.profile_picture_url || "",
      followerCount: Number(data.followers_count) || 0,
      postCount: Number(data.media_count) || 0,
      bio: data.biography || "",
    };
  } catch (err: any) {
    logger.error({ err: err.message, igUserId }, "IG fetchInstagramBusinessProfile failed");
    return null;
  }
}

export async function fetchInstagramBusinessMedia(igUserId: string, accessToken: string, limit = 12): Promise<MetaPostData[]> {
  try {
    const data = await graphGet(`/${igUserId}/media`, accessToken, {
      fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count",
      limit: String(limit),
    });
    const items = data?.data ?? [];
    return items.map((m: any): MetaPostData => ({
      externalId: String(m.id),
      caption: m.caption || "",
      mediaType: String(m.media_type || "image").toLowerCase(),
      mediaUrl: m.media_url || m.thumbnail_url || "",
      postUrl: m.permalink || "",
      likeCount: Number(m.like_count) || 0,
      commentCount: Number(m.comments_count) || 0,
      shareCount: 0,
      publishedAt: m.timestamp ? new Date(m.timestamp) : null,
    }));
  } catch (err: any) {
    logger.error({ err: err.message, igUserId }, "IG fetchInstagramBusinessMedia failed");
    return [];
  }
}

// 通过商家 username 解析 IG Business User ID（需要已绑定的 FB Page token）
export async function resolveIgBusinessByUsername(
  username: string,
  fbPageId: string,
  accessToken: string,
): Promise<{ igUserId: string; profile: MetaProfileData } | null> {
  try {
    const data = await graphGet(`/${fbPageId}`, accessToken, {
      fields: `business_discovery.username(${username}){id,username,name,profile_picture_url,followers_count,media_count,biography}`,
    });
    const bd = data?.business_discovery;
    if (!bd?.id) return null;
    return {
      igUserId: bd.id,
      profile: {
        handle: bd.username,
        displayName: bd.name || bd.username,
        avatarUrl: bd.profile_picture_url || "",
        followerCount: Number(bd.followers_count) || 0,
        postCount: Number(bd.media_count) || 0,
        bio: bd.biography || "",
      },
    };
  } catch (err: any) {
    logger.error({ err: err.message, username }, "IG resolveIgBusinessByUsername failed");
    return null;
  }
}
