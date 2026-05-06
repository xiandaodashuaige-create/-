import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "../lib/logger";

export type PlanItem = {
  dayOffset: number;       // 0..6 from startDate
  time: string;            // "HH:mm"
  title: string;
  body: string;
  tags: string[];
  imagePrompt?: string;
  topic?: string;
};

export type GenerateWeeklyPlanInput = {
  platform: "xhs" | "tiktok" | "instagram" | "facebook";
  niche: string;
  region?: string;
  frequency?: "daily" | "twice-daily" | "every-other-day" | "weekly-3";
  audience?: string;
  styleHints?: string;
  language?: "zh" | "en";
  // 已收集爆款数据上下文（必须传入，由路由层 loadViralContext() 注入）
  viralPromptBlock?: string;
  viralHashtags?: string[];
  // 品牌画像（per-platform，由路由层从 brandProfilesTable 读出后拼成 prompt 片段）
  brandBlock?: string;
};

const FREQ_DESC: Record<NonNullable<GenerateWeeklyPlanInput["frequency"]>, string> = {
  "daily": "每天 1 条，共 7 条",
  "twice-daily": "每天 2 条（上午 / 晚间），共 14 条",
  "every-other-day": "隔天 1 条（第 0/2/4/6 天），共 4 条",
  "weekly-3": "一周 3 条（建议周一/周三/周六），共 3 条",
};

const FREQ_MAX: Record<NonNullable<GenerateWeeklyPlanInput["frequency"]>, number> = {
  "daily": 7,
  "twice-daily": 14,
  "every-other-day": 4,
  "weekly-3": 3,
};

function isValidHHMM(s: string): boolean {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return false;
  const h = parseInt(m[1], 10);
  const mn = parseInt(m[2], 10);
  return h >= 0 && h <= 23 && mn >= 0 && mn <= 59;
}

const PLATFORM_GUIDE: Record<GenerateWeeklyPlanInput["platform"], string> = {
  xhs: "小红书图文笔记：标题 ≤20 字带 emoji + 钩子；正文 200~400 字+表情+段落；3~6 个 #话题",
  tiktok: "TikTok 短视频脚本：标题 hook 一句、正文 60~120 字脚本/字幕分镜；3~5 个 #英文/中文标签",
  instagram: "Instagram 图文/Reel：英文为主标题、正文 80~150 字、5~10 个英文标签",
  facebook: "Facebook 帖子：偏长文 150~300 字；社群口吻；2~4 个标签",
};

const PEAK_TIMES: Record<GenerateWeeklyPlanInput["platform"], string[]> = {
  xhs: ["10:00", "12:30", "20:00", "21:30"],
  tiktok: ["12:00", "19:00", "21:00"],
  instagram: ["09:00", "12:00", "19:00"],
  facebook: ["08:00", "13:00", "20:00"],
};

export async function generateWeeklyPlan(input: GenerateWeeklyPlanInput): Promise<PlanItem[]> {
  const freq = input.frequency ?? "daily";
  const lang = input.language ?? "zh";
  const peakTimes = PEAK_TIMES[input.platform].join(" / ");

  const viralBlock = input.viralPromptBlock ?? "";
  const brandBlock = input.brandBlock ?? "";
  const hashtagHint = input.viralHashtags && input.viralHashtags.length > 0
    ? `\n7) tags 必须从这批已收集的高频/热门 hashtags 里至少挑 50%：${input.viralHashtags.slice(0, 12).map((t) => `#${t}`).join(" ")}，再补充 1-2 个长尾词；不要凭空生造。`
    : "";
  const brandRules = brandBlock
    ? `\n8) 必须严格符合下方"品牌画像"：所有内容紧贴目标受众/品牌调性/转化目标；任何【禁用宣称】绝对不能出现（哪怕是同义词、暗示、反问句）；如涉及商品请围绕清单内的产品。`
    : "";

  const systemPrompt = `你是${input.platform.toUpperCase()}内容运营策略师。生成一份覆盖未来 7 天的发布计划。
平台规范：${PLATFORM_GUIDE[input.platform]}
发布频率：${FREQ_DESC[freq]}
建议时段：${peakTimes}
原则：
1) 7 天内话题不要重复；要有"金钱关心 / 痛点 / 干货 / 场景化 / 故事感"的混合配比
2) dayOffset 从 0 开始（=startDate 当天），最大 6
3) time 用 24h "HH:mm"，挑建议时段里的合适点
4) 每条 body 必须是完整可发布的草稿，不是大纲；钩子/句式/节奏必须借鉴下方"爆款样本"
5) tags 不带 #
6) imagePrompt 用一句简短英文/中文描述配图视觉，视觉风格也要参考样本${hashtagHint}${brandRules}
输出格式（严格 JSON）：{ "items": [ { "dayOffset": 0, "time": "20:00", "topic": "...", "title": "...", "body": "...", "tags": ["...","..."], "imagePrompt": "..." } ] }${brandBlock}${viralBlock}`;

  const userPrompt = `行业 / 业务：${input.niche}
${input.region ? `目标地区：${input.region}\n` : ""}${input.audience ? `目标受众：${input.audience}\n` : ""}${input.styleHints ? `风格偏好：${input.styleHints}\n` : ""}语言：${lang === "zh" ? "中文" : "English"}
请直接输出 JSON。务必让 7 条内容看起来"明显是从爆款规律里学出来的"，不是套模板。`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0.8,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { items?: PlanItem[] };
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const maxCount = FREQ_MAX[freq];
    // Sanity-clamp + 严格字段校验
    return items
      .filter((i) => i && typeof i.title === "string" && typeof i.body === "string")
      .map((i) => ({
        dayOffset: Math.max(0, Math.min(6, Number.isFinite(Number(i.dayOffset)) ? Math.floor(Number(i.dayOffset)) : 0)),
        time: typeof i.time === "string" && isValidHHMM(i.time) ? i.time : "20:00",
        title: i.title.trim().slice(0, 60) || "未命名",
        body: i.body,
        tags: Array.isArray(i.tags) ? i.tags.map((t) => String(t).replace(/^#/, "").slice(0, 30)).slice(0, 10) : [],
        imagePrompt: typeof i.imagePrompt === "string" ? i.imagePrompt : undefined,
        topic: typeof i.topic === "string" ? i.topic : undefined,
      }))
      .slice(0, maxCount);
  } catch (err) {
    logger.error({ err }, "Failed to generate weekly plan");
    throw new Error("AI 周计划生成失败");
  }
}
