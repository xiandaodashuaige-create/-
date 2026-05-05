import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Send, Sparkles, Loader2, ThumbsUp, ThumbsDown, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

export type AssistantLayout = "single" | "dual-vertical" | "dual-horizontal" | "grid-2x2" | "left-big-right-small";
export type AssistantMimicStrength = "full" | "partial" | "minimal";

export interface AssistantChatProps {
  context: {
    referenceImageUrl?: string | null;
    generatedImageUrl?: string | null;
    topic?: string | null;
    title?: string | null;
    layout: AssistantLayout;
    mimicStrength: AssistantMimicStrength;
    textOverlays: Array<{ text: string; position: string; style?: string }>;
    emojis: string[];
    imagePromptUsed?: string | null;
    referenceId?: number | null;
  };
  isBusy: boolean;
  onApplyChanges: (changes: {
    layout?: AssistantLayout;
    mimicStrength?: AssistantMimicStrength;
    textOverlays?: Array<{ text: string; position: string; style?: string }>;
    emojis?: string[];
    extraInstructions?: string;
    triggerRegenerate: boolean;
  }) => void;
  onFeedback?: (accepted: boolean) => void;
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  actionsApplied?: string[];
}

export function AssistantChat({ context, isBusy, onApplyChanges, onFeedback }: AssistantChatProps) {
  const { toast } = useToast();
  const [history, setHistory] = useState<ChatMsg[]>([
    {
      role: "assistant",
      content: context.generatedImageUrl
        ? "封面已生成 ✨ 想改什么尽管告诉我——比如「换四格布局」「标题改成XXX」「色彩再鲜艳点」「加几个 emoji」，我直接帮你改。"
        : "你好！上传同行爆款图后，告诉我想要的主题，我会帮你复刻一张爆款封面。生成后还能继续对我说话调整。",
    },
  ]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [history]);

  const chatMutation = useMutation({
    mutationFn: (msg: string) =>
      api.ai.assistantChat({
        message: msg,
        history: history.map((m) => ({ role: m.role, content: m.content })),
        context: {
          referenceImageUrl: context.referenceImageUrl,
          generatedImageUrl: context.generatedImageUrl,
          topic: context.topic,
          title: context.title,
          layout: context.layout,
          mimicStrength: context.mimicStrength,
          textOverlays: context.textOverlays,
          emojis: context.emojis,
          imagePromptUsed: context.imagePromptUsed,
        },
      }),
    onSuccess: (reply, sentMsg) => {
      const applied: string[] = [];
      const changes: Parameters<typeof onApplyChanges>[0] = { triggerRegenerate: false };
      let extraInstr = "";

      for (const a of reply.actions || []) {
        switch (a.type) {
          case "regenerate":
            changes.triggerRegenerate = true;
            applied.push("重新生成");
            break;
          case "change_layout":
            if (a.newLayout) {
              changes.layout = a.newLayout as AssistantLayout;
              applied.push(`布局→${a.newLayout}`);
            }
            break;
          case "change_mimic_strength":
            if (a.newStrength) {
              changes.mimicStrength = a.newStrength as AssistantMimicStrength;
              applied.push(`复刻强度→${a.newStrength}`);
            }
            break;
          case "edit_texts":
            if (Array.isArray(a.newOverlays)) {
              changes.textOverlays = a.newOverlays;
              applied.push(`改文字(${a.newOverlays.length}条)`);
            }
            break;
          case "set_emojis":
            if (Array.isArray(a.newEmojis)) {
              changes.emojis = a.newEmojis;
              applied.push(`emoji→${a.newEmojis.join("")}`);
            }
            break;
          case "extra_instructions":
            if (a.instructions) {
              extraInstr += (extraInstr ? "；" : "") + a.instructions;
              applied.push("追加指令");
            }
            break;
        }
      }
      if (extraInstr) changes.extraInstructions = extraInstr;

      setHistory((prev) => [
        ...prev,
        { role: "user", content: sentMsg },
        { role: "assistant", content: reply.message, actionsApplied: applied },
      ]);

      const hasChanges = changes.layout || changes.mimicStrength || changes.textOverlays || changes.emojis || changes.extraInstructions;
      if (hasChanges || changes.triggerRegenerate) {
        onApplyChanges(changes);
      }
    },
    onError: (err: any) => {
      toast({ title: "AI 助手出错", description: err?.message || "请重试", variant: "destructive" });
    },
  });

  function handleSend() {
    const msg = input.trim();
    if (!msg || chatMutation.isPending || isBusy) return;
    setInput("");
    chatMutation.mutate(msg);
  }

  function handleQuickAction(text: string) {
    if (chatMutation.isPending || isBusy) return;
    setInput("");
    chatMutation.mutate(text);
  }

  return (
    <Card className="border-purple-200 bg-gradient-to-br from-purple-50/40 to-pink-50/40">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="bg-gradient-to-br from-purple-500 to-pink-500 rounded-full p-1.5">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold">AI 封面助手</p>
            <p className="text-[10px] text-gray-500">直接告诉我你想改什么，我帮你执行</p>
          </div>
        </div>

        <div ref={scrollRef} className="max-h-72 overflow-y-auto space-y-2 bg-white/60 rounded-lg p-3 border">
          {history.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                m.role === "user" ? "bg-red-500 text-white" : "bg-white border text-gray-800"
              }`}>
                <p className="whitespace-pre-wrap">{m.content}</p>
                {m.actionsApplied && m.actionsApplied.length > 0 && (
                  <div className="mt-1.5 pt-1.5 border-t border-gray-200 flex flex-wrap gap-1">
                    {m.actionsApplied.map((a, j) => (
                      <span key={j} className="text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                        ✓ {a}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {chatMutation.isPending && (
            <div className="flex justify-start">
              <div className="bg-white border rounded-2xl px-3 py-2 text-xs flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" /> AI 思考中...
              </div>
            </div>
          )}
        </div>

        {context.generatedImageUrl && (
          <div className="flex flex-wrap gap-1.5">
            {[
              "换成四格拼图",
              "再生成一张",
              "色彩更鲜艳",
              "标题字大一点",
              "加点 emoji",
              "复刻强度调高",
            ].map((q) => (
              <button
                key={q}
                onClick={() => handleQuickAction(q)}
                disabled={chatMutation.isPending || isBusy}
                className="text-[10px] bg-white border border-purple-200 text-purple-700 hover:bg-purple-50 px-2 py-1 rounded-full disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="告诉我想怎么改这张图..."
            className="text-sm h-9"
            disabled={chatMutation.isPending || isBusy}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || chatMutation.isPending || isBusy}
            size="sm"
            className="bg-purple-500 hover:bg-purple-600 h-9"
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>

        {context.generatedImageUrl && context.referenceId != null && onFeedback && (
          <div className="flex items-center gap-2 pt-2 border-t border-purple-200">
            <span className="text-[11px] text-gray-600">这张图怎么样？</span>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onFeedback(true)}>
              <ThumbsUp className="h-3 w-3 mr-1 text-green-500" /> 采用（系统会学习风格）
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onFeedback(false)}>
              <ThumbsDown className="h-3 w-3 mr-1 text-gray-400" /> 不喜欢
            </Button>
          </div>
        )}

        {isBusy && (
          <div className="flex items-center gap-2 text-[11px] text-purple-600 bg-purple-50 rounded p-2">
            <RefreshCw className="h-3 w-3 animate-spin" />
            正在按你的要求重新生成...
          </div>
        )}
      </CardContent>
    </Card>
  );
}
