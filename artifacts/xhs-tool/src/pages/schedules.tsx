import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Calendar, Trash2, Clock, Sparkles, Loader2, Wand2, CalendarDays, Copy, Check, Pencil, Pause, Play, RotateCw, AlertCircle,
  CheckCircle2, AlertTriangle, X,
} from "lucide-react";
import { usePlatform } from "@/lib/platform-context";
import { PLATFORMS } from "@/lib/platform-meta";

type PlanItem = { dayOffset: number; time: string; title: string; body: string; tags: string[]; imagePrompt?: string; topic?: string };

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function toLocalDateTimeInputValue(iso: string) {
  const d = new Date(iso);
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}
function fromLocalDateTimeInputValue(v: string): string {
  return new Date(v).toISOString();
}

export default function Schedules() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { activePlatform } = usePlatform();
  const platformMeta = PLATFORMS[activePlatform];
  const PlatformIcon = platformMeta.icon;

  const { data: allSchedules = [], isLoading } = useQuery({
    queryKey: ["schedules"],
    queryFn: () => api.schedules.list(),
  });
  const schedules = allSchedules.filter((s: any) => (s.account?.platform || "xhs") === activePlatform);

  const accountsQ = useQuery({
    queryKey: ["accounts", activePlatform],
    queryFn: () => api.accounts.list({ platform: activePlatform }),
  });
  const accounts = accountsQ.data ?? [];

  const currentMonth = new Date().toISOString().slice(0, 7);
  const summaryQ = useQuery({
    queryKey: ["schedules-summary", currentMonth],
    queryFn: () => api.schedules.summary(currentMonth),
  });

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["schedules"] });
    qc.invalidateQueries({ queryKey: ["schedules-summary"] });
    qc.invalidateQueries({ queryKey: ["content"] });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.schedules.delete(id),
    onSuccess: () => { refreshAll(); toast({ title: "计划已取消" }); },
  });

  const pauseMutation = useMutation({
    mutationFn: (id: number) => api.schedules.pause(id),
    onSuccess: () => { refreshAll(); toast({ title: "已暂停", description: "到点不会自动发布，可随时恢复" }); },
    onError: (e: Error) => toast({ title: "暂停失败", description: e.message, variant: "destructive" }),
  });
  const resumeMutation = useMutation({
    mutationFn: (id: number) => api.schedules.resume(id),
    onSuccess: () => { refreshAll(); toast({ title: "已恢复", description: "到点将自动发布" }); },
    onError: (e: Error) => toast({ title: "恢复失败", description: e.message, variant: "destructive" }),
  });
  const retryMutation = useMutation({
    mutationFn: (id: number) => api.schedules.retry(id),
    onSuccess: () => { refreshAll(); toast({ title: "已重新排队", description: "1 分钟内自动重发" }); },
    onError: (e: Error) => toast({ title: "重试失败", description: e.message, variant: "destructive" }),
  });

  const bulkActionMutation = useMutation({
    mutationFn: ({ ids, action }: { ids: number[]; action: "pause" | "resume" | "delete" }) =>
      api.schedules.bulkAction(ids, action),
    onSuccess: (res, vars) => {
      refreshAll();
      setSelectedIds(new Set());
      const label = vars.action === "pause" ? "暂停" : vars.action === "resume" ? "恢复" : "删除";
      toast({ title: `批量${label}成功`, description: `共影响 ${res.affected} 条` });
    },
    onError: (e: Error) => toast({ title: "批量操作失败", description: e.message, variant: "destructive" }),
  });

  // ----- AI 周计划生成 -----
  const [aiOpen, setAiOpen] = useState(false);
  const [planNiche, setPlanNiche] = useState("");
  const [planAudience, setPlanAudience] = useState("");
  const [planStyle, setPlanStyle] = useState("");
  const [planFrequency, setPlanFrequency] = useState<"daily" | "twice-daily" | "every-other-day" | "weekly-3">("daily");
  const [planAccountId, setPlanAccountId] = useState<number | null>(null);
  const [planStartDate, setPlanStartDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [planItems, setPlanItems] = useState<PlanItem[]>([]);
  const [viralMeta, setViralMeta] = useState<{ sampleCount: number; hasViralData: boolean; warning: string | null; topHashtags: string[] } | null>(null);

  const generateMutation = useMutation({
    mutationFn: () => api.ai.generateWeeklyPlan({
      platform: activePlatform,
      niche: planNiche,
      audience: planAudience || undefined,
      styleHints: planStyle || undefined,
      frequency: planFrequency,
      language: activePlatform === "xhs" ? "zh" : (activePlatform === "facebook" || activePlatform === "instagram" ? "en" : "zh"),
    }),
    onSuccess: (res) => {
      setPlanItems(res.items);
      setViralMeta(res.viralMeta);
      toast({
        title: `AI 已生成 ${res.items.length} 条计划草案`,
        description: res.viralMeta?.hasViralData
          ? `已基于 ${res.viralMeta.sampleCount} 条已收集爆款样本训练`
          : "未找到爆款样本，建议先在「同行库」抓取",
      });
    },
    onError: (e: Error) => toast({ title: "生成失败", description: e.message, variant: "destructive" }),
  });

  const bulkCreateMutation = useMutation({
    mutationFn: () => api.schedules.bulkCreate({
      accountId: planAccountId!,
      startDate: planStartDate,
      items: planItems,
    }),
    onSuccess: (res) => {
      refreshAll();
      toast({ title: `已采用 ${res.created} 条计划`, description: "可在下方查看 / 进一步「复制到整月」" });
      setAiOpen(false);
      setPlanItems([]);
      autoTriedRef.current = `done:${activePlatform}`;
    },
    onError: (e: Error) => toast({ title: "采用失败", description: e.message, variant: "destructive" }),
  });

  // ----- 进入空状态时，自动预生成 7 天计划草案，让用户直接确认/编辑 -----
  // 触发条件：当前平台已无排程、已无草案、已有账号；
  // 每个平台**每会话只自动跑一次**（用 sessionStorage 持久化，避免：
  //   (a) 用户手动删完所有计划后被 AI 立刻重新生成
  //   (b) 用户切走再切回 /schedules 页面时被反复自动生成）
  const autoTriedRef = useRef<string | null>(null);
  const SESSION_KEY = `schedules:autoGen:${activePlatform}`;
  useEffect(() => {
    if (isLoading) return;
    if (accountsQ.isLoading) return; // 防止账号还在加载就误判 length=0
    if (schedules.length > 0) return;
    if (accounts.length === 0) return;
    if (planItems.length > 0) return;
    if (generateMutation.isPending) return;

    // 本会话已经为这个平台自动跑过 → 不再自动触发，由用户主动点"立即生成"
    try {
      if (typeof window !== "undefined" && sessionStorage.getItem(SESSION_KEY)) return;
    } catch { /* sessionStorage 不可用就忽略 */ }

    const key = `tried:${activePlatform}`;
    if (autoTriedRef.current === key) return;

    // 第一遍把账号 / niche 默认值灌进去，等 state 更新后下一轮 effect 再真正触发生成
    if (!planAccountId) {
      setPlanAccountId(accounts[0].id);
      return;
    }
    if (!planNiche) {
      const a: any = accounts.find((x: any) => x.id === planAccountId) ?? accounts[0];
      const fallback = a?.notes || a?.nickname || PLATFORMS[activePlatform]?.name || "lifestyle";
      setPlanNiche(String(fallback || "lifestyle").slice(0, 60) || "lifestyle");
      return;
    }
    autoTriedRef.current = key;
    try {
      if (typeof window !== "undefined") sessionStorage.setItem(SESSION_KEY, "1");
    } catch { /* 忽略 */ }
    generateMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, accountsQ.isLoading, schedules.length, accounts.length, planItems.length, planAccountId, planNiche, activePlatform]);

  // 切换平台时重置触发标记 + 清空草案，让新平台也能自动跑一次（受 sessionStorage 控制）
  useEffect(() => {
    autoTriedRef.current = null;
    setPlanItems([]);
    setPlanNiche("");
    setPlanAccountId(null);
    setViralMeta(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlatform]);

  // ----- 复制到整月 -----
  const recentWeekRange = useMemo(() => {
    if (schedules.length === 0) return null;
    const future = [...schedules]
      .filter((s: any) => s.status === "pending" && new Date(s.scheduledAt).getTime() >= startOfDay(new Date()).getTime())
      .sort((a: any, b: any) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
    if (future.length === 0) return null;
    const firstAccountId: number | undefined = future[0].accountId;
    if (!firstAccountId) return null;
    const sameAcc = future.filter((s: any) => s.accountId === firstAccountId);
    const first = new Date(sameAcc[0].scheduledAt);
    const startD = startOfDay(first);
    const endD = endOfDay(addDays(startD, 6));
    const itemsInRange = sameAcc.filter((s: any) => new Date(s.scheduledAt) <= endD);
    const accountNickname = itemsInRange[0]?.account?.nickname || "";
    return { startD, endD, accountId: firstAccountId, accountNickname, count: itemsInRange.length };
  }, [schedules]);

  const dupMutation = useMutation({
    mutationFn: () => api.schedules.duplicateWeeks({
      accountId: recentWeekRange!.accountId,
      startDate: recentWeekRange!.startD.toISOString(),
      endDate: recentWeekRange!.endD.toISOString(),
      weeks: 3,
    }),
    onSuccess: (res) => {
      refreshAll();
      toast({ title: `已复制 ${res.created} 条`, description: "整月计划完成" });
    },
    onError: (e: Error) => toast({ title: "复制失败", description: e.message, variant: "destructive" }),
  });

  // ----- 单条修改 / AI 微调 -----
  const [editing, setEditing] = useState<any | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editAt, setEditAt] = useState("");
  const [aiInstruction, setAiInstruction] = useState("");

  function openEdit(s: any) {
    setEditing(s);
    setEditTitle(s.content?.title || "");
    setEditBody(s.content?.body || "");
    setEditTags((s.content?.tags || []).join(", "));
    setEditAt(toLocalDateTimeInputValue(s.scheduledAt));
    setAiInstruction("");
  }

  const refineMutation = useMutation({
    mutationFn: () => api.ai.refineScheduleItem({
      current: { title: editTitle, body: editBody, tags: editTags.split(",").map((t) => t.trim()).filter(Boolean) },
      instruction: aiInstruction.trim(),
      niche: planNiche || undefined,
      platform: activePlatform,
    }),
    onSuccess: (res) => {
      setEditTitle(res.title);
      setEditBody(res.body);
      setEditTags(res.tags.join(", "));
      setAiInstruction("");
      toast({ title: "AI 已按你的指令调整", description: "你可以再继续微调，或直接保存" });
    },
    onError: (e: Error) => toast({ title: "AI 微调失败", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: () => api.schedules.update(editing!.id, {
      title: editTitle.trim(),
      body: editBody,
      tags: editTags.split(",").map((t) => t.trim()).filter(Boolean),
      scheduledAt: editAt ? fromLocalDateTimeInputValue(editAt) : undefined,
    }),
    onSuccess: () => {
      refreshAll();
      setEditing(null);
      toast({ title: "已保存", description: "仅修改了这一条，其它计划不受影响" });
    },
    onError: (e: Error) => toast({ title: "保存失败", description: e.message, variant: "destructive" }),
  });

  // ----- 多选 -----
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ----- 已有计划按日分组 -----
  const grouped: Record<string, any[]> = (schedules as any[]).reduce<Record<string, any[]>>((acc, s: any) => {
    const date = new Date(s.scheduledAt).toLocaleDateString("zh-CN");
    if (!acc[date]) acc[date] = [];
    acc[date].push(s);
    return acc;
  }, {});

  function updatePlanItem(idx: number, patch: Partial<PlanItem>) {
    setPlanItems((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }
  function removePlanItem(idx: number) {
    setPlanItems((prev) => prev.filter((_, i) => i !== idx));
  }

  const summary = summaryQ.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg ${platformMeta.bgClass} ${platformMeta.borderClass} border flex items-center justify-center`}>
            <PlatformIcon className={`h-5 w-5 ${platformMeta.textClass}`} />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{platformMeta.name} · 发布计划</h1>
            <p className="text-muted-foreground text-sm">
              {platformMeta.publishMode === "manual"
                ? "手动发布：复制内容 + 下载素材，按计划时间发布"
                : platformMeta.enabled
                ? "自动发布：到点后系统自动调用 API 投递"
                : `${platformMeta.name} 自动发布即将开放，目前可建立计划占位`}
            </p>
          </div>
        </div>

        <Dialog open={aiOpen} onOpenChange={setAiOpen}>
          <DialogTrigger asChild>
            <Button
              className="text-white shadow-md"
              style={{ background: "linear-gradient(135deg, hsl(var(--platform-from)), hsl(var(--platform-to)))" }}
            >
              <Sparkles className="h-4 w-4 mr-2" /> AI 排程规划
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Wand2 className="h-5 w-5" /> AI 一周排程规划
              </DialogTitle>
              <DialogDescription>
                先生成 7 天内容草案 → 微调 → 一键采用为「计划+草稿」。采用后可继续「复制到整月」。
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div className="space-y-1.5">
                <Label>账号</Label>
                <Select value={planAccountId ? String(planAccountId) : ""} onValueChange={(v) => setPlanAccountId(Number(v))}>
                  <SelectTrigger><SelectValue placeholder="选择要发布的账号" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a: any) => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.nickname} · {a.region}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>开始日期</Label>
                <Input type="date" value={planStartDate} onChange={(e) => setPlanStartDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>行业 / 业务方向</Label>
                <Input value={planNiche} onChange={(e) => setPlanNiche(e.target.value)} placeholder="例如：跨境电商美妆代购、新加坡留学咨询" />
              </div>
              <div className="space-y-1.5">
                <Label>发布频率</Label>
                <Select value={planFrequency} onValueChange={(v) => setPlanFrequency(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">每天 1 条（共 7）</SelectItem>
                    <SelectItem value="twice-daily">每天 2 条（共 14）</SelectItem>
                    <SelectItem value="every-other-day">隔天 1 条（共 4）</SelectItem>
                    <SelectItem value="weekly-3">一周 3 条（共 3）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>目标受众（可选）</Label>
                <Input value={planAudience} onChange={(e) => setPlanAudience(e.target.value)} placeholder="例如：25-35 岁一线城市职场女性" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>风格偏好（可选）</Label>
                <Input value={planStyle} onChange={(e) => setPlanStyle(e.target.value)} placeholder="例如：真实日常感、避免硬广、emoji 适量" />
              </div>
            </div>

            <Button
              onClick={() => generateMutation.mutate()}
              disabled={!planNiche.trim() || generateMutation.isPending}
              className="w-full text-white"
              style={{ background: "linear-gradient(135deg, hsl(var(--platform-from)), hsl(var(--platform-to)))" }}
            >
              {generateMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              {planItems.length > 0 ? "重新生成草案" : "生成 7 天草案"}
            </Button>

            {viralMeta && (
              <div className={`text-xs rounded-md border p-3 ${viralMeta.hasViralData ? "bg-emerald-50 border-emerald-200 text-emerald-900" : "bg-amber-50 border-amber-200 text-amber-900"}`}>
                {viralMeta.hasViralData ? (
                  <>
                    <div className="font-medium">✅ 已基于你收集的 {viralMeta.sampleCount} 条爆款样本生成</div>
                    {viralMeta.topHashtags.length > 0 && (
                      <div className="mt-1 opacity-80">参考的高频标签：{viralMeta.topHashtags.map((t) => `#${t}`).join(" ")}</div>
                    )}
                  </>
                ) : (
                  <div className="font-medium">⚠️ {viralMeta.warning || "暂无爆款数据，AI 仅基于通用规律生成"}</div>
                )}
              </div>
            )}

            {planItems.length > 0 && (
              <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                <p className="text-xs text-muted-foreground sticky top-0 bg-background py-1">
                  共 {planItems.length} 条 · 可微调标题/正文/时间，删除不要的
                </p>
                {planItems.map((it, i) => {
                  // 用 "T00:00:00" 强制按本地时区解析，避免 UTC 偏差导致显示前一天
                  const dt = addDays(new Date(planStartDate + "T00:00:00"), it.dayOffset);
                  const dateStr = dt.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", weekday: "short" });
                  return (
                    <Card key={i} className="border-l-4" style={{ borderLeftColor: "hsl(var(--platform-primary))" }}>
                      <CardContent className="pt-3 pb-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs">
                            <Badge variant="outline">第 {it.dayOffset + 1} 天 · {dateStr}</Badge>
                            <Input
                              type="time"
                              value={it.time}
                              onChange={(e) => updatePlanItem(i, { time: e.target.value })}
                              className="h-7 w-24 text-xs"
                            />
                            {it.topic && <Badge variant="secondary" className="text-[10px]">{it.topic}</Badge>}
                          </div>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removePlanItem(i)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <Input value={it.title} onChange={(e) => updatePlanItem(i, { title: e.target.value })} className="font-medium" />
                        <Textarea value={it.body} onChange={(e) => updatePlanItem(i, { body: e.target.value })} rows={4} className="text-sm" />
                        <div className="flex flex-wrap gap-1">
                          {it.tags.map((t, ti) => <Badge key={ti} variant="outline" className="text-[10px]">#{t}</Badge>)}
                        </div>
                        {it.imagePrompt && (
                          <p className="text-[11px] text-muted-foreground italic">配图提示：{it.imagePrompt}</p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="ghost" onClick={() => { setAiOpen(false); setPlanItems([]); setViralMeta(null); }}>取消</Button>
              <Button
                disabled={!planAccountId || planItems.length === 0 || bulkCreateMutation.isPending}
                onClick={() => bulkCreateMutation.mutate()}
              >
                {bulkCreateMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                采用计划（{planItems.length} 条）
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* 月度概览：本月你设置了哪些定时发布 */}
      {summary && summary.total > 0 && (
        <Card className="border-2" style={{ borderColor: "hsl(var(--platform-border))", background: "hsl(var(--platform-soft-bg))" }}>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-3 flex-wrap">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: "hsl(var(--platform-primary))", color: "hsl(var(--platform-primary-fg))" }}>
                <CalendarDays className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">本月（{summary.month}）共 {summary.total} 条定时发布</p>
                <div className="flex flex-wrap gap-2 mt-2 text-xs">
                  <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100"><Clock className="h-3 w-3 mr-1" />待发布 {summary.pending}</Badge>
                  {summary.paused > 0 && <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100"><Pause className="h-3 w-3 mr-1" />已暂停 {summary.paused}</Badge>}
                  {summary.published > 0 && <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100"><CheckCircle2 className="h-3 w-3 mr-1" />已完成 {summary.published}</Badge>}
                  {summary.failed > 0 && <Badge className="bg-red-100 text-red-800 hover:bg-red-100"><AlertTriangle className="h-3 w-3 mr-1" />失败 {summary.failed}</Badge>}
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">
                  鼠标悬停每条计划可单独修改 / 暂停 / 删除 — 改这一条不会影响其他计划。
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {recentWeekRange && recentWeekRange.count > 0 && (
        <Card className="border-2" style={{ borderColor: "hsl(var(--platform-border))" }}>
          <CardContent className="pt-4 pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: "hsl(var(--platform-primary))", color: "hsl(var(--platform-primary-fg))" }}>
                <CalendarDays className="h-4.5 w-4.5" />
              </div>
              <div>
                <p className="font-medium text-sm">检测到首周计划共 {recentWeekRange.count} 条 · {recentWeekRange.accountNickname}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {recentWeekRange.startD.toLocaleDateString("zh-CN")} ~ {recentWeekRange.endD.toLocaleDateString("zh-CN")} · 一键复制为整月（再加 3 周相同节奏，仅复制待发布的）
                </p>
              </div>
            </div>
            <Button
              onClick={() => { if (confirm(`确定把这 ${recentWeekRange.count} 条复制为接下来的 3 周（共多生成 ${recentWeekRange.count * 3} 条）？`)) dupMutation.mutate(); }}
              disabled={dupMutation.isPending}
              className="text-white shrink-0"
              style={{ background: "linear-gradient(135deg, hsl(var(--platform-from)), hsl(var(--platform-to)))" }}
            >
              {dupMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Copy className="h-4 w-4 mr-2" />}
              复制到整月
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 多选批量操作条 */}
      {selectedIds.size > 0 && (
        <Card className="bg-slate-50 border-slate-300 sticky top-2 z-10">
          <CardContent className="py-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="secondary">已选 {selectedIds.size} 条</Badge>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}><X className="h-3.5 w-3.5 mr-1" />清空</Button>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => bulkActionMutation.mutate({ ids: Array.from(selectedIds), action: "pause" })} disabled={bulkActionMutation.isPending}>
                <Pause className="h-3.5 w-3.5 mr-1" />批量暂停
              </Button>
              <Button size="sm" variant="outline" onClick={() => bulkActionMutation.mutate({ ids: Array.from(selectedIds), action: "resume" })} disabled={bulkActionMutation.isPending}>
                <Play className="h-3.5 w-3.5 mr-1" />批量恢复
              </Button>
              <Button size="sm" variant="destructive" onClick={() => { if (confirm(`确定批量删除 ${selectedIds.size} 条？`)) bulkActionMutation.mutate({ ids: Array.from(selectedIds), action: "delete" }); }} disabled={bulkActionMutation.isPending}>
                <Trash2 className="h-3.5 w-3.5 mr-1" />批量删除
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <Card key={i} className="animate-pulse"><CardContent className="pt-6 h-24" /></Card>
          ))}
        </div>
      ) : schedules.length === 0 ? (
        <AutoPlanReview
          platform={activePlatform}
          platformName={platformMeta.name}
          accounts={accounts}
          planAccountId={planAccountId}
          setPlanAccountId={setPlanAccountId}
          planStartDate={planStartDate}
          setPlanStartDate={setPlanStartDate}
          planItems={planItems}
          updatePlanItem={updatePlanItem}
          removePlanItem={removePlanItem}
          isGenerating={generateMutation.isPending}
          isCreating={bulkCreateMutation.isPending}
          onRegenerate={() => {
            autoTriedRef.current = null;
            try { if (typeof window !== "undefined") sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
            setPlanItems([]);
            generateMutation.mutate();
          }}
          onConfirmAll={() => bulkCreateMutation.mutate()}
          onCustomize={() => setAiOpen(true)}
          viralMeta={viralMeta}
        />
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([date, items]) => (
            <div key={date}>
              <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {date}
                <Badge variant="outline" className="text-[10px]">{items.length} 条</Badge>
              </h3>
              <div className="space-y-2">
                {items.map((schedule: any) => {
                  const isPaused = schedule.status === "paused";
                  const isPending = schedule.status === "pending";
                  const isDone = schedule.status === "published" || schedule.status === "completed";
                  const canEdit = !isDone;
                  return (
                    <Card key={schedule.id} className={isPaused ? "bg-amber-50/50 border-amber-200" : ""}>
                      <CardContent className="pt-4 pb-4">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            {canEdit && (
                              <Checkbox
                                checked={selectedIds.has(schedule.id)}
                                onCheckedChange={() => toggleSelect(schedule.id)}
                              />
                            )}
                            <div className="flex items-center gap-1 text-sm text-muted-foreground shrink-0">
                              <Clock className="h-3.5 w-3.5" />
                              {new Date(schedule.scheduledAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-sm truncate">{schedule.content?.title || "无标题"}</p>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                <span className="text-xs text-muted-foreground">{schedule.account?.nickname}</span>
                                <Badge variant="outline" className="text-[10px]">{schedule.account?.region}</Badge>
                                {isPending && <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 text-[10px]">待发布</Badge>}
                                {isPaused && <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 text-[10px]"><Pause className="h-2.5 w-2.5 mr-0.5" />已暂停</Badge>}
                                {isDone && <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 text-[10px]"><CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />已完成</Badge>}
                                {schedule.status === "failed" && <Badge className="bg-red-100 text-red-800 hover:bg-red-100 text-[10px]"><AlertCircle className="h-2.5 w-2.5 mr-0.5" />失败</Badge>}
                              </div>
                              {schedule.status === "failed" && schedule.errorMessage && (
                                <p className="text-[11px] text-red-700 mt-1 line-clamp-2" title={schedule.errorMessage}>
                                  原因：{schedule.errorMessage}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {canEdit && (
                              <Button variant="ghost" size="sm" className="h-8" onClick={() => openEdit(schedule)}>
                                <Pencil className="h-3.5 w-3.5 mr-1" />修改
                              </Button>
                            )}
                            {isPending && (
                              <Button variant="ghost" size="sm" className="h-8 text-amber-700 hover:text-amber-800" onClick={() => pauseMutation.mutate(schedule.id)} disabled={pauseMutation.isPending}>
                                <Pause className="h-3.5 w-3.5 mr-1" />暂停
                              </Button>
                            )}
                            {isPaused && (
                              <Button variant="ghost" size="sm" className="h-8 text-emerald-700 hover:text-emerald-800" onClick={() => resumeMutation.mutate(schedule.id)} disabled={resumeMutation.isPending}>
                                <Play className="h-3.5 w-3.5 mr-1" />恢复
                              </Button>
                            )}
                            {schedule.status === "failed" && (
                              <Button variant="ghost" size="sm" className="h-8 text-blue-700 hover:text-blue-800" onClick={() => retryMutation.mutate(schedule.id)} disabled={retryMutation.isPending}>
                                <RotateCw className="h-3.5 w-3.5 mr-1" />重试
                              </Button>
                            )}
                            {canEdit && (
                              <Button
                                variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                                onClick={() => { if (confirm("确定取消该计划？")) deleteMutation.mutate(schedule.id); }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 单条修改弹窗 */}
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5" /> 修改这一条
            </DialogTitle>
            <DialogDescription>
              只改这一条计划的内容和时间，<b>不会影响其他</b>已排程的计划。
            </DialogDescription>
          </DialogHeader>

          {editing && (
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label>标题</Label>
                <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} maxLength={200} />
              </div>
              <div className="space-y-1.5">
                <Label>正文</Label>
                <Textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={8} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label>标签（逗号分隔，去 # 号）</Label>
                <Input value={editTags} onChange={(e) => setEditTags(e.target.value)} placeholder="例如：穿搭, 通勤, 平价" />
              </div>
              <div className="space-y-1.5">
                <Label>发布时间</Label>
                <Input type="datetime-local" value={editAt} onChange={(e) => setEditAt(e.target.value)} />
              </div>

              <Card className="bg-violet-50 border-violet-200">
                <CardContent className="pt-4 pb-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-violet-900">
                    <Wand2 className="h-4 w-4" /> AI 帮我改这一条
                  </div>
                  <p className="text-[11px] text-violet-800/80">
                    告诉 AI 你想怎么改 — 比如「再口语一点」「加个数字钩子」「正文砍一半」「换成给宝妈的角度」。AI 只改这条，不动其他。
                  </p>
                  <Textarea
                    value={aiInstruction}
                    onChange={(e) => setAiInstruction(e.target.value)}
                    rows={2}
                    placeholder="例如：标题改成更口语的疑问句；正文砍掉硬广，加 1 个亲身使用的小细节"
                    className="text-sm bg-white"
                  />
                  <Button
                    size="sm"
                    onClick={() => refineMutation.mutate()}
                    disabled={!aiInstruction.trim() || refineMutation.isPending}
                    className="bg-violet-600 hover:bg-violet-700 text-white"
                  >
                    {refineMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                    AI 微调（消耗 3 积分）
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>取消</Button>
            <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending || !editTitle.trim()}>
              {updateMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
              保存修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── 空状态：基于市场数据展示 AI 推荐发布时段 ──
// 自动预生成 7 天计划草案 — 用户只需"全部确认"就批量入排程，
// 或对每条单独编辑/删除；不再要求用户先开 dialog 填表
function AutoPlanReview({
  platform,
  platformName,
  accounts,
  planAccountId,
  setPlanAccountId,
  planStartDate,
  setPlanStartDate,
  planItems,
  updatePlanItem,
  removePlanItem,
  isGenerating,
  isCreating,
  onRegenerate,
  onConfirmAll,
  onCustomize,
  viralMeta,
}: {
  platform: string;
  platformName: string;
  accounts: any[];
  planAccountId: number | null;
  setPlanAccountId: (id: number) => void;
  planStartDate: string;
  setPlanStartDate: (d: string) => void;
  planItems: PlanItem[];
  updatePlanItem: (i: number, patch: Partial<PlanItem>) => void;
  removePlanItem: (i: number) => void;
  isGenerating: boolean;
  isCreating: boolean;
  onRegenerate: () => void;
  onConfirmAll: () => void;
  onCustomize: () => void;
  viralMeta: { sampleCount: number; hasViralData: boolean; warning: string | null; topHashtags: string[] } | null;
}) {
  // 没有账号 → 引导先建账号
  if (accounts.length === 0) {
    return (
      <Card>
        <CardContent className="pt-10 pb-10 text-center space-y-3">
          <Calendar className="h-10 w-10 mx-auto opacity-40" />
          <p className="font-medium">还没有 {platformName} 账号</p>
          <p className="text-xs text-muted-foreground">
            先到「账号管理」绑定一个 {platformName} 账号，AI 才能为你预生成发布计划
          </p>
        </CardContent>
      </Card>
    );
  }

  // 生成中 → 友好等待状态
  if (isGenerating && planItems.length === 0) {
    return (
      <Card>
        <CardContent className="pt-10 pb-10 text-center space-y-3">
          <Loader2 className="h-10 w-10 mx-auto animate-spin text-primary" />
          <p className="font-medium">AI 正在为你生成 7 天发布计划…</p>
          <p className="text-xs text-muted-foreground">
            正在分析 {platformName} 同行爆款 + 最佳发布时段，约需 10-30 秒
          </p>
        </CardContent>
      </Card>
    );
  }

  // 还没开始且没有草案（账号刚切换的瞬间）
  if (planItems.length === 0) {
    return (
      <Card>
        <CardContent className="pt-10 pb-10 text-center space-y-3">
          <Calendar className="h-10 w-10 mx-auto opacity-40" />
          <p className="font-medium">暂无发布计划</p>
          <p className="text-xs text-muted-foreground">
            AI 草案准备中，请稍候。如果长时间未出现，点下方按钮重试。
          </p>
          <Button onClick={onRegenerate} variant="outline" size="sm">
            <Wand2 className="h-4 w-4 mr-2" />立即生成 7 天计划
          </Button>
        </CardContent>
      </Card>
    );
  }

  // 主流程：草案已生成，展示可编辑列表 + 一键全部确认
  return (
    <div className="space-y-4">
      {/* 顶部说明 + 全部确认大按钮 */}
      <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-purple-500/5">
        <CardContent className="pt-5 pb-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-[260px]">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="h-4 w-4 text-primary" />
                <p className="font-semibold">AI 已为你生成 {planItems.length} 条 {platformName} 发布计划</p>
              </div>
              <p className="text-xs text-muted-foreground">
                每条都已配好时间 + 不同标题/正文/标签。
                <strong className="text-foreground"> 点「全部确认」</strong>
                后系统会到点自动发布；想改的话直接在下方卡片里编辑或删除。
              </p>
              {viralMeta && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  {viralMeta.hasViralData
                    ? <>已基于 <strong className="text-foreground">{viralMeta.sampleCount}</strong> 条爆款样本训练</>
                    : "暂无爆款样本，建议在「同行库」抓取后重新生成以提升质量"}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={onRegenerate} disabled={isGenerating || isCreating}>
                {isGenerating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCw className="h-4 w-4 mr-2" />}
                重新生成
              </Button>
              <Button variant="outline" size="sm" onClick={onCustomize} disabled={isCreating}>
                <Pencil className="h-4 w-4 mr-2" />详细自定义
              </Button>
              <Button
                onClick={onConfirmAll}
                disabled={isCreating || isGenerating || !planAccountId}
                className="text-white shadow"
                style={{ background: "linear-gradient(135deg, hsl(var(--platform-from)), hsl(var(--platform-to)))" }}
              >
                {isCreating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                全部确认（{planItems.length} 条）
              </Button>
            </div>
          </div>

          {/* 账号 + 起始日期（轻量行内编辑） */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-4 border-t">
            <div className="space-y-1">
              <Label className="text-xs">发布账号</Label>
              <Select value={planAccountId ? String(planAccountId) : ""} onValueChange={(v) => setPlanAccountId(Number(v))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="选择账号" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a: any) => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.nickname} · {a.region}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">起始日期</Label>
              <Input type="date" value={planStartDate} onChange={(e) => setPlanStartDate(e.target.value)} className="h-8 text-xs" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 草案逐条卡片：时间 / 标题 / 正文 / 标签 / 配图提示 / 删除 */}
      <div className="space-y-3">
        {planItems.map((it, i) => {
          // 用 "T00:00:00" 强制按本地时区解析，避免 UTC 偏差导致显示前一天
          const dt = addDays(new Date(planStartDate + "T00:00:00"), it.dayOffset);
          const dateStr = dt.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", weekday: "short" });
          return (
            <Card key={i} className="border-l-4" style={{ borderLeftColor: "hsl(var(--platform-primary))" }}>
              <CardContent className="pt-4 pb-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 text-xs flex-wrap">
                    <Badge variant="outline">第 {it.dayOffset + 1} 天 · {dateStr}</Badge>
                    <Input
                      type="time"
                      value={it.time}
                      onChange={(e) => updatePlanItem(i, { time: e.target.value })}
                      className="h-7 w-24 text-xs"
                    />
                    {it.topic && <Badge variant="secondary" className="text-[10px]">{it.topic}</Badge>}
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removePlanItem(i)} title="删除这条">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <Input
                  value={it.title}
                  onChange={(e) => updatePlanItem(i, { title: e.target.value })}
                  className="font-medium"
                  placeholder="标题"
                />
                <Textarea
                  value={it.body}
                  onChange={(e) => updatePlanItem(i, { body: e.target.value })}
                  rows={3}
                  className="text-sm"
                  placeholder="正文"
                />
                {it.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {it.tags.map((t, ti) => <Badge key={ti} variant="outline" className="text-[10px]">#{t}</Badge>)}
                  </div>
                )}
                {it.imagePrompt && (
                  <p className="text-[11px] text-muted-foreground italic">
                    配图提示：{it.imagePrompt}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* 底部再放一次确认按钮，长列表也方便操作 */}
      <Card className="bg-muted/30">
        <CardContent className="pt-4 pb-4 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-muted-foreground">
            确认后这 {planItems.length} 条草稿会立刻生效，到点自动发布。
          </p>
          <Button
            onClick={onConfirmAll}
            disabled={isCreating || isGenerating || !planAccountId}
            className="text-white"
            style={{ background: "linear-gradient(135deg, hsl(var(--platform-from)), hsl(var(--platform-to)))" }}
          >
            {isCreating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
            全部确认并排入发布
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
