import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  competitorPostsTable,
  competitorProfilesTable,
  hotTopicsCacheTable,
  type CompetitorPost,
} from "@workspace/db";
import { loadUserContentProfile, renderContentProfileForPrompt } from "./contentProfile.js";

// 同义词扩展（与 strategyGenerator 保持一致风格）
const NICHE_SYNONYMS: Record<string, string[]> = {
  培训: ["培训", "课程", "教育", "学习", "讲师", "教学", "课", "学员", "training", "course", "education", "tutor", "lesson", "class"],
  美妆: ["美妆", "化妆", "彩妆", "护肤", "口红", "粉底", "眼影", "beauty", "makeup", "skincare", "cosmetic"],
  美食: ["美食", "餐", "菜", "料理", "厨房", "food", "recipe", "cooking", "restaurant"],
  健身: ["健身", "瘦身", "减肥", "运动", "训练", "fitness", "workout", "gym", "yoga"],
  母婴: ["母婴", "宝宝", "孕妇", "育儿", "婴儿", "baby", "mom", "parenting"],
  数码: ["数码", "科技", "手机", "电脑", "tech", "gadget", "phone", "laptop"],
  服装: ["服装", "穿搭", "时尚", "衣", "鞋", "fashion", "outfit", "clothing", "style"],
  家居: ["家居", "家具", "装修", "收纳", "home", "furniture", "decor"],
  旅游: ["旅游", "旅行", "酒店", "景点", "travel", "trip", "hotel", "tour"],
  汽车: ["汽车", "车", "驾驶", "auto", "car", "vehicle"],
  房产: ["房产", "房子", "买房", "租房", "real estate", "property", "house"],
  金融: ["金融", "投资", "理财", "股票", "finance", "invest", "trading"],
  宠物: ["宠物", "猫", "狗", "pet", "cat", "dog"],
};

function expandNicheTokens(niche: string): string[] {
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
  return [...expanded].filter((t) => t.length >= 2 || !/[\u4e00-\u9fff]/.test(t));
}

function scorePost(p: CompetitorPost, profile: { handle?: string; displayName?: string | null; category?: string | null } | undefined, nicheTokens: string[]): number {
  if (nicheTokens.length === 0) return 1;
  const haystack = [
    p.description ?? "",
    p.title ?? "",
    (p.hashtags ?? []).join(" "),
    p.musicName ?? "",
    profile?.handle ?? "",
    profile?.displayName ?? "",
    profile?.category ?? "",
  ].join(" ").toLowerCase();
  let s = 0;
  for (const tok of nicheTokens) if (haystack.includes(tok)) s += 1;
  return s;
}

export type ViralContext = {
  promptBlock: string;       // 可直接拼接到 system / user prompt 的多行字符串
  topHashtags: string[];     // 高频标签（去 #）
  topTitles: string[];       // 高赞样本标题/描述前 80 字
  topMusic: string[];        // TT/IG/FB 高频 BGM
  avgDuration: number | null;
  avgLikes: number | null;
  sampleCount: number;       // 实际采用的样本数
  hasViralData: boolean;
  warning: string | null;
};

export type LoadViralContextInput = {
  userId: number;
  platform: "xhs" | "tiktok" | "instagram" | "facebook";
  niche?: string;
  region?: string;
  maxPosts?: number;         // 默认 10
  includeUserProfile?: boolean;
};

const PLATFORM_LABEL: Record<string, string> = {
  xhs: "小红书",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
};

/**
 * 汇总该用户已收集的爆款数据 → 拼成可注入 AI prompt 的"参考资料"。
 * 数据源（按优先级混合）：
 *   1) competitor_posts（用户已添加同行的真实爆款）— 按互动量+niche相关性打分挑 top
 *   2) hot_topics_cache（行业+地区维度 24h 缓存的热门标签 / 样例标题）— 仅 XHS 有
 *   3) user_content_profiles（客户自身历史风格画像）
 */
export async function loadViralContext(input: LoadViralContextInput): Promise<ViralContext> {
  const maxPosts = input.maxPosts ?? 10;
  const nicheTokens = expandNicheTokens(input.niche ?? "");
  const platformLabel = PLATFORM_LABEL[input.platform] || input.platform;

  // 1) 同平台、同用户的同行账号
  const profiles = await db
    .select()
    .from(competitorProfilesTable)
    .where(and(
      eq(competitorProfilesTable.userId, input.userId),
      eq(competitorProfilesTable.platform, input.platform),
    ))
    .orderBy(desc(competitorProfilesTable.followerCount));

  let posts: CompetitorPost[] = [];
  if (profiles.length > 0) {
    const profileIds = profiles.map((p) => p.id);
    posts = await db
      .select()
      .from(competitorPostsTable)
      .where(and(
        eq(competitorPostsTable.platform, input.platform),
        inArray(competitorPostsTable.competitorId, profileIds),
      ))
      .orderBy(desc(competitorPostsTable.likeCount))
      .limit(80);
  }

  // 打分 + 排序
  const profilesById = new Map(profiles.map((p) => [p.id, p]));
  const scored = posts.map((p) => {
    const score = scorePost(p, profilesById.get(p.competitorId) ?? undefined, nicheTokens);
    const popularity = Math.log10((p.viewCount ?? p.likeCount ?? 0) + 10);
    return { p, score, rank: score * 10 + popularity };
  });
  // niche 命中优先；命中不足 3 条时，回退到全量按热度排序（仍然要利用已采集数据）
  const matched = nicheTokens.length > 0
    ? scored.filter((x) => x.score > 0).sort((a, b) => b.rank - a.rank)
    : [];
  const allByPopularity = scored.sort((a, b) => b.rank - a.rank);
  const fellBackToPopularity = nicheTokens.length > 0 && matched.length < 3 && allByPopularity.length > 0;
  const usedPosts = (matched.length >= 3 ? matched : allByPopularity).slice(0, maxPosts).map((x) => x.p);

  // 聚合
  const hashtagCount = new Map<string, number>();
  const musicCount = new Map<string, number>();
  let totalDur = 0, durCnt = 0;
  let totalLikes = 0;
  for (const p of usedPosts) {
    (p.hashtags ?? []).forEach((h: string) => {
      const tag = h.replace(/^#/, "").trim().toLowerCase();
      if (tag) hashtagCount.set(tag, (hashtagCount.get(tag) ?? 0) + 1);
    });
    if (p.musicName) musicCount.set(p.musicName, (musicCount.get(p.musicName) ?? 0) + 1);
    if (p.duration) { totalDur += p.duration; durCnt++; }
    totalLikes += p.likeCount ?? 0;
  }
  const topHashtagsFromCompetitors = [...hashtagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t);
  const topMusic = [...musicCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
  const avgDuration = durCnt > 0 ? Math.round(totalDur / durCnt) : null;
  const avgLikes = usedPosts.length > 0 ? Math.round(totalLikes / usedPosts.length) : null;

  // 2) hot topics（仅 xhs 有数据，但其他平台 niche 命中也可借用）
  let hotTopicsBlock = "";
  let hotHashtags: string[] = [];
  let hotTitles: string[] = [];
  if (input.niche && input.niche.trim().length >= 2) {
    try {
      const region = input.region || "ALL";
      const today = new Date().toISOString().slice(0, 10);
      // 取最近 7 天内的缓存（不限于今天，避免完全没数据）
      const cached = await db
        .select()
        .from(hotTopicsCacheTable)
        .where(and(
          eq(hotTopicsCacheTable.niche, input.niche.trim()),
          eq(hotTopicsCacheTable.region, region),
          sql`${hotTopicsCacheTable.date} >= ${new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)}`,
        ))
        .orderBy(desc(hotTopicsCacheTable.date))
        .limit(1);
      if (cached.length > 0 && Array.isArray(cached[0].topics)) {
        const topics = cached[0].topics.slice(0, 10);
        hotHashtags = topics.map((t) => t.tag).filter(Boolean);
        hotTitles = topics.map((t) => t.sampleTitle).filter((s): s is string => !!s).slice(0, 6);
        if (topics.length > 0) {
          hotTopicsBlock = `\n【近期热门话题（${input.niche} · ${region} · 缓存 ${cached[0].date}）】\n` +
            topics.map((t) => `- #${t.tag}（${t.count} 次出现，最高赞 ${t.topLikes ?? "?"}${t.sampleTitle ? `；样例："${t.sampleTitle.slice(0, 40)}"` : ""}）`).join("\n");
        }
      }
    } catch {
      // 忽略 hot topics 读取失败
    }
  }

  // 3) 个人风格画像（可选）
  let profileBlock = "";
  if (input.includeUserProfile !== false) {
    try {
      const profile = await loadUserContentProfile(input.userId);
      profileBlock = renderContentProfileForPrompt(profile);
    } catch {
      // 忽略
    }
  }

  // 渲染 promptBlock
  const sampleBlock = usedPosts.length > 0
    ? usedPosts.slice(0, 6).map((p) => {
        const text = (p.description ?? p.title ?? "").trim().slice(0, 100);
        const tags = (p.hashtags ?? []).slice(0, 4).map((t) => `#${t.replace(/^#/, "")}`).join(" ");
        const stats = `👁 ${p.viewCount ?? "—"} ❤ ${p.likeCount ?? 0} 💬 ${p.commentCount ?? 0}`;
        return `- 「${text}」 ${stats}${p.duration ? ` ⏱${p.duration}s` : ""}${tags ? ` ${tags}` : ""}`;
      }).join("\n")
    : "";

  const competitorBlock = profiles.length > 0
    ? profiles.slice(0, 6).map((p) => `@${p.handle}（${p.followerCount}粉${p.category ? ` · ${p.category}` : ""}）`).join("、")
    : "";

  const allTopHashtags = Array.from(new Set([...topHashtagsFromCompetitors, ...hotHashtags])).slice(0, 12);
  const allTopTitles = Array.from(new Set([
    ...usedPosts.map((p) => (p.title ?? p.description ?? "").trim()).filter((s) => s.length > 0).slice(0, 6),
    ...hotTitles,
  ])).slice(0, 8);

  const hasViralData = usedPosts.length > 0 || hotTopicsBlock.length > 0;

  let warning: string | null = null;
  if (!hasViralData) {
    warning = `用户在 ${platformLabel} 平台尚未收集到与"${input.niche || "该行业"}"相关的爆款样本。建议先到「同行库」添加 3~5 个对标账号并抓取，AI 才能基于真实数据生成。`;
  } else if (fellBackToPopularity) {
    warning = `同行样本与"${input.niche}"行业关键词命中不足，已回退到按热度排序的全部已采集样本。建议添加更精准的对标账号以提升相关性。`;
  } else if (nicheTokens.length > 0 && usedPosts.length === 0) {
    warning = `已添加的同行账号没有命中"${input.niche}"相关样本，本次仅基于热门话题缓存生成。`;
  }

  const promptBlock = !hasViralData
    ? `\n【⚠️ 爆款参考数据】当前用户在 ${platformLabel} 暂无已收集的爆款样本，AI 将基于行业通用规律生成；请提示用户尽快添加同行账号以提升精准度。\n${profileBlock}`
    : `
【📊 已收集爆款参考数据 — 必须严格借鉴】（基于该用户在 ${platformLabel} 已抓取的真实数据）
${competitorBlock ? `\n• 对标同行账号：${competitorBlock}` : ""}${sampleBlock ? `\n• 同行爆款样本（按互动量+行业相关性 Top ${usedPosts.length}）：\n${sampleBlock}` : ""}
• 高频/热门 hashtags（生成 tags 时优先沿用与改写）：${allTopHashtags.length > 0 ? allTopHashtags.map((t) => `#${t}`).join(" ") : "—"}${topMusic.length > 0 ? `\n• 高频 BGM/音乐：${topMusic.join(" / ")}` : ""}${avgDuration ? `\n• 同行平均时长：${avgDuration}s（新内容尽量靠近）` : ""}${avgLikes ? `\n• 样本平均点赞：${avgLikes}` : ""}${hotTopicsBlock}

⚠️ 硬约束：
1. hashtags 必须从上面【高频/热门 hashtags】里至少挑 50%，再补充 1-2 个长尾词；不要凭空生造。
2. 钩子/标题结构、节奏、句式必须参考"同行爆款样本"，但主题强行回到用户行业【${input.niche || "未指定"}】。
3. 文案风格、emoji 用法、字数节奏必须与样本风格保持一致。
${profileBlock}`.trim();

  return {
    promptBlock,
    topHashtags: allTopHashtags,
    topTitles: allTopTitles,
    topMusic,
    avgDuration,
    avgLikes,
    sampleCount: usedPosts.length,
    hasViralData,
    warning,
  };
}
