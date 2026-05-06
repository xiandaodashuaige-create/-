import { Router, type IRouter } from "express";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  competitorProfilesTable,
  competitorPostsTable,
  accountsTable,
} from "@workspace/db";
import { ensureUser, requireCredits, deductCredits } from "../middlewares/creditSystem";
import { logger } from "../lib/logger";
import { transcribeVideoUrl } from "../services/whisperTranscribe.js";
import { decryptToken } from "../lib/crypto.js";
import {
  fetchTikTokProfile,
  fetchTikTokUserVideos,
  discoverTikTokCreators,
  isTikHubConfigured,
} from "../services/tikhubScraper";
import {
  fetchFacebookPageProfile,
  fetchFacebookPagePosts,
  resolveIgBusinessByUsername,
  fetchInstagramBusinessMedia,
} from "../services/metaCompetitorScraper";
import { openai } from "@workspace/integrations-openai-ai-server";

const REGION_TZ_OFFSET: Record<string, number> = {
  CN: 8, SG: 8, MY: 8, HK: 8, TW: 8, JP: 9, KR: 9,
  TH: 7, VN: 7, ID: 7, PH: 8, IN: 5,
  US: -5, GB: 0, DE: 1, FR: 1, AU: 10,
};
const REGION_LABELS: Record<string, string> = {
  CN: "中国", SG: "新加坡", MY: "马来西亚", HK: "香港", TW: "台湾",
  JP: "日本", KR: "韩国", TH: "泰国", VN: "越南", ID: "印尼", PH: "菲律宾",
  IN: "印度", US: "美国", GB: "英国", DE: "德国", FR: "法国", AU: "澳大利亚",
};

const router: IRouter = Router();

type Platform = "xhs" | "tiktok" | "instagram" | "facebook";

// 把一批 posts（同一同行账号）按"点赞 P75 阈值"动态标 isViral：
// - P75 是同账号自己的"较好表现线"，比硬编码 likes>1000 精准得多
// - 至少需要 4 条样本才启用，否则保留来源给的 isViral
// - 阈值再加一个最低绝对值（防止账号整体很冷时把所有都标爆款）
function markViralByPercentile<T extends { likeCount?: number; viewCount?: number; isViral?: boolean }>(
  posts: T[],
  minAbsoluteLikes = 50,
): T[] {
  if (posts.length < 4) return posts;
  const likes = posts.map((p) => p.likeCount ?? 0).sort((a, b) => a - b);
  const p75 = likes[Math.floor(likes.length * 0.75)] ?? 0;
  const threshold = Math.max(p75, minAbsoluteLikes);
  return posts.map((p) => ({
    ...p,
    isViral: (p.likeCount ?? 0) >= threshold || p.isViral === true,
  }));
}

function isValidPlatform(p: string): p is Platform {
  return ["xhs", "tiktok", "instagram", "facebook"].includes(p);
}

// 找到当前用户在该平台已绑定的第一个有 token 的账号（用于 FB/IG Graph 调用）
// 返回的 oauthAccessToken 已自动解密（如果 DB 里是密文，统一在这里 decrypt 一次）
async function findUserMetaAccount(userId: number, platform: "facebook" | "instagram") {
  const rows = await db.select().from(accountsTable)
    .where(and(
      eq(accountsTable.ownerUserId, userId),
      eq(accountsTable.platform, platform),
    ));
  const found = rows.find(r => !!r.oauthAccessToken) ?? null;
  if (!found) return null;
  return { ...found, oauthAccessToken: decryptToken(found.oauthAccessToken) };
}

// ── GET /api/competitors?platform=tiktok ─────────────────────────────
router.get("/competitors", async (req, res): Promise<void> => {
  const user = await ensureUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const platform = (req.query.platform as string) || undefined;

  const where = platform && isValidPlatform(platform)
    ? and(eq(competitorProfilesTable.userId, user.id), eq(competitorProfilesTable.platform, platform))
    : eq(competitorProfilesTable.userId, user.id);

  const profiles = await db.select().from(competitorProfilesTable)
    .where(where).orderBy(desc(competitorProfilesTable.createdAt));

  // 各自的 post 计数
  const result = await Promise.all(profiles.map(async (p) => {
    const [row] = await db.select({ c: sql<number>`count(*)::int` })
      .from(competitorPostsTable).where(eq(competitorPostsTable.competitorId, p.id));
    return { ...p, postCount: row?.c ?? 0 };
  }));
  res.json(result);
});

// ── POST /api/competitors  body: { platform, handle, region? } ───────
// 创建后立刻同步 profile + 最近 12 条
// 24h 缓存：若该 user+platform+handle 已存在且 lastSyncedAt < 24h，直接返回库存
// 不再发外部 API 请求（省 TikHub / Meta 配额）
const COMPETITOR_CACHE_MS = 24 * 60 * 60 * 1000;
router.post("/competitors", async (req, res): Promise<void> => {
  const user = await ensureUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { platform, handle: rawHandle, region } = req.body as {
    platform?: string; handle?: string; region?: string;
  };
  if (!platform || !isValidPlatform(platform)) { res.status(400).json({ error: "invalid_platform" }); return; }
  const handle = String(rawHandle ?? "").replace(/^@/, "").trim();
  if (!handle) { res.status(400).json({ error: "missing_handle" }); return; }

  // 24h 缓存命中检查（仅命中已入库且最近同步过的同行）
  // 大小写不敏感匹配：避免 @UserA / @usera 各算一次浪费配额
  const [cached] = await db.select().from(competitorProfilesTable).where(and(
    eq(competitorProfilesTable.userId, user.id),
    eq(competitorProfilesTable.platform, platform),
    sql`lower(${competitorProfilesTable.handle}) = lower(${handle})`,
  ));
  if (cached?.lastSyncedAt && Date.now() - new Date(cached.lastSyncedAt).getTime() < COMPETITOR_CACHE_MS) {
    const [postRow] = await db.select({ c: sql<number>`count(*)::int` })
      .from(competitorPostsTable).where(eq(competitorPostsTable.competitorId, cached.id));
    req.log?.info({ platform, handle, cachedAgeMin: Math.round((Date.now() - new Date(cached.lastSyncedAt).getTime()) / 60000) }, "competitor cache hit");
    res.json({ ...cached, postCount: postRow?.c ?? 0, _cached: true });
    return;
  }

  // 平台分发：抓 profile + posts
  let profileData: any = null;
  let posts: any[] = [];

  try {
    if (platform === "tiktok") {
      if (!isTikHubConfigured()) { res.status(503).json({ error: "tikhub_not_configured" }); return; }
      const p = await fetchTikTokProfile(handle);
      if (!p) { res.status(404).json({ error: "tiktok_user_not_found", message: `@${handle} 抓取失败或不存在` }); return; }
      profileData = {
        platform, handle: p.handle, displayName: p.displayName, avatarUrl: p.avatarUrl,
        bio: p.bio, followerCount: p.followerCount, followingCount: p.followingCount,
        postCount: p.postCount, region: region ?? p.region ?? null,
        profileUrl: `https://www.tiktok.com/@${p.handle}`,
        category: null,
      };
      if (p.secUid) {
        const vids = await fetchTikTokUserVideos(p.secUid, 12);
        posts = vids.map(v => ({
          platform, externalId: v.externalId, mediaType: "video",
          title: null, description: v.description, coverUrl: v.coverUrl, mediaUrl: v.videoUrl,
          mediaUrls: v.videoUrl ? [v.videoUrl] : [],
          postUrl: `https://www.tiktok.com/@${p.handle}/video/${v.externalId}`,
          viewCount: v.viewCount, likeCount: v.likeCount, commentCount: v.commentCount, shareCount: v.shareCount,
          duration: v.duration, musicName: v.musicName, musicAuthor: v.musicAuthor, hashtags: v.hashtags,
          publishedAt: v.publishedAt, isViral: v.isViral, transcript: null, analysisJson: null,
        }));
      }
    } else if (platform === "facebook") {
      const acc = await findUserMetaAccount(user.id, "facebook");
      if (!acc?.oauthAccessToken) {
        res.status(412).json({ error: "facebook_not_authorized", message: "请先在「账号」中授权 Facebook 主页（Meta OAuth）" }); return;
      }
      const prof = await fetchFacebookPageProfile(handle, acc.oauthAccessToken);
      if (!prof) { res.status(404).json({ error: "fb_page_not_found", message: `Facebook 主页 ${handle} 抓取失败（可能页面不公开或 Token 不足以访问）` }); return; }
      profileData = {
        platform, handle: prof.handle, displayName: prof.displayName, avatarUrl: prof.avatarUrl,
        bio: prof.bio, followerCount: prof.followerCount, followingCount: 0, postCount: 0,
        region: region ?? null, profileUrl: `https://www.facebook.com/${prof.handle}`, category: null,
      };
      const fbPosts = await fetchFacebookPagePosts(handle, acc.oauthAccessToken, 12);
      posts = fbPosts.map(p => ({
        platform, externalId: p.externalId, mediaType: p.mediaType, title: null,
        description: p.caption, coverUrl: p.mediaUrl, mediaUrl: p.mediaUrl,
        mediaUrls: p.mediaUrl ? [p.mediaUrl] : [], postUrl: p.postUrl,
        viewCount: 0, likeCount: p.likeCount, commentCount: p.commentCount, shareCount: p.shareCount,
        duration: null, musicName: null, musicAuthor: null, hashtags: [],
        publishedAt: p.publishedAt, isViral: p.likeCount > 1000, transcript: null, analysisJson: null,
      }));
    } else if (platform === "instagram") {
      const acc = await findUserMetaAccount(user.id, "instagram");
      if (!acc?.oauthAccessToken) {
        res.status(412).json({ error: "instagram_not_authorized", message: "请先在「账号」中授权 Instagram Business（Meta OAuth）" }); return;
      }
      // IG Business 抓取需要通过 FB Page 的 business_discovery
      // platformAccountId 在 OAuth 回调时存的是 IG User ID，但 business_discovery 需要 FB Page ID
      const fbAcc = await findUserMetaAccount(user.id, "facebook");
      const pageId = fbAcc?.platformAccountId;
      if (!pageId || !fbAcc?.oauthAccessToken) {
        res.status(412).json({ error: "facebook_required_for_ig", message: "Instagram 同行抓取需要先授权 Facebook 主页（business_discovery）" }); return;
      }
      const resolved = await resolveIgBusinessByUsername(handle, pageId, fbAcc.oauthAccessToken);
      if (!resolved) { res.status(404).json({ error: "ig_user_not_found", message: `@${handle} 不存在或非 Business 账号` }); return; }
      profileData = {
        platform, handle: resolved.profile.handle, displayName: resolved.profile.displayName,
        avatarUrl: resolved.profile.avatarUrl, bio: resolved.profile.bio,
        followerCount: resolved.profile.followerCount, followingCount: 0,
        postCount: resolved.profile.postCount, region: region ?? null,
        profileUrl: `https://www.instagram.com/${resolved.profile.handle}`, category: null,
      };
      const igPosts = await fetchInstagramBusinessMedia(resolved.igUserId, fbAcc.oauthAccessToken, 12);
      posts = igPosts.map(p => ({
        platform, externalId: p.externalId, mediaType: p.mediaType, title: null,
        description: p.caption, coverUrl: p.mediaUrl, mediaUrl: p.mediaUrl,
        mediaUrls: p.mediaUrl ? [p.mediaUrl] : [], postUrl: p.postUrl,
        viewCount: 0, likeCount: p.likeCount, commentCount: p.commentCount, shareCount: 0,
        duration: null, musicName: null, musicAuthor: null, hashtags: [],
        publishedAt: p.publishedAt, isViral: p.likeCount > 5000, transcript: null, analysisJson: null,
      }));
    } else {
      // xhs
      res.status(400).json({ error: "xhs_competitor_use_workflow", message: "小红书同行分析请直接在工作流第 1 步使用「AI 灵感研究」" });
      return;
    }
  } catch (err: any) {
    logger.error({ err: err.message, platform, handle }, "competitor fetch failed");
    res.status(500).json({ error: "fetch_failed", message: err?.message ?? "抓取失败" });
    return;
  }

  // 入库（upsert by user+platform+handle）
  const [existing] = await db.select().from(competitorProfilesTable).where(and(
    eq(competitorProfilesTable.userId, user.id),
    eq(competitorProfilesTable.platform, platform),
    eq(competitorProfilesTable.handle, profileData.handle),
  ));

  let saved;
  if (existing) {
    [saved] = await db.update(competitorProfilesTable)
      .set({ ...profileData, lastSyncedAt: new Date() })
      .where(eq(competitorProfilesTable.id, existing.id)).returning();
  } else {
    [saved] = await db.insert(competitorProfilesTable)
      .values({ userId: user.id, ...profileData, lastSyncedAt: new Date() }).returning();
  }

  if (posts.length > 0) {
    // 简单 upsert：先删后插（数量小）
    await db.delete(competitorPostsTable).where(eq(competitorPostsTable.competitorId, saved.id));
    const tunedPosts = markViralByPercentile(posts);
    await db.insert(competitorPostsTable).values(
      tunedPosts.map(p => ({ ...p, competitorId: saved.id })),
    );
  }

  // 触发该 platform × category 的全平台训练画像刷新（fire-and-forget）
  try {
    const { triggerCategoryRecompute } = await import("../services/categoryTraining.js");
    triggerCategoryRecompute(platform, saved.category);
  } catch { /* ignore */ }

  logger.info({ userId: user.id, platform, handle: profileData.handle, postsCount: posts.length }, "competitor synced");
  res.status(201).json({ ...saved, postCount: posts.length });
});

// ── DELETE /api/competitors/:id ──────────────────────────────────────
router.delete("/competitors/:id", async (req, res): Promise<void> => {
  const user = await ensureUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "invalid_id" }); return; }
  const [del] = await db.delete(competitorProfilesTable)
    .where(and(eq(competitorProfilesTable.id, id), eq(competitorProfilesTable.userId, user.id)))
    .returning();
  if (!del) { res.status(404).json({ error: "not_found" }); return; }
  res.sendStatus(204);
});

// ── GET /api/competitors/:id/posts ───────────────────────────────────
router.get("/competitors/:id/posts", async (req, res): Promise<void> => {
  const user = await ensureUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "invalid_id" }); return; }
  const [profile] = await db.select().from(competitorProfilesTable)
    .where(and(eq(competitorProfilesTable.id, id), eq(competitorProfilesTable.userId, user.id)));
  if (!profile) { res.status(404).json({ error: "not_found" }); return; }
  const posts = await db.select().from(competitorPostsTable)
    .where(eq(competitorPostsTable.competitorId, id))
    .orderBy(desc(competitorPostsTable.likeCount)).limit(50);
  res.json(posts);
});

// ── POST /api/competitors/:id/sync — 重新拉取 ────────────────────────
router.post("/competitors/:id/sync", async (req, res): Promise<void> => {
  const user = await ensureUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "invalid_id" }); return; }
  const [profile] = await db.select().from(competitorProfilesTable)
    .where(and(eq(competitorProfilesTable.id, id), eq(competitorProfilesTable.userId, user.id)));
  if (!profile) { res.status(404).json({ error: "not_found" }); return; }

  // 24h 缓存：除非显式 force=true，否则跳过最近同步过的
  const force = String((req.query.force ?? req.body?.force) ?? "") === "true";
  if (!force && profile.lastSyncedAt && Date.now() - new Date(profile.lastSyncedAt).getTime() < COMPETITOR_CACHE_MS) {
    const [postRow] = await db.select({ c: sql<number>`count(*)::int` })
      .from(competitorPostsTable).where(eq(competitorPostsTable.competitorId, id));
    req.log?.info({ id, platform: profile.platform, handle: profile.handle }, "competitor sync cache hit");
    res.json({ ok: true, postsSynced: postRow?.c ?? 0, _cached: true });
    return;
  }

  // 在覆盖 body 之前先抓取客户端显式传入的 category（用于训练画像触发）
  const explicitCategoryRaw = (req.body as any)?.category;
  const explicitCategory = typeof explicitCategoryRaw === "string" && explicitCategoryRaw.trim().length >= 2
    ? explicitCategoryRaw.trim()
    : null;

  // 复用 POST 逻辑：直接转发到 /competitors（去重靠 upsert）
  req.body = { platform: profile.platform, handle: profile.handle, region: profile.region };
  // 调用同 router 内的 handler 不优雅，这里直接写一遍精简同步
  try {
    if (profile.platform === "tiktok") {
      const p = await fetchTikTokProfile(profile.handle);
      if (!p) { res.status(404).json({ error: "tiktok_user_not_found" }); return; }
      const vids = p.secUid ? await fetchTikTokUserVideos(p.secUid, 12) : [];
      await db.update(competitorProfilesTable).set({
        displayName: p.displayName, avatarUrl: p.avatarUrl, bio: p.bio,
        followerCount: p.followerCount, followingCount: p.followingCount, postCount: p.postCount,
        lastSyncedAt: new Date(),
      }).where(eq(competitorProfilesTable.id, id));
      if (vids.length > 0) {
        await db.delete(competitorPostsTable).where(eq(competitorPostsTable.competitorId, id));
        const tuned = markViralByPercentile(vids);
        await db.insert(competitorPostsTable).values(tuned.map(v => ({
          competitorId: id, platform: "tiktok", externalId: v.externalId, mediaType: "video",
          description: v.description, coverUrl: v.coverUrl, mediaUrl: v.videoUrl,
          mediaUrls: v.videoUrl ? [v.videoUrl] : [],
          postUrl: `https://www.tiktok.com/@${p.handle}/video/${v.externalId}`,
          viewCount: v.viewCount, likeCount: v.likeCount, commentCount: v.commentCount, shareCount: v.shareCount,
          duration: v.duration, musicName: v.musicName, musicAuthor: v.musicAuthor, hashtags: v.hashtags,
          publishedAt: v.publishedAt, isViral: v.isViral,
        })));
      }
      res.json({ ok: true, postsSynced: vids.length });
    } else if (profile.platform === "facebook") {
      const acc = await findUserMetaAccount(user.id, "facebook");
      if (!acc?.oauthAccessToken) { res.status(412).json({ error: "facebook_not_authorized" }); return; }
      const prof = await fetchFacebookPageProfile(profile.handle, acc.oauthAccessToken);
      const fbPosts = await fetchFacebookPagePosts(profile.handle, acc.oauthAccessToken, 12);
      if (prof) {
        await db.update(competitorProfilesTable).set({
          displayName: prof.displayName, avatarUrl: prof.avatarUrl, bio: prof.bio,
          followerCount: prof.followerCount, lastSyncedAt: new Date(),
        }).where(eq(competitorProfilesTable.id, id));
      }
      if (fbPosts.length > 0) {
        await db.delete(competitorPostsTable).where(eq(competitorPostsTable.competitorId, id));
        const tuned = markViralByPercentile(fbPosts.map(p => ({ ...p, isViral: p.likeCount > 1000 })));
        await db.insert(competitorPostsTable).values(tuned.map(p => ({
          competitorId: id, platform: "facebook", externalId: p.externalId, mediaType: p.mediaType,
          description: p.caption, coverUrl: p.mediaUrl, mediaUrl: p.mediaUrl,
          mediaUrls: p.mediaUrl ? [p.mediaUrl] : [], postUrl: p.postUrl,
          viewCount: 0, likeCount: p.likeCount, commentCount: p.commentCount, shareCount: p.shareCount,
          publishedAt: p.publishedAt, isViral: p.isViral,
        })));
      }
      res.json({ ok: true, postsSynced: fbPosts.length });
    } else if (profile.platform === "instagram") {
      const fbAcc = await findUserMetaAccount(user.id, "facebook");
      if (!fbAcc?.platformAccountId || !fbAcc.oauthAccessToken) {
        res.status(412).json({ error: "facebook_required_for_ig" }); return;
      }
      const resolved = await resolveIgBusinessByUsername(profile.handle, fbAcc.platformAccountId, fbAcc.oauthAccessToken);
      if (!resolved) { res.status(404).json({ error: "ig_user_not_found" }); return; }
      const igPosts = await fetchInstagramBusinessMedia(resolved.igUserId, fbAcc.oauthAccessToken, 12);
      await db.update(competitorProfilesTable).set({
        displayName: resolved.profile.displayName, avatarUrl: resolved.profile.avatarUrl,
        bio: resolved.profile.bio, followerCount: resolved.profile.followerCount,
        postCount: resolved.profile.postCount, lastSyncedAt: new Date(),
      }).where(eq(competitorProfilesTable.id, id));
      if (igPosts.length > 0) {
        await db.delete(competitorPostsTable).where(eq(competitorPostsTable.competitorId, id));
        const tuned = markViralByPercentile(igPosts.map(p => ({ ...p, isViral: p.likeCount > 5000 })));
        await db.insert(competitorPostsTable).values(tuned.map(p => ({
          competitorId: id, platform: "instagram", externalId: p.externalId, mediaType: p.mediaType,
          description: p.caption, coverUrl: p.mediaUrl, mediaUrl: p.mediaUrl,
          mediaUrls: p.mediaUrl ? [p.mediaUrl] : [], postUrl: p.postUrl,
          viewCount: 0, likeCount: p.likeCount, commentCount: p.commentCount, shareCount: 0,
          publishedAt: p.publishedAt, isViral: p.isViral,
        })));
      }
      res.json({ ok: true, postsSynced: igPosts.length });
    } else {
      res.status(400).json({ error: "platform_not_supported" });
      return;
    }

    // 触发该 platform × category 的全平台训练画像刷新（fire-and-forget）
    // 优先用客户端显式传入的 category，回退到 profile 已存 category
    try {
      const { triggerCategoryRecompute } = await import("../services/categoryTraining.js");
      triggerCategoryRecompute(profile.platform, explicitCategory ?? profile.category);
    } catch { /* ignore */ }
  } catch (err: any) {
    logger.error({ err: err.message, id }, "competitor sync failed");
    res.status(500).json({ error: "sync_failed", message: err?.message });
  }
});

// ── GET /api/competitors/discover?platform=tiktok&keyword=美容&limit=10 ──
router.get("/competitors/discover", async (req, res): Promise<void> => {
  const user = await ensureUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const platform = (req.query.platform as string) || "tiktok";
  const keyword = ((req.query.keyword as string) || "").trim();
  const limit = Math.min(15, Math.max(1, Number(req.query.limit) || 10));
  if (!keyword) { res.status(400).json({ error: "missing_keyword" }); return; }

  if (platform === "tiktok") {
    if (!isTikHubConfigured()) { res.status(503).json({ error: "tikhub_not_configured" }); return; }
    const creators = await discoverTikTokCreators(keyword, limit);
    res.json({ platform, keyword, creators });
    return;
  }
  // FB/IG 没有公开关键词搜账号 API，返回空列表 + 提示
  res.json({ platform, keyword, creators: [], note: "Meta 平台无公开账号关键词搜索能力，请直接输入主页 username/Page ID 添加。" });
});

// ── GET /api/competitors/trending — 用户已添加同行的高赞内容 ─────────
router.get("/competitors/trending", async (req, res): Promise<void> => {
  const user = await ensureUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const platform = (req.query.platform as string) || undefined;
  const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 10));
  const where = platform && isValidPlatform(platform)
    ? and(eq(competitorProfilesTable.userId, user.id), eq(competitorProfilesTable.platform, platform))
    : eq(competitorProfilesTable.userId, user.id);
  const profs = await db.select().from(competitorProfilesTable).where(where);
  if (profs.length === 0) { res.json([]); return; }
  const posts = await db.select().from(competitorPostsTable)
    .where(inArray(competitorPostsTable.competitorId, profs.map(p => p.id)))
    .orderBy(desc(competitorPostsTable.likeCount)).limit(limit);
  res.json(posts);
});

// ── GET /api/competitors/insights/aggregate?platform=tiktok — 行业聚合分析 ───────
router.get("/competitors/insights/aggregate", async (req, res): Promise<void> => {
  const user = await ensureUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const platform = (req.query.platform as string) || undefined;

  const profWhere = platform && isValidPlatform(platform)
    ? and(eq(competitorProfilesTable.userId, user.id), eq(competitorProfilesTable.platform, platform))
    : eq(competitorProfilesTable.userId, user.id);
  const competitors = await db.select().from(competitorProfilesTable).where(profWhere);

  if (competitors.length === 0) {
    res.status(404).json({ error: "暂无同行账号，请先在上方添加同行" });
    return;
  }

  const competitorIds = competitors.map((c) => c.id);
  const posts = await db.select().from(competitorPostsTable)
    .where(inArray(competitorPostsTable.competitorId, competitorIds));

  if (posts.length === 0) {
    res.status(409).json({ error: "同行账号暂无内容样本", message: "请先点同行卡上的 ↻ 抓取至少一个同行的真实数据再运行行业分析" });
    return;
  }

  const primaryRegion = competitors.find((c) => c.region)?.region || "SG";
  const tzOffset = REGION_TZ_OFFSET[primaryRegion] ?? 0;
  const tzLabel = `${REGION_LABELS[primaryRegion] || primaryRegion} (UTC${tzOffset >= 0 ? "+" : ""}${tzOffset})`;

  const hourCounts = new Map<number, { count: number; views: number }>();
  const hashtagCounts = new Map<string, number>();
  const musicCounts = new Map<string, number>();
  let totalDuration = 0;
  let totalViews = 0;
  let totalLikes = 0;
  let totalComments = 0;
  let totalShares = 0;
  let withDuration = 0;

  for (const v of posts) {
    if (v.publishedAt) {
      const utcHour = new Date(v.publishedAt).getUTCHours();
      const localHour = (utcHour + tzOffset + 24) % 24;
      const cur = hourCounts.get(localHour) ?? { count: 0, views: 0 };
      cur.count++;
      cur.views += v.viewCount;
      hourCounts.set(localHour, cur);
    }
    for (const tag of v.hashtags ?? []) {
      const norm = tag.trim().toLowerCase();
      if (norm) hashtagCounts.set(norm, (hashtagCounts.get(norm) ?? 0) + 1);
    }
    if (v.musicName && v.musicName !== "Unknown" && v.musicName !== "待获取") {
      const key = v.musicAuthor && v.musicAuthor !== "Unknown" && v.musicAuthor !== "未知"
        ? `${v.musicName} - ${v.musicAuthor}` : v.musicName;
      musicCounts.set(key, (musicCounts.get(key) ?? 0) + 1);
    }
    if (v.duration) { totalDuration += v.duration; withDuration++; }
    totalViews += v.viewCount;
    totalLikes += v.likeCount;
    totalComments += v.commentCount;
    totalShares += v.shareCount;
  }

  const bestPostingHoursLocal = [...hourCounts.entries()]
    .sort((a, b) => b[1].views - a[1].views).slice(0, 4).map(([h]) => h).sort((a, b) => a - b);
  const topHashtags = [...hashtagCounts.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag, count]) => ({ tag, count }));
  const topMusicTracks = [...musicCounts.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([track, count]) => ({ track, count }));

  const avgVideoLengthSec = withDuration > 0 ? Math.round(totalDuration / withDuration) : 0;
  const avgEngagementRate = totalViews > 0
    ? Number((((totalLikes + totalComments + totalShares) / totalViews) * 100).toFixed(2))
    : 0;

  const competitorBreakdown = competitors.map((c) => {
    const myVids = posts.filter((v) => v.competitorId === c.id);
    const avgViews = myVids.length > 0
      ? Math.round(myVids.reduce((s, v) => s + v.viewCount, 0) / myVids.length) : 0;
    const topVid = [...myVids].sort((a, b) => b.viewCount - a.viewCount)[0];
    return {
      handle: c.handle,
      followers: c.followerCount ?? 0,
      posts: myVids.length,
      avgViews,
      topHook: (topVid?.description ?? topVid?.title ?? "").slice(0, 80) || "无可用文案",
    };
  }).filter((c) => c.posts > 0);

  const topPostsForAi = [...posts]
    .sort((a, b) => b.viewCount - a.viewCount).slice(0, 12)
    .map((v) => {
      const owner = competitors.find((c) => c.id === v.competitorId);
      return {
        from: owner?.handle,
        desc: (v.description ?? v.title ?? "").slice(0, 160),
        durationSec: v.duration,
        views: v.viewCount,
        likes: v.likeCount,
        music: v.musicName,
        hashtags: v.hashtags?.slice(0, 5) ?? [],
      };
    });

  let viralFormula = "";
  let durationStrategy = "";
  let hashtagStrategy = "";
  let bgmStrategy = "";
  let postingStrategy = "";
  let keyInsights: string[] = [];

  try {
    const platformLabel = platform === "xhs" ? "小红书" : platform === "instagram" ? "Instagram"
      : platform === "facebook" ? "Facebook" : "TikTok";
    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 4000,
      messages: [
        {
          role: "system",
          content: `你是${platformLabel}爆款规律提炼专家。基于多个真实同行账号的真实内容数据，提炼跨账号的共性爆款规律。只返回JSON，禁止使用任何泛泛而谈的套话（如"前3秒强钩子"），所有结论必须引用具体数字、标签、BGM 名称、账号名等真实证据。
{
  "viralFormula": "2-3句话总结跨账号共性爆款公式，必须引用至少2个具体证据（账号名/数字/标签）",
  "durationStrategy": "1-2句内容时长策略，引用真实平均时长和具体爆款时长",
  "hashtagStrategy": "1-2句标签组合策略，至少列举3个真实出现的标签",
  "bgmStrategy": "1-2句BGM选择策略，引用真实BGM名称",
  "postingStrategy": "1-2句发布时段策略，引用真实最佳时段",
  "keyInsights": ["洞察1（必须含数字或具体证据）", "洞察2", "洞察3", "洞察4", "洞察5"]
}
用中文。`,
        },
        {
          role: "user",
          content: JSON.stringify({
            platform: platformLabel,
            competitorsAnalyzed: competitorBreakdown.length,
            postsAnalyzed: posts.length,
            primaryMarket: REGION_LABELS[primaryRegion] || primaryRegion,
            stats: { totalViews, totalLikes, avgEngagementRatePct: avgEngagementRate, avgVideoLengthSec, bestPostingHoursLocal, tzLabel },
            topHashtags, topMusicTracks, competitorBreakdown,
            topPostsAcrossCompetitors: topPostsForAi,
          }),
        },
      ],
    }, { timeout: 60_000, maxRetries: 1 });

    const raw = completion.choices[0]?.message?.content ?? "";
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      viralFormula = parsed.viralFormula ?? "";
      durationStrategy = parsed.durationStrategy ?? "";
      hashtagStrategy = parsed.hashtagStrategy ?? "";
      bgmStrategy = parsed.bgmStrategy ?? "";
      postingStrategy = parsed.postingStrategy ?? "";
      keyInsights = Array.isArray(parsed.keyInsights) ? parsed.keyInsights : [];
    }
  } catch (err) {
    logger.error({ err }, "aggregate insights AI failed");
  }

  if (!viralFormula) viralFormula = `已分析 ${competitorBreakdown.length} 个真实同行账号、共 ${posts.length} 条内容，累计播放 ${totalViews.toLocaleString()} 次，平均互动率 ${avgEngagementRate}%。AI 总结暂时不可用，请稍后重试。`;
  if (!durationStrategy) durationStrategy = `平均时长 ${avgVideoLengthSec} 秒。`;
  if (!hashtagStrategy) hashtagStrategy = topHashtags.length > 0
    ? `跨账号高频标签：${topHashtags.slice(0, 5).map((t) => `#${t.tag}(${t.count})`).join(" / ")}` : "标签数据不足。";
  if (!bgmStrategy) bgmStrategy = topMusicTracks.length > 0
    ? `跨账号热门 BGM：${topMusicTracks.slice(0, 3).map((m) => m.track).join(" / ")}` : "BGM 数据不足。";
  if (!postingStrategy) postingStrategy = bestPostingHoursLocal.length > 0
    ? `${tzLabel} 高曝光时段：${bestPostingHoursLocal.map((h) => `${h}:00`).join(" / ")}` : "发布时段数据不足。";
  if (keyInsights.length === 0) {
    keyInsights = [
      `共分析 ${competitorBreakdown.length} 个真实同行账号、${posts.length} 条内容`,
      `累计播放 ${totalViews.toLocaleString()} 次，平均互动率 ${avgEngagementRate}%`,
      `平均内容时长 ${avgVideoLengthSec} 秒`,
      topHashtags.length > 0 ? `共性标签 Top 3：${topHashtags.slice(0, 3).map((t) => "#" + t.tag).join(", ")}` : "标签数据不足",
      bestPostingHoursLocal.length > 0 ? `${tzLabel} 最佳发布时段：${bestPostingHoursLocal.map((h) => h + ":00").join(", ")}` : "发布时段数据不足",
    ];
  }

  res.json({
    platform: platform || "all",
    competitorsAnalyzed: competitorBreakdown.length,
    postsAnalyzed: posts.length,
    totalViews, totalLikes, avgEngagementRate, avgVideoLengthSec,
    bestPostingHoursLocal, timezoneLabel: tzLabel,
    topHashtags, topMusicTracks,
    viralFormula, durationStrategy, hashtagStrategy, bgmStrategy, postingStrategy,
    keyInsights, competitorBreakdown,
  });
});

// ── PATCH /api/competitor-posts/:id/star  body: { starred: boolean } ─────────
// 把同行单条作品收藏到"⭐ 精选库"（长期沉淀，AI 生成时优先借鉴）
// 用 analysisJson.starred 标记，无需 schema 迁移
router.patch("/competitor-posts/:id/star", async (req, res): Promise<void> => {
  const user = await ensureUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "invalid_id" }); return; }
  const starred = req.body?.starred === true;

  // ownership join: post → profile.userId === user.id
  const [row] = await db.select({ post: competitorPostsTable, ownerId: competitorProfilesTable.userId })
    .from(competitorPostsTable)
    .innerJoin(competitorProfilesTable, eq(competitorPostsTable.competitorId, competitorProfilesTable.id))
    .where(eq(competitorPostsTable.id, id));
  if (!row || row.ownerId !== user.id) { res.status(404).json({ error: "not_found" }); return; }

  const prev = (row.post.analysisJson ?? {}) as Record<string, any>;
  const nextAnalysis = { ...prev, starred, starredAt: starred ? new Date().toISOString() : null };
  const [updated] = await db.update(competitorPostsTable)
    .set({ analysisJson: nextAnalysis })
    .where(eq(competitorPostsTable.id, id))
    .returning();
  res.json(updated);
});

// ── GET /api/competitors/strategy?platform=&niche= ───────────────────────────
// 长期内容运营策略卡：不是"做哪一条"，而是"未来一个月怎么做"
// 数据源：用户已添加同行的 ⭐ 精选 + 🔥 viral 作品（精挑过的）
// 返回：内容支柱 / 发布频率 / 钩子模板库 / 标签策略 / 周节奏
router.get("/competitors/strategy", requireCredits("ai-operations-strategy"), async (req, res): Promise<void> => {
  const user = await ensureUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const platform = (req.query.platform as string) || "";
  const niche = ((req.query.niche as string) || "").trim().slice(0, 60);
  if (!isValidPlatform(platform)) { res.status(400).json({ error: "invalid_platform" }); return; }

  const profiles = await db.select().from(competitorProfilesTable)
    .where(and(
      eq(competitorProfilesTable.userId, user.id),
      eq(competitorProfilesTable.platform, platform),
    ));
  if (profiles.length === 0) {
    res.status(404).json({ error: "no_competitors", message: "请先在同行库添加 3-5 个对标账号" });
    return;
  }

  const allPosts = await db.select().from(competitorPostsTable)
    .where(inArray(competitorPostsTable.competitorId, profiles.map((p) => p.id)));

  // 精挑：starred 优先 → viral → 互动 Top；至少 6 条样本
  const starred = allPosts.filter((p) => (p.analysisJson as any)?.starred === true);
  const viral = allPosts.filter((p) => p.isViral && !((p.analysisJson as any)?.starred === true));
  const sortedByLikes = [...allPosts].sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0));
  const curated = [...starred, ...viral.slice(0, 12)];
  if (curated.length < 6) {
    for (const p of sortedByLikes) {
      if (curated.find((c) => c.id === p.id)) continue;
      curated.push(p);
      if (curated.length >= 6) break;
    }
  }
  const sampleSet = curated.slice(0, 16);
  if (sampleSet.length === 0) {
    res.status(409).json({ error: "no_samples", message: "已添加同行但未抓取作品，请点 ↻ 同步" });
    return;
  }

  const profilesById = new Map(profiles.map((p) => [p.id, p]));
  const sampleBlock = sampleSet.map((p) => {
    const owner = profilesById.get(p.competitorId);
    const tag = (p.analysisJson as any)?.starred ? "⭐" : p.isViral ? "🔥" : "·";
    const text = (p.title ?? p.description ?? "").trim().slice(0, 100);
    return `${tag} @${owner?.handle ?? "?"} · ❤${p.likeCount ?? 0} 👁${p.viewCount ?? 0}${p.duration ? ` ⏱${p.duration}s` : ""} · "${text}" [${(p.hashtags ?? []).slice(0, 4).join(" ")}]`;
  }).join("\n");

  const platformLabel = platform === "xhs" ? "小红书" : platform === "instagram" ? "Instagram" : platform === "facebook" ? "Facebook" : "TikTok";
  const accountList = profiles.slice(0, 8).map((p) => `@${p.handle}（${p.followerCount}粉）`).join("、");

  const systemPrompt = `你是${platformLabel}内容运营顾问。基于该客户长期沉淀的精选同行素材，给出未来 30 天的内容运营策略。
返回严格 JSON：
{
  "summary": "一段话总结：未来 30 天该客户应当如何运营（不超过 150 字，必须引用具体证据）",
  "contentPillars": [
    {"name": "支柱 1 名称", "ratio": 40, "description": "做什么/为什么/参考哪条样本"},
    ... 3-4 个，ratio 之和约等于 100
  ],
  "weeklyCadence": {"postsPerWeek": 数字, "rationale": "依据"},
  "hookTemplates": [
    {"template": "钩子模板（含占位符）", "evidence": "来自哪条样本/数字"},
    ... 4-6 条，必须可直接套用
  ],
  "hashtagStrategy": {"core": ["#xxx", ...3-5个长期主标签], "rotation": ["#xxx", ...5-8个轮换标签]},
  "bestPostingWindows": ["周X HH:00", ... 3 个],
  "doList": ["要做的事 1", ... 3-5 条具体动作],
  "dontList": ["要避免 1", ... 2-4 条],
  "next30DaysRoadmap": [
    {"week": 1, "focus": "本周主题", "deliverables": "本周交付什么"},
    {"week": 2, ...},
    {"week": 3, ...},
    {"week": 4, ...}
  ]
}
约束：
- 所有结论必须引用上面 sampleBlock 里的具体账号/数字/标签作为证据
- 行业【${niche || "未指定"}】是硬约束，主题必须围绕它
- 不要套话；每条建议都要可执行
只返回 JSON。`;

  const userPrompt = `【客户信息】
- 平台：${platformLabel}
- 行业：${niche || "未指定"}
- 已收集对标账号（${profiles.length} 个）：${accountList}

【精挑同行素材】（⭐=用户收藏，🔥=自动判定爆款）
${sampleBlock}

请输出 30 天运营策略 JSON。`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }, { timeout: 60_000, maxRetries: 1 });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);

    await deductCredits(req, "ai-operations-strategy");

    res.json({
      platform,
      niche: niche || null,
      strategy: parsed,
      meta: {
        competitorsAnalyzed: profiles.length,
        starredSamples: starred.length,
        viralSamples: viral.length,
        totalSamplesUsed: sampleSet.length,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    logger.error({ err: err?.message, platform, niche }, "competitors strategy generation failed");
    res.status(500).json({ error: "ai_failed", message: err?.message ?? "AI 生成失败" });
  }
});

// 同行视频 Whisper 口播转录 — 提取 viral hooks 给 AI 创作参考
// 命中已转录则直接返回缓存（competitorPostsTable.transcript），否则下载 + 调 Whisper
router.post("/competitor-posts/:id/transcribe", requireCredits("ai-operations-rewrite"), async (req, res): Promise<void> => {
  const user = await ensureUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "invalid_id" }); return; }

  // ownership join
  const [row] = await db.select({ post: competitorPostsTable, ownerId: competitorProfilesTable.userId })
    .from(competitorPostsTable)
    .innerJoin(competitorProfilesTable, eq(competitorPostsTable.competitorId, competitorProfilesTable.id))
    .where(eq(competitorPostsTable.id, id));
  if (!row || row.ownerId !== user.id) { res.status(404).json({ error: "not_found" }); return; }

  // 缓存命中
  if (row.post.transcript && row.post.transcript.length > 10) {
    res.json({ id, transcript: row.post.transcript, cached: true });
    return;
  }

  const videoUrl = row.post.mediaUrl;
  if (!videoUrl) { res.status(400).json({ error: "no_video", message: "该作品无视频链接" }); return; }

  try {
    const transcript = await transcribeVideoUrl(videoUrl);
    const [updated] = await db.update(competitorPostsTable)
      .set({ transcript })
      .where(eq(competitorPostsTable.id, id))
      .returning({ id: competitorPostsTable.id, transcript: competitorPostsTable.transcript });
    await deductCredits(req, "ai-operations-rewrite");
    res.json({ id: updated.id, transcript: updated.transcript, cached: false });
  } catch (err: any) {
    logger.error({ err: err?.message, postId: id }, "transcribe failed");
    res.status(500).json({ error: "transcribe_failed", message: err?.message ?? "转录失败" });
  }
});

export default router;
