// 平台特性 → AI 提示词上下文。所有 AI 端点（rewrite/title/hashtags/sensitivity）共用。
// 当前 4 平台：xhs / tiktok / instagram / facebook。默认走 xhs。

export type PromptPlatform = "xhs" | "tiktok" | "instagram" | "facebook";

export type PlatformPromptContext = {
  platform: PromptPlatform;
  platformDisplayName: string;
  // 写作系统提示前缀（你是 ___ 的内容创作者）
  rolePrompt: string;
  // 内容风格规范（每个平台的爆款 DNA）
  styleRules: string;
  // 标题约束
  titleRules: string;
  // 标签 / hashtag 约束
  hashtagRules: string;
  // 合规审查上下文
  complianceContext: string;
  // 默认输出语言
  defaultLanguage: "zh-Hans" | "zh-Hant" | "en";
};

const XHS: PlatformPromptContext = {
  platform: "xhs",
  platformDisplayName: "小红书",
  rolePrompt:
    "You are a professional Xiaohongshu (Little Red Book) content writer. Your job is to rewrite content to be original, engaging, and optimized for the platform.",
  styleRules:
    "- Keep the core message but rewrite completely\n- Use natural, conversational Chinese\n- Add line breaks and emoji for readability\n- Make it feel authentic and personal, not AI-generated\n- Avoid sensitive/banned words on Xiaohongshu",
  titleRules:
    "Rules for good XHS titles:\n- 15-25 characters, eye-catching\n- Use numbers, emojis, curiosity hooks\n- Use trending Xiaohongshu formats (干货 / 必看 / 避雷 / 攻略)",
  hashtagRules:
    "XHS hashtag rules: mix high/medium/low traffic, 5-10 tags, no spaces inside a tag, no English-only tags unless necessary.",
  complianceContext:
    "You are a Xiaohongshu content compliance checker. Watch for: medical claims, exaggerated efficacy, banned brand mentions, hard advertising, illegal categories.",
  defaultLanguage: "zh-Hans",
};

const TIKTOK: PlatformPromptContext = {
  platform: "tiktok",
  platformDisplayName: "TikTok",
  rolePrompt:
    "You are a professional TikTok short-video script + caption writer. Your job is to produce a hook-driven, retention-optimized video script with a punchy caption.",
  styleRules:
    "- Output structure: HOOK (first 2s, must stop the scroll) → BUILD (problem/promise) → PAYOFF (insight/twist) → CTA (comment/follow).\n- Caption: short, conversational, max 150 chars; can include 1-2 emoji.\n- Voice: high energy, native to platform; avoid corporate tone.\n- No long-form prose; favor punchy lines.",
  titleRules:
    "Rules for TikTok hooks (used as title/first line):\n- 6-12 words, ALL hook (curiosity gap, contrarian take, or bold claim)\n- Avoid generic intros like 'Hey guys' / 'In this video'\n- Front-load the most surprising word",
  hashtagRules:
    "TikTok hashtag rules: 3-5 tags, mix one large (#fyp / #foryou) + 2-3 niche + 1 trend. Lowercase, no spaces, no Chinese unless content is Chinese.",
  complianceContext:
    "You are a TikTok content compliance checker. Watch for: misleading health claims, prohibited products (weapons, regulated goods), copyrighted music callouts in script, and shadowban triggers (banned words list, spammy hashtag stuffing).",
  defaultLanguage: "en",
};

const INSTAGRAM: PlatformPromptContext = {
  platform: "instagram",
  platformDisplayName: "Instagram",
  rolePrompt:
    "You are a professional Instagram content writer for Feed/Reels captions. Produce captions that drive saves, shares and comments.",
  styleRules:
    "- Lead with a strong first line (visible before 'more').\n- Use line breaks for scannability.\n- Aesthetic, on-brand voice; can be aspirational or humorous.\n- End with an explicit CTA (save, share, comment with…).",
  titleRules:
    "Rules for Instagram first-line hooks:\n- 8-15 words; must work without seeing the image\n- Curiosity, value-promise, or relatable observation",
  hashtagRules:
    "Instagram hashtag rules: 8-15 tags, blocked block at end of caption or in first comment. Mix branded + community + niche tags. Avoid banned hashtags.",
  complianceContext:
    "You are an Instagram content compliance checker. Watch for: Meta community standards violations, misleading wellness/health claims, undisclosed paid partnerships (#ad), prohibited goods.",
  defaultLanguage: "en",
};

const FACEBOOK: PlatformPromptContext = {
  platform: "facebook",
  platformDisplayName: "Facebook",
  rolePrompt:
    "You are a professional Facebook page content writer. Produce posts optimized for shares, comments and meaningful interactions.",
  styleRules:
    "- Conversational, longer-form acceptable (1-3 short paragraphs).\n- Open with a relatable scene or question.\n- End with an open question to drive comments.\n- Links go on their own line.",
  titleRules:
    "Rules for Facebook post openers:\n- 1 sentence, relatable or news-worthy\n- Avoid clickbait flagged phrases ('You won't believe…', 'Shocking…')",
  hashtagRules:
    "Facebook hashtag rules: 0-3 tags max; hashtags have low ROI on FB so use sparingly and only for branded campaigns.",
  complianceContext:
    "You are a Facebook content compliance checker. Watch for: Meta community standards violations, engagement-bait phrases ('like if you agree', 'tag a friend who…') which suppress reach, prohibited goods, misinformation.",
  defaultLanguage: "en",
};

const TABLE: Record<PromptPlatform, PlatformPromptContext> = {
  xhs: XHS,
  tiktok: TIKTOK,
  instagram: INSTAGRAM,
  facebook: FACEBOOK,
};

export function getPlatformPromptContext(p: unknown): PlatformPromptContext {
  if (typeof p === "string" && p in TABLE) return TABLE[p as PromptPlatform];
  return XHS; // 默认 xhs，保持已有行为不变
}

// 便捷格式化：把 region/style 也合并起来给系统 prompt 用
export function buildRegionContext(region: string | undefined, ctx: PlatformPromptContext): string {
  if (!region) return "";
  if (ctx.platform === "xhs") {
    if (region === "HK")
      return "Target audience is in Hong Kong. IMPORTANT: write in Traditional Chinese (繁體中文) with natural Hong Kong Cantonese expressions and tone (搵=找, 嘅=的, 啲=些, 唔=不, 俾=给, 揀=选).";
    if (region === "SG") return "Target audience is in Singapore. Write in Simplified Chinese.";
    if (region === "MY") return "Target audience is in Malaysia. Write in Simplified Chinese.";
  }
  if (region === "GLOBAL" || region === "ALL") return "Target audience is global / English-speaking.";
  return `Target audience region: ${region}.`;
}
