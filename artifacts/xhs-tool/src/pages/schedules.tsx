import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Calendar, Trash2, Clock, Sparkles, Loader2, Wand2, CalendarDays, Copy, Check,
} from "lucide-react";
import { usePlatform } from "@/lib/platform-context";
import { PLATFORMS } from "@/lib/platform-meta";

type PlanItem = { dayOffset: number; time: string; title: string; body: string; tags: string[]; imagePrompt?: string; topic?: string };

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

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

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.schedules.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedules"] });
      qc.invalidateQueries({ queryKey: ["content"] });
      toast({ title: "计划已取消" });
    },
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
      qc.invalidateQueries({ queryKey: ["schedules"] });
      qc.invalidateQueries({ queryKey: ["content"] });
      toast({ title: `已采用 ${res.created} 条计划`, description: "可在下方查看 / 进一步「复制到整月」" });
      setAiOpen(false);
      setPlanItems([]);
    },
    onError: (e: Error) => toast({ title: "采用失败", description: e.message, variant: "destructive" }),
  });

  // ----- 复制到整月：按 accountId 分组识别"首周"，与后端复制条件一致 -----
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
      weeks: 3, // 已有第 1 周 + 复制 3 周 = 整月
    }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["schedules"] });
      qc.invalidateQueries({ queryKey: ["content"] });
      toast({ title: `已复制 ${res.created} 条`, description: "整月计划完成" });
    },
    onError: (e: Error) => toast({ title: "复制失败", description: e.message, variant: "destructive" }),
  });

  // ----- 已有计划按日分组 -----
  const grouped = schedules.reduce((acc: Record<string, any[]>, s: any) => {
    const date = new Date(s.scheduledAt).toLocaleDateString("zh-CN");
    if (!acc[date]) acc[date] = [];
    acc[date].push(s);
    return acc;
  }, {} as Record<string, any[]>);

  function updatePlanItem(idx: number, patch: Partial<PlanItem>) {
    setPlanItems((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }
  function removePlanItem(idx: number) {
    setPlanItems((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
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
                  const dt = addDays(new Date(planStartDate), it.dayOffset);
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

      {recentWeekRange && recentWeekRange.count > 0 && (
        <Card className="border-2" style={{ borderColor: "hsl(var(--platform-border))", background: "hsl(var(--platform-soft-bg))" }}>
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

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <Card key={i} className="animate-pulse"><CardContent className="pt-6 h-24" /></Card>
          ))}
        </div>
      ) : schedules.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground py-12">
            <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>暂无发布计划</p>
            <p className="text-xs mt-1">点击右上角「AI 排程规划」让 AI 帮你生成 7 天计划，或在编辑器中设置定时发布</p>
          </CardContent>
        </Card>
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
                {items.map((schedule: any) => (
                  <Card key={schedule.id}>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Clock className="h-3.5 w-3.5" />
                            {new Date(schedule.scheduledAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                          </div>
                          <div>
                            <p className="font-medium text-sm">{schedule.content?.title || "无标题"}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-muted-foreground">{schedule.account?.nickname}</span>
                              <Badge variant="outline" className="text-[10px]">{schedule.account?.region}</Badge>
                              <Badge variant={schedule.status === "completed" ? "default" : "secondary"} className="text-[10px]">
                                {schedule.status === "pending" ? "待发布" : schedule.status === "completed" ? "已完成" : schedule.status}
                              </Badge>
                            </div>
                          </div>
                        </div>
                        {schedule.status === "pending" && (
                          <Button
                            variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                            onClick={() => { if (confirm("确定取消该计划？")) deleteMutation.mutate(schedule.id); }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
