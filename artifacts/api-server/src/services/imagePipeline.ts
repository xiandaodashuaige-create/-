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
}

const ANALYSIS_PROMPT = `你是顶级小红书视觉设计专家。请分析这张爆款封面图片，输出严格的JSON格式分析报告。

要求分析以下维度，每个字段必填：

{
  "layoutType": "用一句话描述布局结构，例如：'上图下文 70/30' 或 '全屏文字+底图模糊' 或 '左图右文'",
  "mainColors": ["#HEX颜色1", "#HEX颜色2", "#HEX颜色3"],
  "visualStyle": "整体视觉风格，例如：'明亮生活感、留白多、ins简约风' 或 '暗调高级感、大字冲击'",
  "mood": "情绪氛围，例如：'种草欲望强、紧迫感' 或 '治愈温暖、适合女性'",
  "subject": "画面主体，例如：'美食特写' 或 '人物正脸大头照' 或 '产品平铺'",
  "textOverlays": [
    {
      "text": "图上实际看到的文字内容（中文原文）",
      "position": "top|center|bottom|top-left|top-right|bottom-left|bottom-right",
      "style": "字体描述，例如：'粗黑大字 白底红字带描边'"
    }
  ],
  "composition": "构图技法，例如：'中心对称、视觉焦点在中间' 或 '三分法、左侧主体右侧留白'",
  "keyElements": ["关键视觉元素1", "关键视觉元素2", "..."]
}

只输出JSON，不要任何解释。如果图上没有文字，textOverlays返回空数组[]。`;

export async function analyzeCompetitorImage(imageUrl: string, log?: any): Promise<CompetitorImageAnalysis> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 1500,
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
    return parsed;
  } catch (err) {
    (log || logger).warn({ err, content: content.slice(0, 200) }, "Failed to parse vision analysis JSON");
    throw new Error("Vision analysis returned invalid JSON");
  }
}

export interface PromptGenerationInput {
  analysis: CompetitorImageAnalysis;
  newTopic: string;
  newTitle?: string;
  newKeyPoints?: string[];
  mimicStrength: "full" | "partial" | "minimal";
  customTextOverlays?: Array<{ text: string; position: string }>;
}

export interface GeneratedImagePrompt {
  imagePrompt: string;
  textToOverlay: Array<{
    text: string;
    position: "top" | "center" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
    style: string;
  }>;
  recommendedSize: "1024x1024" | "1024x1536" | "1536x1024";
}

const PROMPT_GEN_SYSTEM = `你是小红书爆款封面图prompt生成专家。基于同行爆款的视觉分析报告和用户的新主题，生成一段详细的图像生成prompt。

要求：
1. 模仿强度按用户指定: full=完全复刻布局/配色/风格, partial=借鉴风格但内容自由, minimal=只参考氛围
2. prompt用中英混合，描述要具体（构图、色调、光线、材质、镜头感）
3. **不要让AI画文字** —— 文字会单独叠加，prompt里明确说 "no text, no words, no logo"
4. 推荐尺寸: 小红书封面优选 1024x1536 (3:4竖版)
5. 输出严格JSON格式

输出格式:
{
  "imagePrompt": "详细的图像prompt，中英混合，约150-300字",
  "textToOverlay": [
    {"text": "要叠加的文字", "position": "top|center|bottom|...", "style": "字体描述"}
  ],
  "recommendedSize": "1024x1536"
}`;

export async function generateImagePrompt(input: PromptGenerationInput): Promise<GeneratedImagePrompt> {
  const userMsg = `【同行爆款视觉分析】
布局: ${input.analysis.layoutType}
主色调: ${input.analysis.mainColors.join(", ")}
视觉风格: ${input.analysis.visualStyle}
氛围: ${input.analysis.mood}
主体: ${input.analysis.subject}
构图: ${input.analysis.composition}
关键元素: ${input.analysis.keyElements.join(", ")}
原图文字: ${input.analysis.textOverlays.map((t) => `[${t.position}] "${t.text}" (${t.style})`).join("; ") || "无"}

【新内容】
主题: ${input.newTopic}
${input.newTitle ? `标题: ${input.newTitle}` : ""}
${input.newKeyPoints?.length ? `卖点: ${input.newKeyPoints.join("、")}` : ""}

【模仿强度】 ${input.mimicStrength}
${input.customTextOverlays?.length ? `\n【用户指定要叠加的文字】\n${input.customTextOverlays.map((t) => `[${t.position}] "${t.text}"`).join("\n")}` : ""}

请生成图像prompt和文字叠加方案。`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 1500,
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
  parsed.recommendedSize = parsed.recommendedSize || "1024x1536";
  return parsed;
}
