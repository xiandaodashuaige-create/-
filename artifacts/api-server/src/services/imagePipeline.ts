import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "../lib/logger.js";

export interface CompetitorImageAnalysis {
  layoutType: string;
  mainColors: string[];
  visualStyle: string;
  mood: string;
  subject: string;
  textOverlays: Array<{
    text: string;
    position: "top" | "center" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
    style: string;
  }>;
  composition: string;
  keyElements: string[];
  // 新增 9 维度增强字段
  emojis: string[];
  textStyleDetail: string;
  emotionalHook: string;
  collageStructure: string;
  mimicAdvice: {
    mustKeep: string[];
    canChange: string[];
    avoid: string[];
  };
}

const ANALYSIS_PROMPT = `你是顶级小红书视觉设计专家+爆款心理学专家。请深度分析这张爆款封面图片，输出严格 JSON。

要分析以下 12 个维度，全部必填：

{
  "layoutType": "用一句话描述布局结构，例如：'上图下文 70/30' 或 '全屏文字+底图模糊' 或 '左图右文'",
  "mainColors": ["#HEX颜色1", "#HEX颜色2", "#HEX颜色3"],
  "visualStyle": "整体视觉风格，例如：'明亮生活感、留白多、ins简约风' 或 '暗调高级感、大字冲击'",
  "mood": "情绪氛围，例如：'种草欲望强、紧迫感' 或 '治愈温暖、适合女性'",
  "subject": "画面主体，例如：'美食特写' 或 '人物正脸大头照' 或 '产品平铺'",
  "textOverlays": [
    {
      "text": "图上实际看到的中文文字原文",
      "position": "top|center|bottom|top-left|top-right|bottom-left|bottom-right",
      "style": "字体描述，例如：'粗黑大字 白底红字带描边'"
    }
  ],
  "composition": "构图技法，例如：'中心对称、视觉焦点在中间' 或 '三分法、左侧主体右侧留白'",
  "keyElements": ["关键视觉元素1", "关键视觉元素2"],

  "emojis": ["图上识别到的emoji，如 ✨、🔥、💕、👇、💯（即使是表情贴纸/手绘表情也要识别）"],
  "textStyleDetail": "字幕的具体设计风格细节，例如：'圆角胶囊底色块+白字' 或 '黄底黑边粗体宋体' 或 '手写体+下划线' 或 '描边阴影+对角线排版'",
  "emotionalHook": "为什么这张图能爆？分析它的情绪钩子/痛点/反差，例如：'痛点共鸣：90后焦虑+反转治愈' 或 '反差冲击：丑照变美照前后对比' 或 '价格/数字冲击：199到底买不买'",
  "collageStructure": "如果是拼图，描述切分逻辑（几格、比例、分隔方式、各格内容关系）；如果是单图，写'单图'。例如：'2格上下7:3，上图大图主体下图文字总结' 或 '4格2x2 等分，前后对比配色统一' 或 '单图'",
  "mimicAdvice": {
    "mustKeep": ["必须保留的爆款基因，2-4条，例如：'粗黑大标题压顶'、'高饱和橙红主色'、'数字冲击 199'"],
    "canChange": ["可以替换的内容，2-4条，例如：'人物可换成产品图'、'文字内容可换'"],
    "avoid": ["避坑提醒，1-3条，例如：'不要把字写小'、'不要降低色彩饱和度'"]
  }
}

只输出 JSON，不要任何解释。如果图上没文字 textOverlays 返回 []，没 emoji 返回 []。`;

export async function analyzeCompetitorImage(imageUrl: string, log?: any): Promise<CompetitorImageAnalysis> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 2500,
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: ANALYSIS_PROMPT },
          { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
        ],
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Vision analysis returned empty response");

  try {
    const parsed = JSON.parse(content) as CompetitorImageAnalysis;
    parsed.mainColors = Array.isArray(parsed.mainColors) ? parsed.mainColors : [];
    parsed.textOverlays = Array.isArray(parsed.textOverlays) ? parsed.textOverlays : [];
    parsed.keyElements = Array.isArray(parsed.keyElements) ? parsed.keyElements : [];
    parsed.emojis = Array.isArray(parsed.emojis) ? parsed.emojis : [];
    parsed.textStyleDetail = parsed.textStyleDetail || "";
    parsed.emotionalHook = parsed.emotionalHook || "";
    parsed.collageStructure = parsed.collageStructure || "单图";
    parsed.mimicAdvice = parsed.mimicAdvice || { mustKeep: [], canChange: [], avoid: [] };
    parsed.mimicAdvice.mustKeep = Array.isArray(parsed.mimicAdvice.mustKeep) ? parsed.mimicAdvice.mustKeep : [];
    parsed.mimicAdvice.canChange = Array.isArray(parsed.mimicAdvice.canChange) ? parsed.mimicAdvice.canChange : [];
    parsed.mimicAdvice.avoid = Array.isArray(parsed.mimicAdvice.avoid) ? parsed.mimicAdvice.avoid : [];
    return parsed;
  } catch (err) {
    (log || logger).warn({ err, content: content.slice(0, 200) }, "Failed to parse vision analysis JSON");
    throw new Error("Vision analysis returned invalid JSON");
  }
}

export interface UserStyleProfile {
  dominantColors: string[];
  preferredLayouts: string[];
  preferredFonts: string[];
  preferredEmojis: string[];
  preferredMoods: string[];
  sampleSize: number;
}

export interface PromptGenerationInput {
  analysis: CompetitorImageAnalysis;
  newTopic: string;
  newTitle?: string;
  newKeyPoints?: string[];
  mimicStrength: "full" | "partial" | "minimal";
  customTextOverlays?: Array<{ text: string; position: string }>;
  styleProfile?: UserStyleProfile | null;
  extraInstructions?: string;
  // 品牌画像 prompt 片段（已带 [品牌画像 — 必须严格遵守] 头）。由 brandContext.loadBrandContext() 生成。
  brandBlock?: string;
}

export interface GeneratedImagePrompt {
  imagePrompt: string;
  textToOverlay: Array<{
    text: string;
    position: "top" | "center" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
    style: string;
  }>;
  emojisToInclude: string[];
  recommendedSize: "1024x1024" | "1024x1536" | "1536x1024";
}

const PROMPT_GEN_SYSTEM = `你是小红书爆款封面图prompt生成专家。基于同行爆款的深度视觉分析+用户新主题+用户历史风格档案，生成图像生成prompt。

要求：
1. 模仿强度: full=完全复刻布局/配色/风格 | partial=借鉴风格内容自由 | minimal=只参考氛围
2. **必须保留 mimicAdvice.mustKeep 列出的爆款基因**
3. **避免 mimicAdvice.avoid 列出的坑**
4. 如果有 styleProfile：**imagePrompt 中必须原样保留偏爱色调的 #HEX 颜色代码**（例如 "dominant colors: #FF3B5C, #FFD700"），并把偏爱情绪/布局融入描述。客户的 emoji 偏好通过 emojisToInclude 字段输出，不必塞进 imagePrompt 文字。
5. **如果有【用户额外指令】，必须在 imagePrompt 中字面体现该指令的关键词**（例如"金色光晕"必须出现"gold glow / 金色光晕"等近义表达），不能忽略
6. prompt 中英混合，详细具体（构图、色调、光线、材质、镜头感）
7. **不要让 AI 画文字** —— 文字单独叠加，prompt 里写 "no text, no words, no logo, no letters"
8. emojisToInclude 输出建议在画面上点缀的 emoji（如有 styleProfile.preferredEmojis 优先采用，再补充适合新主题的）
9. 推荐尺寸: 小红书封面优选 1024x1536 (3:4竖版)

输出严格 JSON:
{
  "imagePrompt": "150-300字详细prompt，中英混合",
  "textToOverlay": [
    {"text":"要叠加的文字","position":"top|center|bottom|top-left|top-right|bottom-left|bottom-right","style":"字体描述"}
  ],
  "emojisToInclude": ["✨","🔥"],
  "recommendedSize": "1024x1536"
}`;

/**
 * 把 imagePrompt + 文字方案 + emoji 合并成适合 Seedream 的中文 prompt。
 * Seedream 5.0+ 对中文文字渲染极强，可在 prompt 里指定要画的文字+位置+样式+emoji。
 */
// 各平台封面/首图最佳画幅 + 视觉风格收尾语
export const PLATFORM_VISUAL_PRESET: Record<string, { size: "1024x1024" | "1024x1536" | "1536x1024"; suffix: string }> = {
  xhs: {
    size: "1024x1536",
    suffix: "小红书风格爆款封面，3:4 竖版，画面有视觉冲击力，色彩饱和明亮，构图饱满。",
  },
  tiktok: {
    size: "1024x1536",
    suffix: "TikTok 短视频封面，9:16 竖版，hook 强烈、人物大头/动作居中、字幕大且高对比，深色或撞色背景，年轻潮酷氛围。",
  },
  instagram: {
    size: "1024x1024",
    suffix: "Instagram Feed 风格封面，1:1 方版，构图精致干净，留白考究，柔和高级感配色，editorial / lifestyle 调性。",
  },
  facebook: {
    size: "1536x1024",
    suffix: "Facebook 帖子封面，16:9 横版，主体居中清晰，可读性高，类似新闻 / 故事图配图风格，鼓励停留点击。",
  },
};

export function buildSeedreamPrompt(
  imagePrompt: string,
  textOverlays: GeneratedImagePrompt["textToOverlay"],
  layout: "single" | "dual-vertical" | "dual-horizontal" | "grid-2x2" = "single",
  emojis: string[] = [],
  platform: string = "xhs",
): string {
  const layoutHint =
    layout === "dual-vertical"
      ? "画面采用上下两格拼图构图，上下各占一半，中间留细白边分隔。"
      : layout === "dual-horizontal"
        ? "画面采用左右两格拼图构图，左右各占一半，中间留细白边分隔。"
        : layout === "grid-2x2"
          ? "画面采用四格拼图构图（2×2 网格），四个画面比例相等，之间留白边分隔。"
          : "";

  const textInstr = textOverlays.length > 0
    ? "在画面中以小红书爆款封面字体（粗黑大字、白底带红/黑描边、可加色块底）渲染以下中文文字，精准排版：" +
      textOverlays.map((t) => {
        const posCN = ({
          top: "顶部居中",
          center: "正中央",
          bottom: "底部居中",
          "top-left": "左上角",
          "top-right": "右上角",
          "bottom-left": "左下角",
          "bottom-right": "右下角",
        } as const)[t.position] || "顶部居中";
        return `「${t.text}」(位置：${posCN}，样式：${t.style})`;
      }).join("；")
    : "画面无文字。";

  const emojiInstr = emojis.length > 0
    ? `在画面合适位置点缀以下 emoji 表情符号：${emojis.join(" ")}（位置不要遮挡主体和文字，作为视觉装饰）。`
    : "";

  const preset = PLATFORM_VISUAL_PRESET[platform] || PLATFORM_VISUAL_PRESET.xhs;

  return [
    imagePrompt.replace(/no text|no words|no logo|no letters/gi, "").trim(),
    layoutHint,
    textInstr,
    emojiInstr,
    preset.suffix,
  ].filter(Boolean).join("\n");
}

export async function generateImagePrompt(input: PromptGenerationInput): Promise<GeneratedImagePrompt> {
  const adviceText = `
【模仿建议-必须保留】 ${input.analysis.mimicAdvice.mustKeep.join("、") || "无"}
【模仿建议-可以换】 ${input.analysis.mimicAdvice.canChange.join("、") || "无"}
【模仿建议-避坑】 ${input.analysis.mimicAdvice.avoid.join("、") || "无"}`;

  const styleProfileText = input.styleProfile && input.styleProfile.sampleSize > 0
    ? `\n【该客户历史风格档案】(基于 ${input.styleProfile.sampleSize} 张采用过的图)
偏爱色调: ${input.styleProfile.dominantColors.join(", ") || "无"}
偏爱布局: ${input.styleProfile.preferredLayouts.join(", ") || "无"}
偏爱字体: ${input.styleProfile.preferredFonts.join(", ") || "无"}
偏爱 emoji: ${input.styleProfile.preferredEmojis.join(" ") || "无"}
偏爱情绪: ${input.styleProfile.preferredMoods.join(", ") || "无"}
请在 prompt 中适度融入这些偏好（不要喧宾夺主）。`
    : "";

  const userMsg = `【同行爆款视觉分析】
布局: ${input.analysis.layoutType}
拼图结构: ${input.analysis.collageStructure}
主色调: ${input.analysis.mainColors.join(", ")}
视觉风格: ${input.analysis.visualStyle}
氛围: ${input.analysis.mood}
情绪钩子(为什么爆): ${input.analysis.emotionalHook}
主体: ${input.analysis.subject}
构图: ${input.analysis.composition}
关键元素: ${input.analysis.keyElements.join(", ")}
原图文字: ${input.analysis.textOverlays.map((t) => `[${t.position}] "${t.text}" (${t.style})`).join("; ") || "无"}
字幕设计风格细节: ${input.analysis.textStyleDetail}
原图 emoji: ${input.analysis.emojis.join(" ") || "无"}
${adviceText}

【新内容】
主题: ${input.newTopic}
${input.newTitle ? `标题: ${input.newTitle}` : ""}
${input.newKeyPoints?.length ? `卖点: ${input.newKeyPoints.join("、")}` : ""}

【模仿强度】 ${input.mimicStrength}
${input.customTextOverlays?.length ? `\n【用户指定要叠加的文字】\n${input.customTextOverlays.map((t) => `[${t.position}] "${t.text}"`).join("\n")}` : ""}
${styleProfileText}
${input.extraInstructions ? `\n【用户额外指令】\n${input.extraInstructions}` : ""}
${input.brandBlock ?? ""}

请生成图像 prompt + 文字叠加方案 + emoji 建议。注意:文字叠加内容(textToOverlay) 与 emoji 必须符合"品牌画像"的调性,且【禁用宣称】绝不能出现在 textToOverlay 任何字段。`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 1800,
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: PROMPT_GEN_SYSTEM },
      { role: "user", content: userMsg },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Prompt generation returned empty response");

  const parsed = JSON.parse(content) as GeneratedImagePrompt;
  parsed.textToOverlay = Array.isArray(parsed.textToOverlay) ? parsed.textToOverlay : [];
  parsed.emojisToInclude = Array.isArray(parsed.emojisToInclude) ? parsed.emojisToInclude : [];
  parsed.recommendedSize = parsed.recommendedSize || "1024x1536";
  return parsed;
}
