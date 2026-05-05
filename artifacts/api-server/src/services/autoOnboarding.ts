import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import {
  db,
  competitorProfilesTable,
  competitorPostsTable,
  accountsTable,
  contentTable,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import {
  discoverTikTokCreators,
  fetchTikTokProfile,
  fetchTikTokUserVideos,
} from "./tikhubScraper.js";
import { tryFetchXhsData } from "../routes/xhs.js";
import { triggerCategoryRecompute } from "./categoryTraining.js";

export type AutoOnboardingPlatform = "tiktok" | "xhs" | "facebook" | "instagram";

export interface AutoOnboardingInput {
  userId: number;
  niche?: string | null;          // 客户填了就用，没填就自动推断
  region?: string | null;
  platforms?: AutoOnboardingPlatform[];
  perPlatformCount?: number;       // 每个平台最多自动添加多少同行（默认 10）
}

export interface AutoOnboardingPlatformResult {
  platform: AutoOnboardingPlatform;
  ok: boolean;
  added: number;
  skippedExisting: number;
  postsCollected: number;
  message?: string;
}

export interface AutoOnboardingResult {
  niche: string;
  nicheSource: "explicit" | "inferred" | "fallback";
  region: string;
  platforms: AutoOnboardingPlatformResult[];
  totalAdded: number;
  totalPosts: number;
  durationMs: number;
}

// ────────────────────────────────────────────────────────────────────────
// Niche 自动推断：从客户已发布内容/绑定账号 nickname/bio 提取关键词
// ────────────────────────────────────────────────────────────────────────
const KNOWN_NICHE_KEYWORDS = [
  "培训", "课程", "教育", "讲师", "学习", "课",
  "美妆", "化妆", "彩妆", "护肤",
  "美食", "餐", "菜谱", "料理",
  "健身", "瘦身", "减肥", "运动",
  "母婴", "宝宝", "育儿",
  "数码", "科技", "手机",
  "服装", "穿搭", "时尚",
  "家居", "家具", "装修",
  "旅游", "旅行",
  "汽车",
  "房产",
  "金融", "投资", "理财",
  "宠物", "猫", "狗",
];

export async function inferUserNiche(userId: number): Promise<string | null> {
  // 1) 从客户已发布的 content 标题/正文/标签里找最高频已知关键词
  const contentRows = await db
    .select({ title: contentTable.title, body: contentTable.body, tags: contentTable.tags })
    .from(contentTable)
    .innerJoin(accountsTable, eq(contentTable.accountId, accountsTable.id))
    .where(eq(accountsTable.ownerUserId, userId))
    .orderBy(desc(contentTable.createdAt))
    .limit(50);

  const corpus = contentRows
    .map((c) => `${c.title ?? ""} ${c.body ?? ""} ${(c.tags ?? []).join(" ")}`)
    .join(" ")
    .toLowerCase();

  if (corpus.trim().length > 0) {
    const counts = new Map<string, number>();
    for (const kw of KNOWN_NICHE_KEYWORDS) {
      const re = new RegExp(kw, "g");
      const matches = corpus.match(re);
      if (matches && matches.length > 0) counts.set(kw, matches.length);
    }
    if (counts.size > 0) {
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return top;
    }
  }

  // 2) 从绑定账号的 nickname/bio 里再扫一次
  const accs = await db
    .select({ nickname: accountsTable.nickname })
    .from(accountsTable)
    .where(eq(accountsTable.ownerUserId, userId))
    .limit(10);
  const accCorpus = accs.map((a) => a.nickname ?? "").join(" ").toLowerCase();
  for (const kw of KNOWN_NICHE_KEYWORDS) {
    if (accCorpus.includes(kw)) return kw;
  }

  return null;
}

// ────────────────────────────────────────────────────────────────────────
// 主入口：一键自动驾驶
// ────────────────────────────────────────────────────────────────────────
export async function runAutoOnboarding(input: AutoOnboardingInput): Promise<AutoOnboardingResult> {
  const startedAt = Date.now();
  const region = (input.region ?? "MY").toUpperCase();
  const perPlatformCount = Math.max(3, Math.min(input.perPlatformCount ?? 10, 20));
  const wantedPlatforms: AutoOnboardingPlatform[] = input.platforms && input.platforms.length > 0
    ? input.platforms
    : ["tiktok", "xhs"]; // 默认只跑能完全自动的两个平台；FB/IG 需 OAuth

  // 1) 解析 niche
  let niche = (input.niche ?? "").trim();
  let nicheSource: AutoOnboardingResult["nicheSource"] = "explicit";
  if (!niche) {
    const inferred = await inferUserNiche(input.userId);
    if (inferred) { niche = inferred; nicheSource = "inferred"; }
  }
  if (!niche) {
    niche = "通用爆款";
    nicheSource = "fallback";
  }

  const results: AutoOnboardingPlatformResult[] = [];

  // 2) 并行执行各平台
  const tasks = wantedPlatforms.map(async (platform): Promise<AutoOnboardingPlatformResult> => {
    try {
      if (platform === "tiktok") {
        return await runTikTokAutopilot(input.userId, niche, region, perPlatformCount);
      }
      if (platform === "xhs") {
        return await runXhsAutopilot(input.userId, niche, perPlatformCount);
      }
      if (platform === "facebook" || platform === "instagram") {
        return {
          platform,
          ok: false,
          added: 0,
          skippedExisting: 0,
          postsCollected: 0,
          message: "Meta 平台需先完成 OAuth 授权后才能自动发现同行；请先连接账号。",
        };
      }
      return { platform, ok: false, added: 0, skippedExisting: 0, postsCollected: 0, message: "unsupported" };
    } catch (err: any) {
      logger.error({ err: err?.message, platform, niche }, "autoOnboarding platform task failed");
      return { platform, ok: false, added: 0, skippedExisting: 0, postsCollected: 0, message: err?.message ?? "unknown error" };
    }
  });
  const settled = await Promise.all(tasks);
  results.push(...settled);

  // 3) 触发该 niche 的全平台训练画像刷新
  for (const r of results) {
    if (r.ok && r.added + r.postsCollected > 0) {
      triggerCategoryRecompute(r.platform, niche);
    }
  }

  const totalAdded = results.reduce((s, r) => s + r.added, 0);
  const totalPosts = results.reduce((s, r) => s + r.postsCollected, 0);
  const durationMs = Date.now() - startedAt;
  logger.info(
    { userId: input.userId, niche, nicheSource, totalAdded, totalPosts, durationMs },
    "autoOnboarding done",
  );

  return { niche, nicheSource, region, platforms: results, totalAdded, totalPosts, durationMs };
}

// ────────────────────────────────────────────────────────────────────────
// TikTok：discover 创作者 → 批量入库 → 拉视频
// ────────────────────────────────────────────────────────────────────────
async function runTikTokAutopilot(
  userId: number,
  niche: string,
  region: string,
  count: number,
): Promise<AutoOnboardingPlatformResult> {
  const creators = await discoverTikTokCreators(niche, count);
  if (creators.length === 0) {
    return { platform: "tiktok", ok: false, added: 0, skippedExisting: 0, postsCollected: 0, message: "TikHub 未发现匹配创作者" };
  }

  // 已有的 handles
  const existing = await db
    .select({ handle: competitorProfilesTable.handle })
    .from(competitorProfilesTable)
    .where(and(
      eq(competitorProfilesTable.userId, userId),
      eq(competitorProfilesTable.platform, "tiktok"),
    ));
  const existingSet = new Set(existing.map((e) => e.handle.toLowerCase()));

  let added = 0;
  let skipped = 0;
  let postsCollected = 0;

  for (const c of creators) {
    if (!c.handle || existingSet.has(c.handle.toLowerCase())) { skipped++; continue; }

    // profile 详情（拿 secUid 才能拉视频）
    const profile = await fetchTikTokProfile(c.handle).catch(() => null);
    if (!profile) { skipped++; continue; }

    const [saved] = await db.insert(competitorProfilesTable).values({
      userId,
      platform: "tiktok",
      handle: profile.handle,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      bio: profile.bio,
      followerCount: profile.followerCount,
      followingCount: profile.followingCount,
      postCount: profile.postCount,
      category: niche,
      region,
      lastSyncedAt: new Date(),
    }).returning();
    added++;

    // 拉前 12 条视频
    if (profile.secUid) {
      const vids = await fetchTikTokUserVideos(profile.secUid, 12).catch(() => []);
      if (vids.length > 0) {
        await db.insert(competitorPostsTable).values(vids.map((v) => ({
          competitorId: saved.id,
          platform: "tiktok",
          externalId: v.externalId,
          mediaType: "video" as const,
          description: v.description,
          coverUrl: v.coverUrl,
          mediaUrl: v.videoUrl,
          mediaUrls: v.videoUrl ? [v.videoUrl] : [],
          postUrl: `https://www.tiktok.com/@${profile.handle}/video/${v.externalId}`,
          viewCount: v.viewCount,
          likeCount: v.likeCount,
          commentCount: v.commentCount,
          shareCount: v.shareCount,
          duration: v.duration,
          musicName: v.musicName,
          musicAuthor: v.musicAuthor,
          hashtags: v.hashtags,
          publishedAt: v.publishedAt,
          isViral: v.isViral,
        })));
        postsCollected += vids.length;
      }
    }
  }

  return {
    platform: "tiktok",
    ok: true,
    added,
    skippedExisting: skipped,
    postsCollected,
    message: `已自动添加 ${added} 个 TikTok 同行，抓取 ${postsCollected} 条作品`,
  };
}

// ────────────────────────────────────────────────────────────────────────
// XHS：数据源仅返回作者昵称（无稳定作者 ID），昵称重名会污染同行库。
// 因此采用「按 niche 聚合的发现桶」策略：每个 (user, niche) 只建一个
// 合成 profile（handle = "__auto_xhs__:<niche>"），把搜到的爆款笔记
// 全部挂在它下面 — 既能进入训练样本池，又不会与真实手动添加的 XHS 同行混淆。
// ────────────────────────────────────────────────────────────────────────
function xhsBucketHandle(niche: string): string {
  return `__auto_xhs__:${niche}`;
}

async function runXhsAutopilot(
  userId: number,
  niche: string,
  count: number,
): Promise<AutoOnboardingPlatformResult> {
  const search = await tryFetchXhsData(niche).catch(() => null);
  if (!search?.available || !search.notes || search.notes.length === 0) {
    return { platform: "xhs", ok: false, added: 0, skippedExisting: 0, postsCollected: 0, message: "小红书数据源暂未返回结果" };
  }

  const handle = xhsBucketHandle(niche);

  // 找/建该 (user, niche) 的发现桶 profile
  let [bucket] = await db.select().from(competitorProfilesTable).where(and(
    eq(competitorProfilesTable.userId, userId),
    eq(competitorProfilesTable.platform, "xhs"),
    eq(competitorProfilesTable.handle, handle),
  ));
  let added = 0;
  if (!bucket) {
    [bucket] = await db.insert(competitorProfilesTable).values({
      userId,
      platform: "xhs",
      handle,
      displayName: `小红书「${niche}」自动发现池`,
      category: niche,
      lastSyncedAt: new Date(),
    }).returning();
    added = 1;
  } else {
    await db.update(competitorProfilesTable).set({ lastSyncedAt: new Date() })
      .where(eq(competitorProfilesTable.id, bucket.id));
  }

  // 取互动量 Top N 条笔记（去重 by note id）
  const dedup = new Map<string, typeof search.notes[number]>();
  for (const n of search.notes) if (n.id && !dedup.has(n.id)) dedup.set(n.id, n);
  const topNotes = [...dedup.values()]
    .sort((a, b) => (b.liked_count ?? 0) + (b.collected_count ?? 0) - ((a.liked_count ?? 0) + (a.collected_count ?? 0)))
    .slice(0, count * 2); // 每个 bucket 最多收 2N 条爆款笔记

  // 全量替换该 bucket 下的 posts（保持新鲜）
  await db.delete(competitorPostsTable).where(eq(competitorPostsTable.competitorId, bucket.id));
  let postsCollected = 0;
  if (topNotes.length > 0) {
    await db.insert(competitorPostsTable).values(topNotes.map((n) => ({
      competitorId: bucket.id,
      platform: "xhs",
      externalId: n.id,
      mediaType: (n.type === "video" ? "video" : "image") as const,
      title: n.title,
      description: `[作者: ${n.author || "未知"}] ${n.desc ?? ""}`.slice(0, 500),
      coverUrl: n.cover_url,
      likeCount: n.liked_count ?? 0,
      commentCount: n.comment_count ?? 0,
      shareCount: n.shared_count ?? 0,
      viewCount: 0,
      hashtags: n.tags ?? [],
      isViral: (n.liked_count ?? 0) > 1000,
    })));
    postsCollected = topNotes.length;
  }

  return {
    platform: "xhs",
    ok: true,
    added,
    skippedExisting: added === 0 ? 1 : 0,
    postsCollected,
    message: `小红书「${niche}」自动发现池已${added === 0 ? "刷新" : "建立"}，收录 ${postsCollected} 条爆款笔记（涵盖 ${new Set(topNotes.map((n) => n.author).filter(Boolean)).size} 位作者）`,
  };
}

// ────────────────────────────────────────────────────────────────────────
// 24h 后台自动续航：找出所有"陈旧"的同行 profile，再次拉取最新作品
// （仅 tiktok / xhs，FB/IG 需用户 oauth token）
// ────────────────────────────────────────────────────────────────────────
const STALE_HOURS = 24;
const MAX_REFRESH_PER_TICK = 30;

export async function runAutoSyncStaleCompetitors(): Promise<{ refreshed: number; postsCollected: number }> {
  const cutoff = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000);
  const stale = await db
    .select()
    .from(competitorProfilesTable)
    .where(and(
      or(eq(competitorProfilesTable.platform, "tiktok"), eq(competitorProfilesTable.platform, "xhs")),
      or(isNull(competitorProfilesTable.lastSyncedAt), lt(competitorProfilesTable.lastSyncedAt, cutoff)),
    ))
    .orderBy(competitorProfilesTable.lastSyncedAt)
    .limit(MAX_REFRESH_PER_TICK);

  let refreshed = 0;
  let postsCollected = 0;
  const refreshedProfiles: Array<typeof stale[number]> = [];

  for (const p of stale) {
    try {
      if (p.platform === "tiktok") {
        const profile = await fetchTikTokProfile(p.handle);
        if (!profile?.secUid) continue;
        const vids = await fetchTikTokUserVideos(profile.secUid, 12).catch(() => []);
        await db.update(competitorProfilesTable).set({
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          bio: profile.bio,
          followerCount: profile.followerCount,
          followingCount: profile.followingCount,
          postCount: profile.postCount,
          lastSyncedAt: new Date(),
        }).where(eq(competitorProfilesTable.id, p.id));
        if (vids.length > 0) {
          await db.delete(competitorPostsTable).where(eq(competitorPostsTable.competitorId, p.id));
          await db.insert(competitorPostsTable).values(vids.map((v) => ({
            competitorId: p.id, platform: "tiktok",
            externalId: v.externalId, mediaType: "video" as const,
            description: v.description, coverUrl: v.coverUrl, mediaUrl: v.videoUrl,
            mediaUrls: v.videoUrl ? [v.videoUrl] : [],
            postUrl: `https://www.tiktok.com/@${profile.handle}/video/${v.externalId}`,
            viewCount: v.viewCount, likeCount: v.likeCount, commentCount: v.commentCount, shareCount: v.shareCount,
            duration: v.duration, musicName: v.musicName, musicAuthor: v.musicAuthor,
            hashtags: v.hashtags, publishedAt: v.publishedAt, isViral: v.isViral,
          })));
          postsCollected += vids.length;
        }
        refreshed++;
        refreshedProfiles.push(p);
      } else if (p.platform === "xhs") {
        const isBucket = p.handle.startsWith("__auto_xhs__:");
        const kw = (p.category ?? "").trim() || (isBucket ? p.handle.replace("__auto_xhs__:", "") : p.handle).trim();
        if (!kw) continue;
        const search = await tryFetchXhsData(kw).catch(() => null);
        if (!search?.available || !search.notes || search.notes.length === 0) continue;

        // bucket profile：取按热度排序的 Top 笔记；普通 profile：仍按 author 严格过滤
        let notesToWrite: typeof search.notes = [];
        if (isBucket) {
          const dedup = new Map<string, typeof search.notes[number]>();
          for (const n of search.notes) if (n.id && !dedup.has(n.id)) dedup.set(n.id, n);
          notesToWrite = [...dedup.values()]
            .sort((a, b) => (b.liked_count ?? 0) + (b.collected_count ?? 0) - ((a.liked_count ?? 0) + (a.collected_count ?? 0)))
            .slice(0, 20);
        } else {
          notesToWrite = search.notes
            .filter((n) => (n.author ?? "").toLowerCase() === p.handle.toLowerCase())
            .slice(0, 12);
        }

        await db.update(competitorProfilesTable).set({ lastSyncedAt: new Date() })
          .where(eq(competitorProfilesTable.id, p.id));
        if (notesToWrite.length > 0) {
          await db.delete(competitorPostsTable).where(eq(competitorPostsTable.competitorId, p.id));
          await db.insert(competitorPostsTable).values(notesToWrite.map((n) => ({
            competitorId: p.id, platform: "xhs",
            externalId: n.id, mediaType: (n.type === "video" ? "video" : "image") as const,
            title: n.title,
            description: isBucket ? `[作者: ${n.author || "未知"}] ${n.desc ?? ""}`.slice(0, 500) : n.desc,
            coverUrl: n.cover_url,
            likeCount: n.liked_count ?? 0, commentCount: n.comment_count ?? 0,
            shareCount: n.shared_count ?? 0, viewCount: 0,
            hashtags: n.tags ?? [], isViral: (n.liked_count ?? 0) > 1000,
          })));
          postsCollected += notesToWrite.length;
        }
        refreshed++;
        refreshedProfiles.push(p);
      }
    } catch (err: any) {
      logger.warn({ err: err?.message, profileId: p.id, platform: p.platform }, "autoSync single profile failed");
    }
  }

  // 仅对成功刷新且有有效 category 的 profile 收集 touched niches，避免无谓重算
  const touched = new Set<string>();
  for (const p of refreshedProfiles) {
    if (p.category && p.category.trim().length >= 2) {
      touched.add(`${p.platform}::${p.category.trim()}`);
    }
  }
  for (const key of touched) {
    const [platform, niche] = key.split("::");
    triggerCategoryRecompute(platform, niche);
  }

  logger.info({ scanned: stale.length, refreshed, postsCollected, touchedNiches: touched.size }, "autoSyncStaleCompetitors done");
  return { refreshed, postsCollected };
}
