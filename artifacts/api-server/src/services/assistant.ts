import { openai } from "@workspace/integrations-openai-ai-server";

export interface AssistantChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AssistantImageContext {
  referenceImageUrl?: string | null;
  generatedImageUrl?: string | null;
  topic?: string | null;
  title?: string | null;
  layout: "single" | "dual-vertical" | "dual-horizontal" | "grid-2x2" | "left-big-right-small";
  mimicStrength: "full" | "partial" | "minimal";
  textOverlays: Array<{ text: string; position: string; style?: string }>;
  emojis: string[];
  imagePromptUsed?: string | null;
}

export type AssistantAction =
  | { type: "regenerate"; reason: string }
  | { type: "change_layout"; newLayout: AssistantImageContext["layout"]; reason: string }
  | { type: "change_mimic_strength"; newStrength: AssistantImageContext["mimicStrength"]; reason: string }
  | { type: "edit_texts"; newOverlays: Array<{ text: string; position: string; style?: string }>; reason: string }
  | { type: "set_emojis"; newEmojis: string[]; reason: string }
  | { type: "extra_instructions"; instructions: string; reason: string }
  | { type: "no_action"; reason: string };

export interface AssistantReply {
  message: string;
  actions: AssistantAction[];
}

const SYSTEM_PROMPT = `你是「鹿联小红书爆款封面 AI 助手」，专门帮客户调整刚生成的封面图。
你不是只给建议，你能直接执行修改 —— 客户说什么你就调用对应的工具去做。

工作风格：
- 用温暖、专业、口语化的中文回复（短，2-4 句）
- 客户提需求 → 你立刻调用相应工具去执行 → 然后用一句话告诉客户你做了什么
- 不要让客户去自己点按钮，能你做的你都做掉
- 客户说"再来一张/重做/不喜欢"→ 调用 regenerate
- 客户说"换四格/换上下/换左右/单图"→ 调用 change_layout
- 客户说"再像一点/再原创一点/参考少一点"→ 调用 change_mimic_strength
- 客户改文字内容/位置 → 调用 edit_texts
- 客户加 emoji / 去 emoji → 调用 set_emojis
- 客户提风格/色彩/具体细节修改 → 调用 extra_instructions（把指令文字化传下去），通常配合 regenerate
- 客户只是闲聊或问问题 → no_action，正常回复

可用的工具（按需调用，可以一次调多个）：
- regenerate: 重新生成图片（用当前所有设置）
- change_layout: 切换布局，newLayout ∈ {single, dual-vertical, dual-horizontal, grid-2x2, left-big-right-small}
- change_mimic_strength: 改复刻强度，newStrength ∈ {full, partial, minimal}
- edit_texts: 改图上文字方案，传完整的新 overlays 数组
- set_emojis: 改 emoji 列表
- extra_instructions: 给下一次生成附加额外文字指令（如"色彩更鲜艳"、"主体更大"、"加金色光晕"）

通常修改类的工具调用后要紧跟一个 regenerate，否则改动不会出新图。`;

export async function chatWithAssistant(
  history: AssistantChatMessage[],
  userMessage: string,
  context: AssistantImageContext,
): Promise<AssistantReply> {
  const contextSummary = `【当前图片状态】
主题: ${context.topic || "未填"}
标题: ${context.title || "未填"}
布局: ${context.layout}
复刻强度: ${context.mimicStrength}
当前文字方案: ${context.textOverlays.length > 0 ? context.textOverlays.map((t) => `[${t.position}] "${t.text}" (${t.style || ""})`).join("; ") : "无"}
当前 emoji: ${context.emojis.join(" ") || "无"}
是否有同行参考图: ${context.referenceImageUrl ? "是" : "否"}
是否已生成图: ${context.generatedImageUrl ? "是" : "否"}
${context.imagePromptUsed ? `\n上次生成用的 prompt 摘要: ${context.imagePromptUsed.slice(0, 200)}` : ""}`;

  const tools = [
    {
      type: "function" as const,
      function: {
        name: "execute_actions",
        description: "执行一组对当前封面图的修改动作（按顺序执行）",
        parameters: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "用一句温暖、口语化的中文告诉客户你做了什么（2-4 句话）",
            },
            actions: {
              type: "array",
              description: "要执行的动作序列。如果客户只是闲聊，返回 [{type:'no_action', reason:'...'}]",
              items: {
                type: "object",
                properties: {
                  type: {
                    type: "string",
                    enum: [
                      "regenerate",
                      "change_layout",
                      "change_mimic_strength",
                      "edit_texts",
                      "set_emojis",
                      "extra_instructions",
                      "no_action",
                    ],
                  },
                  reason: { type: "string" },
                  newLayout: {
                    type: "string",
                    enum: ["single", "dual-vertical", "dual-horizontal", "grid-2x2", "left-big-right-small"],
                  },
                  newStrength: { type: "string", enum: ["full", "partial", "minimal"] },
                  newOverlays: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        text: { type: "string" },
                        position: { type: "string" },
                        style: { type: "string" },
                      },
                      required: ["text", "position"],
                    },
                  },
                  newEmojis: { type: "array", items: { type: "string" } },
                  instructions: { type: "string" },
                },
                required: ["type", "reason"],
              },
            },
          },
          required: ["message", "actions"],
        },
      },
    },
  ];

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "system" as const, content: contextSummary },
    ...history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: userMessage },
  ];

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 1500,
    temperature: 0.5,
    tools,
    tool_choice: { type: "function", function: { name: "execute_actions" } },
    messages,
  });

  const choice = response.choices[0]?.message;
  const toolCall = choice?.tool_calls?.[0];
  if (toolCall && toolCall.function?.arguments) {
    try {
      const parsed = JSON.parse(toolCall.function.arguments);
      const actions: AssistantAction[] = Array.isArray(parsed.actions)
        ? parsed.actions.filter((a: any) => a && typeof a.type === "string")
        : [{ type: "no_action", reason: "未识别动作" }];
      return {
        message: typeof parsed.message === "string" ? parsed.message : "好的，我已经处理啦～",
        actions,
      };
    } catch {
      // fall through
    }
  }
  return {
    message: choice?.content || "抱歉我没听明白，可以再说一次吗？",
    actions: [{ type: "no_action", reason: "no tool call" }],
  };
}
