import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import {
  MessageCircle, X, Send, Loader2, Sparkles, ChevronDown,
  Lightbulb, Minimize2
} from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const QUICK_PROMPTS: Record<string, { label: string; prompt: string }[]> = {
  "/dashboard": [
    { label: "如何提高笔记曝光？", prompt: "作为小红书运营专家，我是新手，如何提高笔记曝光量？请给出3-5条实用建议。" },
    { label: "今日发布最佳时段？", prompt: "小红书发布笔记的最佳时段是什么时候？不同品类有区别吗？" },
  ],
  "/workflow": [
    { label: "如何写爆款标题？", prompt: "帮我总结小红书爆款标题的写作技巧，并给出几个模板。" },
    { label: "配图有什么要求？", prompt: "小红书笔记配图有什么要求和技巧？尺寸、数量、风格等方面请详细说明。" },
    { label: "标签怎么选更好？", prompt: "如何选择小红书笔记标签？有什么策略可以提升流量？" },
  ],
  "/content": [
    { label: "什么内容容易上热门？", prompt: "最近小红书上什么类型的内容容易上热门？请分析最新趋势。" },
    { label: "如何避免限流？", prompt: "小红书有哪些行为可能导致限流？如何避免？" },
  ],
  default: [
    { label: "小红书运营攻略", prompt: "作为小红书新手运营，最重要的3件事是什么？" },
    { label: "如何提升账号权重？", prompt: "小红书账号权重是怎么算的？如何提升？" },
  ],
};

export default function AIGuide() {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [location] = useLocation();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function getQuickPrompts() {
    const matchedKey = Object.keys(QUICK_PROMPTS).find((k) => k !== "default" && location.startsWith(k));
    return QUICK_PROMPTS[matchedKey || "default"] || QUICK_PROMPTS["default"];
  }

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;

    const userMessage: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const contextMessages = messages.slice(-6).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      contextMessages.push({ role: "user", content: text });

      const res = await fetch("/api/ai/guide", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: contextMessages,
          currentPage: location,
        }),
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
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-red-500 to-pink-500 text-white shadow-lg hover:shadow-xl transition-all hover:scale-105 flex items-center justify-center group"
      >
        <MessageCircle className="h-6 w-6" />
        <span className="absolute -top-2 -right-1 w-5 h-5 rounded-full bg-yellow-400 text-[10px] font-bold flex items-center justify-center text-yellow-900 animate-bounce">
          AI
        </span>
      </button>
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
            <p className="font-medium text-sm">小红书AI运营向导</p>
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
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-3">
                <Lightbulb className="h-6 w-6 text-red-400" />
              </div>
              <p className="text-sm font-medium text-gray-700">您好！我是您的小红书AI运营向导</p>
              <p className="text-xs text-muted-foreground mt-1">
                我了解小红书的运营规则、内容创作技巧和平台算法，可以随时为您提供专业建议。
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium">快捷提问：</p>
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
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {getQuickPrompts().slice(0, 2).map((q, i) => (
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
