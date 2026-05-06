import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "../lib/logger.js";
import { checkForbiddenMany } from "./brandContext.js";
import { loadViralContext } from "./viralContext.js";
import { loadStyleProfileForPrompt } from "./styleProfile.js";
import type { SeedanceAspect } from "./seedance.js";

/**
 * 视频生成"创意 brief" — 基于 4 层 viralContext（同行样本 + 类目沉淀 + 个人画像 + 热点）
 * 与可选的同行参考视频元数据，生成：
 *   - videoPrompt    : 给 Seedance 的镜头/画面 prompt（无字幕、无 logo）
 *   - hookText       : 前 3 秒大字幕钩子
 *   - subtitleSegments: 按时间分段的字幕（含字号/颜色/位置/样式 hint）
 *   - bgmSuggestion  : { mood, bpm, sampleNames[] } — 取自同行高频 BGM
 *   - emojisToInclude: 客户偏好 + 同行高频
 *   - aspectRatio / durationSec
 */

export type VideoMimicStrength = "full" | "partial" | "minimal";

export interface SubtitleSegment {
  startSec: number;
  endSec: number;
  text: string;
  style: "hook" | "normal" | "cta";
  position: "top" | "center" | "bottom";
}

export interface BgmSuggestion {
  mood: string;          // 例如：upbeat / chill / suspense / emotional
  bpmRange: string;      // 例如：90-110
  matchedFromCompetitors: string[]; // 同行高频 BGM 名
  searchKeywords: string[]; // 给客户在 TikTok/CapCut/抖音 BGM 库里搜
}

export interface VideoCreativePlan {
  videoPrompt: string;
  hookText: string;
  subtitleSegments: SubtitleSegment[];
  bgmSuggestion: BgmSuggestion;
  emojisToInclude: string[];
  aspectRatio: SeedanceAspect;
  durationSec: 5 | 10;
  recommendedCameraFixed: boolean;
  styleSummary: string;     // 一句话总结视觉风格
  warning: string | null;
}

export interface VideoReferenceMeta {
  description?: string | null;     // 同行视频 caption
  hashtags?: string[];
  durationSec?: number | null;
  musicName?: string | null;
  coverImageUrl?: string | null;   // 用于 vision 分析首帧风格
  transcript?: string | null;       // 已有口播转录
}

export interface GenerateVideoPlanInput {
  userId: number;
  platform: "xhs" | "tiktok" | "instagram" | "facebook";
  newTopic: string;
  newTitle?: string;
  newKeyPoints?: string[];
  niche?: string | null;
  region?: string | null;
  mimicStrength?: VideoMimicStrength;
  referenceVideo?: VideoReferenceMeta | null;
  customSubtitles?: Array<{ startSec: number; endSec: number; text: string }> | null;
  customEmojis?: string[] | null;
  customBgmMood?: string | null;
  preferredAspect?: SeedanceAspect | null;
  preferredDurationSec?: 5 | 10 | null;
  extraInstructions?: string | null;
  // 品牌画像 prompt 片段（含 [品牌画像 — 必须严格遵守] 头 + 禁用宣称）。
  // 由调用方 (videoGen.ts / autoMediaForDraft / strategy approve) 在 enqueue 前
  // await loadBrandContext() 拼好,序列化进 video_jobs.input,worker 跑 plan 时透传到 prompt。
  brandBlock?: string | null;
  // 结构化禁用宣称(与 brandBlock 同源)— 输出后置二次校验直接用,不再 regex 反解 brandBlock
  forbiddenClaims?: string[] | null;
}

const PLATFORM_VIDEO_PRESET: Record<string, { aspect: SeedanceAspect; defaultDur: 5 | 10; styleHint: string }> = {
  tiktok: {
    aspect: "9:16", defaultDur: 5,
    styleHint: "TikTok 短视频：前 3 秒强 hook（人物特写/反差/数字冲击）→ 中段快节奏剪辑感 → CTA。镜头要有动作变化，避免静帧。",
  },
  xhs: {
    aspect: "9:16", defaultDur: 5,
    styleHint: "小红书短视频：明亮温暖、生活感、第一视角；镜头平稳无突兀切换；色调柔和高级。",
  },
  instagram: {
    aspect: "9:16", defaultDur: 5,
    styleHint: "Instagram Reels：editorial / lifestyle 调性，构图精致留白考究，柔和高级感配色。",
  },
  facebook: {
    aspect: "16:9", defaultDur: 10,
    styleHint: "Facebook：横版叙事感，主体清晰、可读性高，节奏稳，类似新闻 / 故事配图。",
  },
};

const PLAN_SYSTEM_PROMPT = `你是顶级短视频创意总监，专精 TikTok / 小红书 / Reels 爆款拆解 + AI 视频生成 prompt 撰写。
你将基于：① 该客户行业的同行爆款多层数据 ② 客户个人风格档案 ③（可选）一条同行参考视频的元数据 ④ 客户新主题，
输出一份完整的视频生成 brief（严格 JSON）。

硬规则：
1. videoPrompt 是给 AI 视频模型（豆包 Seedance）的镜头描述 — 中英混合、150-300 字，要包含：主体/动作、镜头语言（特写/中景/推拉摇移）、光线、色调、材质、节奏、风格关键词。**不能让 AI 画字幕、logo、文字**——必须明确写 "no text, no subtitles, no captions, no logo"。
2. hookText: 前 3 秒钉死的大字幕钩子，6-14 字，必须制造好奇缺口/反差/具体数字。
3. subtitleSegments: 把口播/重点全程切成 2-5 段时间轴字幕（覆盖整个视频时长），每段包含 startSec/endSec/text/style/position。
   - style="hook" 用于 0-3 秒大字钩子（顶部或正中央）
   - style="normal" 是中段叙述（底部）
   - style="cta" 用于结尾行动号召（底部或正中央）
   - 每段 text 不超过 16 个汉字 / 30 个英文字母（避免一行装不下）
4. bgmSuggestion:
   - mood: upbeat / chill / emotional / suspense / inspirational / luxe / cute（七选一）
   - bpmRange: 例如 "90-110"
   - matchedFromCompetitors: 从【同行高频 BGM】里挑（如果有）
   - searchKeywords: 3-5 个英中搜索关键词，方便客户在 TikTok / CapCut / 抖音音乐库里找
5. emojisToInclude: 4-8 个，优先用同行/客户偏好里出现过的
6. recommendedCameraFixed: true=镜头不动（适合产品/食物/手部特写），false=有运镜
7. 严格遵守 mimicStrength：
   - full=镜头语言、节奏、字幕风格、BGM 风格全部贴近同行参考
   - partial=借鉴风格，但内容自由
   - minimal=只参考氛围

输出严格 JSON：
{
  "videoPrompt": "...",
  "hookText": "...",
  "subtitleSegments": [{"startSec":0,"endSec":3,"text":"...","style":"hook","position":"center"}],
  "bgmSuggestion": {"mood":"upbeat","bpmRange":"90-110","matchedFromCompetitors":[],"searchKeywords":[]},
  "emojisToInclude": ["✨","🔥"],
  "styleSummary": "..."
}`;

async function analyzeReferenceCover(coverUrl: string, log?: any): Promise<string> {
  try {
    const r = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 600,
      temperature: 0.3,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "用 4-6 句中文，简要描述这张短视频封面/首帧的：主体、镜头景别、光线色调、整体氛围、字幕设计风格（颜色/字体/位置）、画面节奏感。只输出描述文字，不要 JSON。" },
          { type: "image_url", image_url: { url: coverUrl, detail: "low" } },
        ],
      }],
    });
    return r.choices[0]?.message?.content?.trim() ?? "";
  } catch (err: any) {
    (log || logger).warn({ err: err?.message }, "video cover analysis failed");
    return "";
  }
}

export async function generateVideoCreativePlan(
  input: GenerateVideoPlanInput,
  log?: any,
): Promise<VideoCreativePlan> {
  const preset = PLATFORM_VIDEO_PRESET[input.platform] ?? PLATFORM_VIDEO_PRESET.tiktok;
  const aspect: SeedanceAspect = input.preferredAspect ?? preset.aspect;
  const dur: 5 | 10 = input.preferredDurationSec ?? preset.defaultDur;
  const strength: VideoMimicStrength = input.mimicStrength ?? "partial";

  // 1) 4 层 viralContext（同行样本 + 类目 + 个人 + 热点 + 高频 BGM）
  const viral = await loadViralContext({
    userId: input.userId,
    platform: input.platform,
    niche: input.niche ?? undefined,
    region: input.region ?? undefined,
    maxPosts: 8,
    includeUserProfile: true,
  });

  // 2) 个人风格档案（emoji / 色调 / 情绪偏好）
  const styleProfile = await loadStyleProfileForPrompt(input.userId).catch(() => null);

  // 3) 同行参考视频深度分析（封面 vision + caption / hashtags / 时长 / BGM / 转录）
  let refBlock = "";
  if (input.referenceVideo) {
    const r = input.referenceVideo;
    const lines: string[] = ["【同行参考视频元数据】"];
    if (r.description) lines.push(`- 描述: ${r.description.slice(0, 200)}`);
    if (r.hashtags && r.hashtags.length > 0) lines.push(`- 标签: ${r.hashtags.slice(0, 8).map((t) => `#${t.replace(/^#/, "")}`).join(" ")}`);
    if (r.durationSec) lines.push(`- 时长: ${r.durationSec}s`);
    if (r.musicName) lines.push(`- BGM: ${r.musicName}`);
    if (r.transcript) lines.push(`- 口播转录(节选): ${r.transcript.slice(0, 300)}`);
    if (r.coverImageUrl) {
      const visionDesc = await analyzeReferenceCover(r.coverImageUrl, log);
      if (visionDesc) lines.push(`- 封面/首帧视觉分析: ${visionDesc}`);
    }
    refBlock = "\n" + lines.join("\n");
  }

  // 4) 个人风格 hint
  const styleBlock = styleProfile && styleProfile.sampleSize > 0
    ? `\n【该客户历史风格档案】（${styleProfile.sampleSize} 条采用样本）
- 偏爱色调: ${styleProfile.dominantColors.join(", ") || "—"}
- 偏爱情绪: ${styleProfile.preferredMoods.join(", ") || "—"}
- 偏爱 emoji: ${styleProfile.preferredEmojis.join(" ") || "—"}
- 偏爱字幕风格: ${styleProfile.preferredFonts.join(", ") || "—"}
请融入到 videoPrompt + bgmSuggestion + emojisToInclude 中。`
    : "";

  const customSubsBlock = input.customSubtitles && input.customSubtitles.length > 0
    ? `\n【客户已指定字幕段】（必须保留并用于 subtitleSegments）：\n${input.customSubtitles.map((s) => `[${s.startSec}-${s.endSec}s] ${s.text}`).join("\n")}`
    : "";
  const customEmojiBlock = input.customEmojis && input.customEmojis.length > 0
    ? `\n【客户指定 emoji】：${input.customEmojis.join(" ")}`
    : "";
  const customBgmBlock = input.customBgmMood
    ? `\n【客户指定 BGM 风格】：${input.customBgmMood}`
    : "";

  // BUG 修复：input.brandBlock 类型是 string | null | undefined。
  // 之前用 `?? ""` 只对 undefined 兜底,**null ?? "" === null** → 拼到模板字符串就是 "null" 字面量串进 prompt,
  // 直接污染 LLM 输入。这里改 `|| ""` 同时把 null 当 falsy 兜底。
  const brandBlock = input.brandBlock || "";

  const userMsg = `${viral.promptBlock}
${refBlock}
${styleBlock}
${brandBlock}

【新视频主题】 ${input.newTopic}
${input.newTitle ? `【建议标题】 ${input.newTitle}` : ""}
${input.newKeyPoints?.length ? `【卖点】 ${input.newKeyPoints.join("、")}` : ""}

【模仿强度】 ${strength}
【目标平台】 ${input.platform}（${preset.styleHint}）
【画幅 / 时长】 ${aspect} / ${dur}s
${customSubsBlock}${customEmojiBlock}${customBgmBlock}
${input.extraInstructions ? `\n【额外指令】 ${input.extraInstructions}` : ""}

请输出严格 JSON 视频生成 brief（必须覆盖 0~${dur}s 的字幕时间轴）。${brandBlock ? "\n字幕段(subtitleSegments) 与 hookText 必须严格遵守上方品牌画像的调性与【禁用宣称】,任何禁用词及其同义词都不能出现在字幕里。" : ""}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 2200,
    temperature: 0.75,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: PLAN_SYSTEM_PROMPT },
      { role: "user", content: userMsg },
    ],
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new Error("Video plan generation returned empty");
  const parsed = JSON.parse(raw) as Partial<VideoCreativePlan>;

  // ── brand-guard：扫描 hookText / subtitleSegments 命中 forbiddenClaims ──
  // observability(字幕一旦烧进视频再撤回成本极高,但 worker 自动重写也会双倍扣费,
  // 所以这里只 warn 让运营/后续上游决定)。直接用结构化 forbiddenClaims,告别 regex 反解。
  const claims = input.forbiddenClaims ?? [];
  if (claims.length > 0) {
    const subTexts = Array.isArray(parsed.subtitleSegments)
      ? parsed.subtitleSegments.map((s: any) => (s && typeof s.text === "string" ? s.text : ""))
      : [];
    // hookText 用 ?? "" 而不是 String() — 后者会把 null 转成字面量 "null"
    const all = [typeof parsed.hookText === "string" ? parsed.hookText : "", ...subTexts];
    const flag = checkForbiddenMany(all, claims);
    if (flag.hit.length > 0) {
      logger.warn(
        { stage: "videoPipeline.generateVideoCreativePlan", userId: input.userId, platform: input.platform, hit: flag.hit },
        "[brand-guard] forbiddenClaims hit in subtitle/hookText",
      );
    }
  }

  // 兜底 + 类型清洗
  const segs: SubtitleSegment[] = Array.isArray(parsed.subtitleSegments)
    ? parsed.subtitleSegments
        .filter((s: any) => s && typeof s.text === "string" && Number.isFinite(s.startSec) && Number.isFinite(s.endSec))
        .map((s: any) => ({
          startSec: Math.max(0, Math.min(dur, Number(s.startSec))),
          endSec: Math.max(0.5, Math.min(dur, Number(s.endSec))),
          text: String(s.text).slice(0, 40),
          style: s.style === "hook" || s.style === "cta" ? s.style : "normal",
          position: s.position === "top" || s.position === "center" ? s.position : "bottom",
        }))
    : [];
  if (segs.length === 0 && parsed.hookText) {
    segs.push({ startSec: 0, endSec: Math.min(3, dur), text: String(parsed.hookText).slice(0, 16), style: "hook", position: "center" });
  }

  // 强制叠加客户已指定字幕（覆盖同段）
  if (input.customSubtitles && input.customSubtitles.length > 0) {
    for (const cs of input.customSubtitles) {
      segs.push({
        startSec: Math.max(0, Math.min(dur, cs.startSec)),
        endSec: Math.max(0.5, Math.min(dur, cs.endSec)),
        text: cs.text.slice(0, 40),
        style: "normal",
        position: "bottom",
      });
    }
  }
  segs.sort((a, b) => a.startSec - b.startSec);

  const bgm = parsed.bgmSuggestion ?? {} as Partial<BgmSuggestion>;
  const finalBgm: BgmSuggestion = {
    mood: typeof bgm.mood === "string" ? bgm.mood : (input.customBgmMood ?? "upbeat"),
    bpmRange: typeof bgm.bpmRange === "string" ? bgm.bpmRange : "90-120",
    matchedFromCompetitors: Array.isArray(bgm.matchedFromCompetitors) ? bgm.matchedFromCompetitors : viral.topMusic,
    searchKeywords: Array.isArray(bgm.searchKeywords) ? bgm.searchKeywords.slice(0, 6) : [],
  };

  let emojis = Array.isArray(parsed.emojisToInclude) ? parsed.emojisToInclude.filter((e: any) => typeof e === "string") : [];
  if (input.customEmojis && input.customEmojis.length > 0) emojis = input.customEmojis;
  if (emojis.length === 0 && styleProfile?.preferredEmojis) emojis = styleProfile.preferredEmojis.slice(0, 6);

  return {
    videoPrompt: typeof parsed.videoPrompt === "string" ? parsed.videoPrompt : `${input.newTopic}, cinematic, ${preset.styleHint}, no text, no subtitles, no captions, no logo`,
    hookText: typeof parsed.hookText === "string" ? parsed.hookText.slice(0, 18) : input.newTopic.slice(0, 14),
    subtitleSegments: segs,
    bgmSuggestion: finalBgm,
    emojisToInclude: emojis,
    aspectRatio: aspect,
    durationSec: dur,
    recommendedCameraFixed: false,
    styleSummary: typeof parsed.styleSummary === "string" ? parsed.styleSummary : "",
    warning: viral.warning,
  };
}
