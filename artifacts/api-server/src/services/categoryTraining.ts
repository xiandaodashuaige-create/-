import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  competitorPostsTable,
  competitorProfilesTable,
  categoryTrainingProfilesTable,
  type CategoryTrainingProfile,
} from "@workspace/db";
import { logger } from "../lib/logger.js";

const NICHE_SYNONYMS: Record<string, string[]> = {
  培训: ["培训", "课程", "教育", "学习", "讲师", "课", "training", "course"],
  美妆: ["美妆", "化妆", "彩妆", "护肤", "beauty", "makeup", "skincare"],
  美食: ["美食", "餐", "菜", "料理", "food", "recipe"],
  健身: ["健身", "瘦身", "减肥", "运动", "fitness", "workout", "gym"],
  母婴: ["母婴", "宝宝", "孕妇", "育儿", "baby", "mom"],
  数码: ["数码", "科技", "手机", "tech", "gadget"],
  服装: ["服装", "穿搭", "时尚", "fashion", "outfit"],
  家居: ["家居", "家具", "装修", "home", "furniture"],
  旅游: ["旅游", "旅行", "travel", "trip"],
  汽车: ["汽车", "车", "auto", "car"],
  房产: ["房产", "房子", "real estate", "property"],
  金融: ["金融", "投资", "理财", "finance", "invest"],
  宠物: ["宠物", "猫", "狗", "pet"],
};

function expandTokens(niche: string): string[] {
  const base = (niche || "").trim().toLowerCase();
  if (!base) return [];
  const tokens = base.split(/[\s,，、/／和与&\-_|]+/).map((t) => t.trim()).filter(Boolean);
  const expanded = new Set<string>(tokens);
  for (const t of tokens) {
    for (const [key, syns] of Object.entries(NICHE_SYNONYMS)) {
      if (t.includes(key) || syns.some((s) => t.includes(s.toLowerCase()))) {
        syns.forEach((s) => expanded.add(s.toLowerCase()));
        expanded.add(key);
      }
    }
  }
  return [...expanded];
}

function detectTitlePattern(title: string): string {
  const t = (title || "").trim();
  if (!t) return "其他";
  if (/^[\d¥$￥]/.test(t) || /^\d+[岁天周月年个]/.test(t)) return "数字开头";
  if (/[?？！!]$/.test(t)) return "提问/感叹结尾";
  if (/(别|千万别|不要|绝不|后悔|踩雷|避坑)/.test(t)) return "警告/避坑型";
  if (/(对比|测评|VS|vs|横评)/.test(t)) return "对比测评型";
  if (/(攻略|清单|大全|合集|盘点|tips)/i.test(t)) return "干货清单型";
  if (/(亲测|实测|真实|记录|日记|分享)/.test(t)) return "真实体验型";
  if (/(反常识|没想到|惊呆|颠覆|原来)/.test(t)) return "反常识型";
  return "陈述型";
}

/**
 * 重新计算并持久化 (platform, niche) 的全平台训练画像。
 * 数据源：
 *   1) 全部用户的 competitor_posts（按 niche tokens 命中过滤，按 likeCount 排序 Top 100）
 *   2) 同 niche 关联的 competitor_profiles（按 category 模糊匹配）
 *   3) 全部用户已发布的 content（同 platform，title/body/tags 命中 niche tokens）
 */
export async function recomputeCategoryProfile(platform: string, niche: string): Promise<void> {
  const tokens = expandTokens(niche);
  if (tokens.length === 0) return;

  // 1) 拉同 platform 下、category 命中 niche 的 profiles
  const profileRows = await db
    .select()
    .from(competitorProfilesTable)
    .where(eq(competitorProfilesTable.platform, platform));
  const matchedProfileIds = new Set<number>();
  const contributingUsers = new Set<number>();
  for (const p of profileRows) {
    const hay = `${p.category ?? ""} ${p.handle ?? ""} ${p.displayName ?? ""}`.toLowerCase();
    if (tokens.some((t) => hay.includes(t))) {
      matchedProfileIds.add(p.id);
      contributingUsers.add(p.userId);
    }
  }

  // 2) 拉这些 profile 下的所有 posts + 全平台同 niche 文本命中的 posts
  const allPostsForPlatform = await db
    .select()
    .from(competitorPostsTable)
    .where(eq(competitorPostsTable.platform, platform))
    .orderBy(desc(competitorPostsTable.likeCount))
    .limit(2000);

  const matchedPosts = allPostsForPlatform.filter((p) => {
    if (matchedProfileIds.has(p.competitorId)) return true;
    const hay = `${p.title ?? ""} ${p.description ?? ""} ${(p.hashtags ?? []).join(" ")}`.toLowerCase();
    return tokens.some((t) => hay.includes(t));
  }).slice(0, 200);

  // 3) 用户 content（同 platform，niche 文本命中）
  const userContentRows = await db.execute(sql`
    SELECT c.id, c.title, c.body, c.tags, a.owner_user_id
    FROM content c
    INNER JOIN accounts a ON c.account_id = a.id
    WHERE c.platform = ${platform}
      AND c.status = 'published'
      AND a.owner_user_id IS NOT NULL
    ORDER BY c.published_at DESC NULLS LAST
    LIMIT 500
  `);
  const userContentSamples = (userContentRows.rows as Array<{ id: number; title: string; body: string; tags: string[]; owner_user_id: number }>).filter((c) => {
    const hay = `${c.title ?? ""} ${c.body ?? ""} ${(c.tags ?? []).join(" ")}`.toLowerCase();
    return tokens.some((t) => hay.includes(t));
  });
  for (const c of userContentSamples) contributingUsers.add(c.owner_user_id);

  if (matchedPosts.length === 0 && userContentSamples.length === 0) {
    return; // 不写空记录
  }
  await persistCategoryProfile(platform, niche, matchedPosts, userContentSamples, contributingUsers);
}

async function persistCategoryProfile(
  platform: string,
  niche: string,
  matchedPosts: Array<typeof competitorPostsTable.$inferSelect>,
  userContentSamples: Array<{ title: string; body: string; tags: string[] }>,
  contributingUsers: Set<number>,
): Promise<void> {
  // 聚合 hashtags（带互动量加权）
  const tagAgg = new Map<string, { count: number; totalLikes: number }>();
  for (const p of matchedPosts) {
    for (const raw of p.hashtags ?? []) {
      const tag = raw.replace(/^#/, "").trim().toLowerCase();
      if (!tag) continue;
      const cur = tagAgg.get(tag) ?? { count: 0, totalLikes: 0 };
      cur.count += 1;
      cur.totalLikes += p.likeCount ?? 0;
      tagAgg.set(tag, cur);
    }
  }
  for (const c of userContentSamples) {
    for (const raw of c.tags ?? []) {
      const tag = String(raw).replace(/^#/, "").trim().toLowerCase();
      if (!tag) continue;
      const cur = tagAgg.get(tag) ?? { count: 0, totalLikes: 0 };
      cur.count += 1;
      tagAgg.set(tag, cur);
    }
  }
  const topHashtags = [...tagAgg.entries()]
    .sort((a, b) => (b[1].count * 1000 + Math.log10(b[1].totalLikes + 10)) - (a[1].count * 1000 + Math.log10(a[1].totalLikes + 10)))
    .slice(0, 30)
    .map(([tag, v]) => ({ tag, count: v.count, totalLikes: v.totalLikes }));

  const patternCount = new Map<string, number>();
  const allTitles = [
    ...matchedPosts.map((p) => p.title ?? p.description ?? ""),
    ...userContentSamples.map((c) => c.title ?? ""),
  ];
  for (const t of allTitles) {
    const pat = detectTitlePattern(t);
    patternCount.set(pat, (patternCount.get(pat) ?? 0) + 1);
  }
  const topTitlePatterns = [...patternCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([value, count]) => ({ value, count }));

  const topTitles = matchedPosts
    .filter((p) => (p.title || p.description))
    .slice(0, 12)
    .map((p) => ({
      title: ((p.title ?? p.description) ?? "").slice(0, 80),
      likes: p.likeCount ?? 0,
      views: p.viewCount ?? 0,
      source: "competitor",
    }));

  const musicCount = new Map<string, number>();
  for (const p of matchedPosts) {
    if (p.musicName) musicCount.set(p.musicName, (musicCount.get(p.musicName) ?? 0) + 1);
  }
  const topMusic = [...musicCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));

  let totalDur = 0, durCnt = 0;
  for (const p of matchedPosts) if (p.duration) { totalDur += p.duration; durCnt++; }
  const avgDuration = durCnt > 0 ? Math.round(totalDur / durCnt) : null;

  let totalBody = 0, bodyCnt = 0, totalTagCnt = 0;
  for (const c of userContentSamples) {
    totalBody += (c.body ?? "").length;
    totalTagCnt += (c.tags ?? []).length;
    bodyCnt++;
  }
  const avgBodyLength = bodyCnt > 0 ? Math.round(totalBody / bodyCnt) : null;
  const avgTagCount = bodyCnt > 0 ? Math.round(totalTagCnt / bodyCnt) : null;

  await db
    .insert(categoryTrainingProfilesTable)
    .values({
      platform, niche, topHashtags, topTitlePatterns, topTitles, topMusic,
      avgDuration, avgBodyLength, avgTagCount,
      sampleSize: matchedPosts.length + userContentSamples.length,
      competitorPostsAnalyzed: matchedPosts.length,
      userContentAnalyzed: userContentSamples.length,
      contributingUsers: contributingUsers.size,
    })
    .onConflictDoUpdate({
      target: [categoryTrainingProfilesTable.platform, categoryTrainingProfilesTable.niche],
      set: {
        topHashtags, topTitlePatterns, topTitles, topMusic,
        avgDuration, avgBodyLength, avgTagCount,
        sampleSize: matchedPosts.length + userContentSamples.length,
        competitorPostsAnalyzed: matchedPosts.length,
        userContentAnalyzed: userContentSamples.length,
        contributingUsers: contributingUsers.size,
      },
    });
}

/** Fire-and-forget — 路由 handler 用，永远不抛错 */
export function triggerCategoryRecompute(platform: string | null | undefined, niche: string | null | undefined): void {
  if (!platform || !niche || niche.trim().length < 2) return;
  recomputeCategoryProfile(platform, niche.trim()).catch((err) => {
    logger.warn({ err: err?.message, platform, niche }, "recomputeCategoryProfile failed (non-fatal)");
  });
}

export async function loadCategoryProfile(platform: string, niche: string): Promise<CategoryTrainingProfile | null> {
  if (!niche || niche.trim().length < 2) return null;
  const tokens = expandTokens(niche);
  if (tokens.length === 0) return null;

  // 精确命中 niche 字符串
  const [exact] = await db
    .select()
    .from(categoryTrainingProfilesTable)
    .where(and(
      eq(categoryTrainingProfilesTable.platform, platform),
      eq(categoryTrainingProfilesTable.niche, niche.trim()),
    ))
    .limit(1);
  if (exact) return exact;

  // 退化：取同 platform 下，niche 字段被 token 包含的最大样本数 record
  const candidates = await db
    .select()
    .from(categoryTrainingProfilesTable)
    .where(eq(categoryTrainingProfilesTable.platform, platform))
    .orderBy(desc(categoryTrainingProfilesTable.sampleSize))
    .limit(20);
  for (const c of candidates) {
    const cTokens = expandTokens(c.niche);
    if (cTokens.some((t) => tokens.includes(t))) return c;
  }
  return null;
}

// 匿名聚合阈值：必须 >= MIN_CONTRIB 个不同客户共同贡献，且总样本 >= MIN_SAMPLE，
// 才能把统计结果回灌进 prompt，避免单租户数据通过聚合特征被反推。
const MIN_CONTRIB = 3;
const MIN_SAMPLE = 5;

export function renderCategoryProfileForPrompt(p: CategoryTrainingProfile | null): string {
  if (!p || p.sampleSize < MIN_SAMPLE || p.contributingUsers < MIN_CONTRIB) return "";
  const tags = p.topHashtags.slice(0, 12).map((h) => `#${h.tag}`).join(" ");
  const patterns = p.topTitlePatterns.slice(0, 4).map((x) => `${x.value}(${x.count})`).join("、");
  const titles = p.topTitles.slice(0, 4).map((t, i) => `   ${i + 1}. "${t.title}" (❤${t.likes})`).join("\n");
  const music = p.topMusic.slice(0, 3).map((m) => m.name).join(" / ");
  return `

🌐【全平台「${p.niche}」类目训练沉淀】（来自 ${p.contributingUsers} 个客户共 ${p.sampleSize} 条样本，平台后台持续训练成长）
- 全类目高频标签：${tags || "—"}
- 全类目高频钩子结构：${patterns || "—"}
- 全类目 Top 爆款样例：
${titles || "   （样本不足）"}${music ? `\n- 全类目高频 BGM：${music}` : ""}${p.avgDuration ? `\n- 全类目平均时长：${p.avgDuration}s` : ""}${p.avgBodyLength ? `\n- 全类目平均字数：${p.avgBodyLength}` : ""}
⚠️ 上述"全类目沉淀"是平台基于全体客户已收集数据训练的结果，**优先级高于通用规律，但低于该客户自身的爆款样本**。`;
}

/**
 * 扫描所有已知 (platform, category) 组合并刷新对应训练画像。
 * 优化：按 platform 一次性拉取 profiles + posts + content，再在内存按 niche 分桶，
 * 避免每个 niche 单独全表扫描（O(类目数 × 数据量) → O(数据量)）。
 */
export async function recomputeAllCategoryProfiles(): Promise<{ refreshed: number }> {
  const pairsRows = await db.execute(sql`
    SELECT DISTINCT platform, category
    FROM competitor_profiles
    WHERE category IS NOT NULL AND length(trim(category)) >= 2
  `);
  const pairs = pairsRows.rows as Array<{ platform: string; category: string }>;
  if (pairs.length === 0) return { refreshed: 0 };

  // 按 platform 分组
  const byPlatform = new Map<string, string[]>();
  for (const { platform, category } of pairs) {
    if (!byPlatform.has(platform)) byPlatform.set(platform, []);
    byPlatform.get(platform)!.push(category);
  }

  let refreshed = 0;
  for (const [platform, niches] of byPlatform) {
    // 平台级一次性拉取
    const profilesAll = await db
      .select()
      .from(competitorProfilesTable)
      .where(eq(competitorProfilesTable.platform, platform));
    const postsAll = await db
      .select()
      .from(competitorPostsTable)
      .where(eq(competitorPostsTable.platform, platform))
      .orderBy(desc(competitorPostsTable.likeCount))
      .limit(2000);
    const contentRows = await db.execute(sql`
      SELECT c.id, c.title, c.body, c.tags, a.owner_user_id
      FROM content c
      INNER JOIN accounts a ON c.account_id = a.id
      WHERE c.platform = ${platform}
        AND c.status = 'published'
        AND a.owner_user_id IS NOT NULL
      ORDER BY c.published_at DESC NULLS LAST
      LIMIT 500
    `);
    const contentAll = contentRows.rows as Array<{ id: number; title: string; body: string; tags: string[]; owner_user_id: number }>;

    for (const niche of niches) {
      try {
        await recomputeCategoryProfileFromBuckets(platform, niche, profilesAll, postsAll, contentAll);
        refreshed++;
      } catch (e: any) {
        logger.warn({ err: e?.message, platform, niche }, "recompute bucket failed");
      }
    }
  }
  logger.info({ refreshed, totalPairs: pairs.length }, "recomputeAllCategoryProfiles done");
  return { refreshed };
}

// 内部：基于已加载好的 platform 数据桶，计算单一 niche 画像
async function recomputeCategoryProfileFromBuckets(
  platform: string,
  niche: string,
  profilesAll: Array<typeof competitorProfilesTable.$inferSelect>,
  postsAll: Array<typeof competitorPostsTable.$inferSelect>,
  contentAll: Array<{ id: number; title: string; body: string; tags: string[]; owner_user_id: number }>,
): Promise<void> {
  const tokens = expandTokens(niche);
  if (tokens.length === 0) return;

  const matchedProfileIds = new Set<number>();
  const contributingUsers = new Set<number>();
  for (const p of profilesAll) {
    const hay = `${p.category ?? ""} ${p.handle ?? ""} ${p.displayName ?? ""}`.toLowerCase();
    if (tokens.some((t) => hay.includes(t))) {
      matchedProfileIds.add(p.id);
      contributingUsers.add(p.userId);
    }
  }
  const matchedPosts = postsAll.filter((p) => {
    if (matchedProfileIds.has(p.competitorId)) return true;
    const hay = `${p.title ?? ""} ${p.description ?? ""} ${(p.hashtags ?? []).join(" ")}`.toLowerCase();
    return tokens.some((t) => hay.includes(t));
  }).slice(0, 200);

  const userContentSamples = contentAll.filter((c) => {
    const hay = `${c.title ?? ""} ${c.body ?? ""} ${(c.tags ?? []).join(" ")}`.toLowerCase();
    return tokens.some((t) => hay.includes(t));
  });
  for (const c of userContentSamples) contributingUsers.add(c.owner_user_id);

  if (matchedPosts.length === 0 && userContentSamples.length === 0) return;
  await persistCategoryProfile(platform, niche, matchedPosts, userContentSamples, contributingUsers);
}
