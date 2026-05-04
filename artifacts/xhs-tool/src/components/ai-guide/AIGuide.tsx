import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import {
  MessageCircle, X, Send, Loader2, Sparkles,
  Lightbulb, Minimize2, Zap
} from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const QUICK_PROMPTS: Record<string, { label: string; prompt: string }[]> = {
  "/dashboard": [
    { label: "如何提高笔记曝光？", prompt: "作为小红书运营专家，我是新手，如何提高笔记曝光量？请给出3-5条实用建议。" },
    { label: "今日发布最佳时段？", prompt: "小红书发布笔记的最佳时段是什么时候？不同品类有区别吗？" },
    { label: "新手如何快速起号？", prompt: "小红书新号如何快速起号？给我一个30天的运营计划。" },
  ],
  "/workflow": [
    { label: "帮我优化当前标题", prompt: "我正在创作笔记，请帮我分析小红书爆款标题的写作技巧，给出5个标题模板和注意事项。" },
    { label: "配图策略建议", prompt: "小红书笔记配图有什么要求和技巧？封面图、内页图分别怎么做？尺寸、数量、风格等方面请详细说明。" },
    { label: "标签选择策略", prompt: "如何选择小红书笔记标签？大词和长尾词怎么搭配？给出实操建议。" },
    { label: "如何写出高互动正文？", prompt: "小红书笔记正文怎么写互动率高？有什么结构模板和技巧？" },
    { label: "我的业务适合发什么？", prompt: "请问不同类型的业务在小红书上应该发什么类型的内容？比如实体店、电商、咨询服务、个人IP等，分别给出建议。" },
  ],
  "/content": [
    { label: "什么内容容易上热门？", prompt: "最近小红书上什么类型的内容容易上热门？请分析最新趋势。" },
    { label: "如何避免限流？", prompt: "小红书有哪些行为可能导致限流？如何避免？给出具体的检查清单。" },
    { label: "内容矩阵怎么做？", prompt: "如何建立小红书内容矩阵？爆款内容、引流内容、转化内容该怎么分配？" },
  ],
  "/accounts": [
    { label: "多账号运营策略", prompt: "小红书多账号运营有什么注意事项？如何避免关联处罚？" },
    { label: "不同地区运营差异", prompt: "新加坡、香港、马来西亚的小红书用户有什么不同的偏好和习惯？内容策略该如何调整？" },
  ],
  default: [
    { label: "小红书运营攻略", prompt: "作为小红书新手运营，最重要的3件事是什么？" },
    { label: "如何提升账号权重？", prompt: "小红书账号权重是怎么算的？如何提升？" },
    { label: "小红书算法解析", prompt: "小红书的推荐算法是怎么工作的？如何利用算法获得更多曝光？" },
  ],
};

const STEP_TIPS: Record<string, { tip: string; icon: string }> = {
  "step-1": { tip: "选择活跃的账号发布效果更好哦！如果是新账号，建议先养号几天再发布内容。", icon: "👤" },
  "step-2": { tip: "告诉我你的业务和竞品，AI帮你分析同行已验证的爆款文案、配图和时间点！", icon: "🔍" },
  "step-3": { tip: "标题是决定点击率的关键！正文前3行决定用户是否继续看。需要我帮你优化吗？", icon: "✍️" },
  "step-4": { tip: "发布前检查敏感词很重要，可以避免被限流。同时确认配图清晰、标签精准。", icon: "👁️" },
  "step-5": { tip: "发布后的2小时是黄金期！这段时间可以积极回复评论，有助于提升推荐权重。", icon: "🚀" },
};

export default function AIGuide() {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showStepTip, setShowStepTip] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [location] = useLocation();
  const prevLocationRef = useRef(location);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (prevLocationRef.current !== location) {
      setShowStepTip(true);
      prevLocationRef.current = location;
    }
  }, [location]);

  function getQuickPrompts() {
    const matchedKey = Object.keys(QUICK_PROMPTS).find((k) => k !== "default" && location.startsWith(k));
    return QUICK_PROMPTS[matchedKey || "default"] || QUICK_PROMPTS["default"];
  }

  function getStepTip(): { tip: string; icon: string } | null {
    if (!location.startsWith("/workflow")) return null;
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    for (const [key, value] of Object.entries(STEP_TIPS)) {
      if (hash.includes(key)) return value;
    }
    return STEP_TIPS["step-2"];
  }

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;

    const userMessage: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);
    setShowStepTip(false);

    try {
      const contextMessages = messages.slice(-6).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      contextMessages.push({ role: "user", content: text });

      const guideBody: any = {
        messages: contextMessages,
        currentPage: location,
      };
      if (location.startsWith("/workflow")) {
        const stepMatch = document.querySelector('[data-workflow-step]');
        if (stepMatch) {
          guideBody.workflowStep = parseInt(stepMatch.getAttribute('data-workflow-step') || '0', 10);
        }
        const regionBadge = document.querySelector('[data-account-region]');
        if (regionBadge) {
          guideBody.accountRegion = regionBadge.getAttribute('data-account-region');
        }
      }
      const res = await fetch("/api/ai/guide", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(guideBody),
      });

      if (!res.ok) throw new Error("请求失败");
      const data = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.response }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "抱歉，暂时无法回复。请稍后再试。" },
      ]);
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
        {showStepTip && location.startsWith("/workflow") && (
          <div className="max-w-[280px] bg-white rounded-2xl shadow-lg border p-3 animate-in slide-in-from-bottom-2 relative">
            <button onClick={() => setShowStepTip(false)} className="absolute top-1 right-1 p-0.5 hover:bg-muted rounded">
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
            <div className="flex items-start gap-2">
              <Zap className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-gray-700">AI向导提示</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">有任何问题随时问我！我能帮你分析同行爆款、优化标题、选择标签等。</p>
              </div>
            </div>
          </div>
        )}
        <button
          onClick={() => setOpen(true)}
          className="w-14 h-14 rounded-full bg-gradient-to-br from-red-500 to-pink-500 text-white shadow-lg hover:shadow-xl transition-all hover:scale-105 flex items-center justify-center group"
        >
          <MessageCircle className="h-6 w-6" />
          <span className="absolute -top-2 -right-1 w-5 h-5 rounded-full bg-yellow-400 text-[10px] font-bold flex items-center justify-center text-yellow-900 animate-bounce">
            AI
          </span>
        </button>
      </div>
    );
  }

  if (minimized) {
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <button
          onClick={() => setMinimized(false)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-gradient-to-r from-red-500 to-pink-500 text-white shadow-lg hover:shadow-xl transition-all"
        >
          <Sparkles className="h-4 w-4" />
          <span className="text-sm font-medium">AI向导</span>
          {messages.length > 0 && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1 bg-white/20 text-white">
              {messages.length}
            </Badge>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-96 max-h-[600px] bg-white rounded-2xl shadow-2xl border flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-red-500 to-pink-500 text-white">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          <div>
            <p className="font-medium text-sm">鹿联AI爆款助手</p>
            <p className="text-[10px] text-white/70">随时为您提供运营建议</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setMinimized(true)} className="p-1 hover:bg-white/20 rounded">
            <Minimize2 className="h-4 w-4" />
          </button>
          <button onClick={() => setOpen(false)} className="p-1 hover:bg-white/20 rounded">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-3 min-h-[300px] max-h-[400px]">
        {messages.length === 0 && (
          <div className="space-y-4">
            <div className="text-center py-3">
              <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-3">
                <Lightbulb className="h-6 w-6 text-red-400" />
              </div>
              <p className="text-sm font-medium text-gray-700">您好！我是鹿联AI爆款助手</p>
              <p className="text-xs text-muted-foreground mt-1">
                我能帮你分析同行爆款、优化内容、制定运营策略。有任何问题，随时问我！
              </p>
            </div>

            {location.startsWith("/workflow") && (
              <div className="p-3 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-100">
                <div className="flex items-start gap-2">
                  <Zap className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                  <div className="text-xs">
                    <p className="font-medium text-amber-800">创作小贴士</p>
                    <p className="text-amber-700 mt-0.5">在"分析爆款"步骤输入你的业务信息，AI帮你复制同行验证的爆款模式！</p>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground font-medium px-1">快捷提问：</p>
              {getQuickPrompts().map((q, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(q.prompt)}
                  className="w-full text-left text-sm px-3 py-2 rounded-lg border hover:bg-red-50 hover:border-red-200 transition-colors"
                >
                  <span className="text-red-500 mr-1.5">💡</span>
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
              msg.role === "user"
                ? "bg-red-500 text-white rounded-br-md"
                : "bg-gray-100 text-gray-800 rounded-bl-md"
            }`}>
              <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>AI正在思考...</span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {messages.length > 0 && (
        <div className="px-4 pb-1">
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
            {getQuickPrompts().slice(0, 3).map((q, i) => (
              <button
                key={i}
                onClick={() => sendMessage(q.prompt)}
                className="text-[11px] px-2.5 py-1 rounded-full border whitespace-nowrap hover:bg-red-50 hover:border-red-200 transition-colors text-muted-foreground"
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="p-3 border-t bg-gray-50">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入您的问题..."
            rows={1}
            className="resize-none text-sm min-h-[36px] max-h-[80px] bg-white"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
          />
          <Button
            size="icon"
            disabled={!input.trim() || loading}
            onClick={() => sendMessage(input)}
            className="shrink-0 bg-red-500 hover:bg-red-600 h-9 w-9"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
