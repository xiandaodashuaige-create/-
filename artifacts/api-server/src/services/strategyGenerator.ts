import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "../lib/logger";

// 行业同义词扩展（中英）— 用于过滤同行视频与目标行业的相关性
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

export interface StrategyCard {
  theme: string;
  hookFormula: string;
  scriptOutline: { order: number; description: string; dialogue: string; duration: number }[];
  voiceoverScript: string;
  bgmStyle: "upbeat" | "emotional" | "epic" | "calm" | "corporate";
  bgmReason: string;
  estimatedDuration: number;
  aspectRatio: "9:16" | "16:9" | "1:1" | "3:4";
  hashtags: string[];
  bestPostingTime: string;
  referenceCompetitors: { handle: string; why: string }[];
  reasoning: string[];
  targetAudience: string;
  // 给图文型平台用：建议封面/正文
  coverPrompt?: string;
  bodyDraft?: string;
}

const PLATFORM_PRESETS: Record<string, { aspectRatio: StrategyCard["aspectRatio"]; mediaType: string; promptHint: string }> = {
  tiktok: { aspectRatio: "9:16", mediaType: "短视频", promptHint: "前 3 秒钩子 + 节奏紧凑 + 字幕 + 热门 BGM" },
  instagram: { aspectRatio: "1:1", mediaType: "Reels / 图文", promptHint: "高质感视觉 + 故事弧线 + meaningful caption" },
  facebook: { aspectRatio: "16:9", mediaType: "图文 / 视频", promptHint: "对话感问句 + 引发评论互动 + 真人感" },
  xhs: { aspectRatio: "3:4", mediaType: "图文笔记", promptHint: "首图打动人 + 标题留钩子 + emoji 节奏" },
};

function sanitizeNiche(niche: string): string {
  return niche.replace(/[\r\n\t`{}<>\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

function expandNicheTokens(niche: string): string[] {
  const base = sanitizeNiche(niche);
  if (!base) return [];
  const tokens = base.split(/[\s,，、/／和与&\-_|]+/).map(t => t.trim().toLowerCase()).filter(Boolean);
  const expanded = new Set<string>(tokens);
  for (const t of tokens) {
    for (const [key, syns] of Object.entries(NICHE_SYNONYMS)) {
      if (t.includes(key) || syns.some(s => t.includes(s.toLowerCase()))) {
        syns.forEach(s => expanded.add(s.toLowerCase()));
        expanded.add(key);
      }
    }
  }
  // 去掉单字符 CJK token
  return [...expanded].filter(t => t.length >= 2 || !/[\u4e00-\u9fff]/.test(t));
}

function scorePost(p: any, profile: any, nicheTokens: string[]): number {
  if (nicheTokens.length === 0) return 1;
  const haystack = [
    p.description ?? "", p.caption ?? "", p.title ?? "",
    (p.hashtags ?? []).join(" "),
    p.musicName ?? "",
    profile?.handle ?? "", profile?.displayName ?? "", profile?.category ?? "",
  ].join(" ").toLowerCase();
  let s = 0;
  for (const tok of nicheTokens) if (haystack.includes(tok)) s += 1;
  return s;
}

export interface BrandProfileInput {
  category?: string | null;
  products?: string | null;
  targetAudience?: string | null;
  priceRange?: string | null;
  tone?: string | null;
  forbiddenClaims?: string[] | null;
  conversionGoal?: string | null;
  region?: string | null;
  language?: string | null;
}

export interface GenerateStrategyInput {
  platform: "xhs" | "tiktok" | "instagram" | "facebook";
  region?: string;
  niche?: string;
  competitorPosts: any[]; // 候选 competitor_posts rows
  competitorProfiles: any[]; // 候选 competitor_profiles rows
  accounts: any[]; // 用户已授权账号
  customRequirements?: string;
  brandProfile?: BrandProfileInput | null;
}

function buildBrandProfileBlock(bp: BrandProfileInput | null | undefined): string {
  if (!bp) return "";
  const lines: string[] = [];
  if (bp.category) lines.push(`- 类目：${bp.category}`);
  if (bp.products) lines.push(`- 主推产品/服务：${bp.products}`);
  if (bp.targetAudience) lines.push(`- 目标受众：${bp.targetAudience}`);
  if (bp.priceRange) lines.push(`- 价位区间：${bp.priceRange}`);
  if (bp.tone) lines.push(`- 品牌调性：${bp.tone}`);
  if (bp.conversionGoal) lines.push(`- 转化目标：${bp.conversionGoal}`);
  if (bp.forbiddenClaims && bp.forbiddenClaims.length > 0) {
    lines.push(`- ⛔ 禁用宣称（绝对不得出现）：${bp.forbiddenClaims.join("、")}`);
  }
  if (lines.length === 0) return "";
  return `\n\n【品牌画像 — 必须严格遵循】\n${lines.join("\n")}`;
}

export interface GenerateStrategyResult {
  card: StrategyCard;
  meta: {
    competitorsAnalyzed: number;
    postsAnalyzed: number;
    accountsConsidered: number;
    candidateProfiles: number;
    candidatePosts: number;
    filteredOutPosts: number;
    relevantPostsFound: number;
    dataMode: "niche_match" | "no_match_using_niche_only" | "no_niche";
    warning: string | null;
    nicheTokensUsed: string[];
  };
  filteredPostIds: number[];
}

export async function generateStrategyCard(input: GenerateStrategyInput): Promise<GenerateStrategyResult> {
  const { platform, region, niche, competitorPosts, competitorProfiles, accounts, customRequirements, brandProfile } = input;
  const preset = PLATFORM_PRESETS[platform] ?? PLATFORM_PRESETS.tiktok;
  const baseNiche = sanitizeNiche(niche ?? "");
  const nicheTokens = expandNicheTokens(niche ?? "");
  const hasNiche = nicheTokens.length > 0;

  const profilesById = new Map<number, any>(competitorProfiles.map(p => [p.id, p]));
  const scored = competitorPosts.map(p => {
    const score = scorePost(p, profilesById.get(p.competitorId), nicheTokens);
    const popularity = Math.log10((p.viewCount ?? p.likeCount ?? 0) + 10);
    return { p, score, rank: score * 10 + popularity };
  });

  const niceOnes = scored.filter(x => x.score > 0).sort((a, b) => b.rank - a.rank);
  const minSamples = 3;
  let usedPosts: any[];
  let dataMode: GenerateStrategyResult["meta"]["dataMode"];
  let warning: string | null = null;
  let usedProfiles: any[];

  if (!hasNiche) {
    usedPosts = scored.sort((a, b) => b.rank - a.rank).slice(0, 12).map(x => x.p);
    usedProfiles = competitorProfiles;
    dataMode = "no_niche";
  } else if (niceOnes.length >= minSamples) {
    usedPosts = niceOnes.slice(0, 12).map(x => x.p);
    const usedProfileIds = new Set(usedPosts.map(p => p.competitorId));
    usedProfiles = competitorProfiles.filter(p => usedProfileIds.has(p.id));
    dataMode = "niche_match";
    const irrelevant = competitorPosts.length - niceOnes.length;
    if (irrelevant > 0) warning = `已过滤 ${irrelevant} 条与"${baseNiche}"行业不相关的样本。`;
  } else {
    usedPosts = niceOnes.map(x => x.p);
    usedProfiles = [];
    dataMode = "no_match_using_niche_only";
    warning = `未在已添加的同行中找到"${baseNiche}"行业相关样本（${competitorPosts.length} 个候选均无关）。AI 将仅基于行业定位生成策略，建议先在"同行库"添加更精准的对标账号。`;
  }

  // 聚合洞察
  const hashtagCount = new Map<string, number>();
  const musicCount = new Map<string, number>();
  let totalDur = 0, durCnt = 0;
  for (const p of usedPosts) {
    (p.hashtags ?? []).forEach((h: string) => hashtagCount.set(h, (hashtagCount.get(h) ?? 0) + 1));
    if (p.musicName) musicCount.set(p.musicName, (musicCount.get(p.musicName) ?? 0) + 1);
    if (p.duration) { totalDur += p.duration; durCnt++; }
  }
  const topHashtags = [...hashtagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
  const topMusic = [...musicCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
  const avgDuration = durCnt > 0 ? Math.round(totalDur / durCnt) : (platform === "xhs" ? 0 : 30);

  const competitorBlock = usedProfiles.length > 0
    ? usedProfiles.map(p => `@${p.handle}（${p.followerCount ?? "?"}粉, ${p.category ?? baseNiche ?? "—"}）`).join("、")
    : "暂无相关同行";
  const sampleBlock = usedPosts.slice(0, 6).map(p =>
    `- 「${(p.description ?? p.caption ?? p.title ?? "").slice(0, 80)}」播放/赞 ${p.viewCount ?? "—"}/${p.likeCount} · 时长 ${p.duration ?? "—"}s · ${(p.hashtags ?? []).slice(0, 3).join(" ")}`
  ).join("\n") || "暂无样本";
  const accountBlock = accounts.length > 0
    ? accounts.map(a => `@${a.nickname}（${a.region}）`).join("、")
    : "新账号（暂无历史数据）";
  const customBlock = customRequirements ? `\n\n用户额外要求：${customRequirements}` : "";
  const brandBlock = buildBrandProfileBlock(brandProfile);

  const nicheConstraint = hasNiche
    ? `\n\n⚠️ 硬约束：用户行业=【${baseNiche}】。所有内容必须 100% 围绕此行业，严禁产出无关行业内容。如样本与行业无关，仅借鉴其爆款"结构/节奏/钩子手法"，主题强行回到【${baseNiche}】。`
    : "";
  const dataModeNote = dataMode === "no_match_using_niche_only"
    ? `\n\n⚠️ 当前同行样本与【${baseNiche}】不匹配，请完全忽略其主题，所有 hashtags 重新生成。`
    : dataMode === "niche_match"
    ? `\n\n✅ 样本已经过【${baseNiche}】相关性筛选。`
    : "";

  const systemPrompt = `你是${platform.toUpperCase()}爆款内容策略专家。
基于用户已授权账号画像 + 同行真实数据，给出"创作策略卡"。
当前平台特征：${preset.mediaType}（${preset.promptHint}），默认画幅 ${preset.aspectRatio}。
返回严格 JSON：
{
  "theme": "本次主推主题（一句话）",
  "hookFormula": "钩子公式（前3秒/前3行的具体模板）",
  "scriptOutline": [{"order": 1, "description": "场景", "dialogue": "台词或文案", "duration": 秒}, ... 3-4 个],
  "voiceoverScript": "<纯文本，直接给最终旁白；不要写任何前缀如『旁白：』『正文初稿：』等>",
  "bgmStyle": "upbeat | emotional | epic | calm | corporate",
  "bgmReason": "为什么选这个 BGM",
  "estimatedDuration": ${avgDuration},
  "aspectRatio": "${preset.aspectRatio}",
  "hashtags": ["#xxx", ... 5-8 个，与行业相关],
  "bestPostingTime": "建议发布时间",
  "referenceCompetitors": [{"handle": "对标账号", "why": "学什么"}, ... 2-3 个],
  "reasoning": ["决策理由 1", "理由 2", "理由 3"],
  "targetAudience": "目标受众一句话画像",
  "coverPrompt": "若需 AI 出封面图，给一段中文 prompt",
  "bodyDraft": "<纯正文文本；用户复制即发；不要任何前缀/标签/括号说明，例如禁止写『正文初稿（图文/FB 发布可直接用）：』『正文：』『Body Draft:』之类的开头>"
}
只返回 JSON。
⚠️ 关键格式约束：
- voiceoverScript / bodyDraft / coverPrompt 等所有文本字段，值必须是「成品」本身，不要在开头加任何形如「正文：」「旁白稿：」「（FB 可发）」「初稿如下：」的标签或解说。
- 用户会把字段值原样发到平台，任何标签都会泄漏成正文，是严重错误。${nicheConstraint}`;

  const userPrompt = `【账号定位】
- 平台：${platform}
- 地区：${region ?? "—"}
- 行业：${baseNiche || "未指定"}
- 已授权账号：${accountBlock}

【同行账号】
${competitorBlock}

【同行爆款样本】
${sampleBlock}

【真实数据洞察】
- 平均时长：${avgDuration}s
- 高频标签：${topHashtags.join(" ") || "—"}
- 高频 BGM：${topMusic.join(" / ") || "—"}${dataModeNote}${brandBlock}${customBlock}

请输出策略卡 JSON。`;

  const completion = await openai.chat.completions.create(
    {
      model: "gpt-5-mini",
      max_completion_tokens: 4500,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      reasoning_effort: "minimal" as any,
    },
    { timeout: 60_000, maxRetries: 1 },
  );

  const raw = completion.choices[0]?.message?.content ?? "";
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) {
    logger.error({ raw }, "strategy: no JSON in AI response");
    throw new Error("AI 未返回有效策略 JSON");
  }
  let card: StrategyCard;
  try { card = JSON.parse(m[0]); } catch (e: any) {
    logger.error({ raw, err: e?.message }, "strategy: JSON parse failed");
    throw new Error("策略 JSON 解析失败");
  }

  const validBgm = ["upbeat", "emotional", "epic", "calm", "corporate"] as const;
  if (!validBgm.includes(card.bgmStyle as any)) card.bgmStyle = "upbeat";
  if (!card.aspectRatio) card.aspectRatio = preset.aspectRatio;
  if (!Array.isArray(card.scriptOutline) || card.scriptOutline.length === 0) {
    throw new Error("策略缺少剧本场景");
  }
  if (!card.voiceoverScript) card.voiceoverScript = card.scriptOutline.map(s => s.dialogue).join(" ");
  if (!Array.isArray(card.hashtags)) card.hashtags = topHashtags;
  if (!card.estimatedDuration) card.estimatedDuration = avgDuration;

  return {
    card,
    meta: {
      competitorsAnalyzed: usedProfiles.length,
      postsAnalyzed: usedPosts.length,
      accountsConsidered: accounts.length,
      candidateProfiles: competitorProfiles.length,
      candidatePosts: competitorPosts.length,
      filteredOutPosts: hasNiche ? Math.max(0, competitorPosts.length - niceOnes.length) : 0,
      relevantPostsFound: hasNiche ? niceOnes.length : competitorPosts.length,
      dataMode,
      warning,
      nicheTokensUsed: nicheTokens.slice(0, 10),
    },
    filteredPostIds: usedPosts.map(p => p.id),
  };
}
