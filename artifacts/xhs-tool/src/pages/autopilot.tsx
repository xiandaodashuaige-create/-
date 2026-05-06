import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePlatform } from "@/lib/platform-context";
import { PLATFORMS, type PlatformId } from "@/lib/platform-meta";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { setReturnToFlow } from "@/lib/return-to-flow";
import {
  Sparkles, Loader2, CheckCircle2, ArrowRight, Users2, Brain, FileEdit, Send,
  AlertCircle, Search, RefreshCw, Zap, Rocket, Settings2, ChevronDown,
} from "lucide-react";

type Step = "setup" | "running" | "review" | "approved";
type LogLine = { ts: number; text: string; status: "info" | "success" | "warn" | "error" | "running" };

function nowTs() { return Date.now(); }

export default function AutopilotPage() {
  const { activePlatform } = usePlatform();
  const platform = activePlatform as PlatformId;
  const platformMeta = PLATFORMS[platform];
  const { toast } = useToast();
  const qc = useQueryClient();

  const [step, setStep] = useState<Step>("setup");
  const [niche, setNiche] = useState("");
  const [region, setRegion] = useState("");
  const [extras, setExtras] = useState("");
  const [autoDiscover, setAutoDiscover] = useState(true);
  const [customMode, setCustomMode] = useState(false);
  const customModeRef = useRef(false);
  // 多账号场景：用户必须明确选定"本次 AI 用哪个业务身份"，
  // 否则草稿会被绑到 backend 默认（前 5 个全用），用户无法预知归属
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [strategyResult, setStrategyResult] = useState<any | null>(null);
  const [contentId, setContentId] = useState<number | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);

  const competitorsQ = useQuery({
    queryKey: ["autopilot-competitors", platform],
    queryFn: () => api.competitors.list(platform),
  });
  const accountsQ = useQuery({
    queryKey: ["autopilot-accounts", platform],
    queryFn: () => api.accounts.list({ platform }),
  });

  const hasAccounts = (accountsQ.data?.length ?? 0) > 0;
  const existingCompetitors = competitorsQ.data ?? [];

  // 账号加载完后默认选第一个；切平台后清空，让 effect 重新选当前平台第一个
  useEffect(() => {
    setSelectedAccountId(null);
  }, [platform]);
  useEffect(() => {
    const list = accountsQ.data ?? [];
    if (list.length === 0) {
      if (selectedAccountId !== null) setSelectedAccountId(null);
      return;
    }
    // 当前选中已不在最新列表（账号被删/换平台后残留），自动重选第一个
    const stillExists = selectedAccountId != null && list.some((a: any) => a.id === selectedAccountId);
    if (!stillExists) setSelectedAccountId(list[0].id);
  }, [accountsQ.data, selectedAccountId]);
  const selectedAccount = accountsQ.data?.find((a: any) => a.id === selectedAccountId) ?? null;

  const logEl = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    logEl.current?.scrollTo({ top: logEl.current.scrollHeight, behavior: "smooth" });
  }, [logs]);

  function pushLog(text: string, status: LogLine["status"] = "info") {
    setLogs((prev) => [...prev, { ts: nowTs(), text, status }]);
  }

  async function runPipeline() {
    // Abort any prior run + bump runId to invalidate stale callbacks
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const myRunId = ++runIdRef.current;
    const isStale = () => myRunId !== runIdRef.current || ctrl.signal.aborted;
    const sig = ctrl.signal;

    setLogs([]);
    setStep("running");
    setStrategyResult(null);
    setContentId(null);

    try {
      pushLog(`🚀 启动 ${platformMeta.name} AI 自动驾驶`, "info");
      pushLog(`目标行业：${niche}${region ? ` · 地区：${region}` : ""}`, "info");

      // ── Stage 2: 同行库 ──
      let competitorPool = [...existingCompetitors];
      if (competitorPool.length > 0) {
        pushLog(`✓ 已有 ${competitorPool.length} 位同行可用，跳过自动发现`, "success");
      } else if (autoDiscover && platform === "tiktok") {
        pushLog(`🔍 调用 TikHub 搜索 ${platformMeta.name} 行业 KOL…`, "running");
        try {
          const dis = await api.competitors.discover(platform, niche, 6, { signal: sig });
          if (isStale()) return;
          if (dis.creators?.length > 0) {
            pushLog(`✓ 发现 ${dis.creators.length} 位候选：${dis.creators.slice(0, 3).map((c: any) => "@" + (c.handle || c.uniqueId || c.username)).join("、")}…`, "success");

            const top = dis.creators.slice(0, 3);
            for (const c of top) {
              if (isStale()) return;
              const handle = c.handle || c.uniqueId || c.username;
              if (!handle) continue;
              try {
                pushLog(`  ↳ 添加并同步 @${handle}…`, "running");
                const added = await api.competitors.add({ platform, handle, region: region || undefined }, { signal: sig });
                if (isStale()) return;
                competitorPool.push(added);
                pushLog(`  ✓ @${handle} 已入库（${added.postCount ?? 0} 条样本）`, "success");
              } catch (e: any) {
                if (sig.aborted) return;
                pushLog(`  ⚠ @${handle} 添加失败：${e?.message ?? "skip"}`, "warn");
              }
            }
            if (isStale()) return;
            qc.invalidateQueries({ queryKey: ["autopilot-competitors", platform] });
            qc.invalidateQueries({ queryKey: ["competitors", platform] });
          } else {
            pushLog(`⚠ 未找到 ${platformMeta.name} 上的相关 KOL，将基于行业知识生成策略`, "warn");
          }
        } catch (e: any) {
          if (sig.aborted) return;
          pushLog(`⚠ 发现失败：${e?.message ?? "skip"}（继续）`, "warn");
        }
      } else if (platform !== "tiktok") {
        pushLog(`ℹ ${platformMeta.name} 暂未接入自动发现，将基于行业知识 + 你已添加的同行生成`, "info");
      }

      if (isStale()) return;

      // ── Stage 3: AI 综合 ──
      pushLog(`🧠 调用 GPT-5-mini 综合 ${competitorPool.length} 位同行 + 业务身份【${selectedAccount?.nickname ?? "(未选)"}】画像…`, "running");
      const strat = await api.strategy.generate({
        platform,
        region: region || undefined,
        niche: niche || undefined,
        accountIds: selectedAccountId ? [selectedAccountId] : undefined,
        customRequirements: extras || undefined,
      }, { signal: sig });
      if (isStale()) return;
      pushLog(`✓ 策略生成完成：${strat.strategy.theme}`, "success");
      pushLog(`  · 数据模式：${strat.meta.dataMode} · 样本：${strat.meta.postsAnalyzed}`, "info");
      if (strat.meta?.warning) pushLog(`⚠ ${strat.meta.warning}`, "warn");

      setStrategyResult(strat);

      // 一键模式：跳过审核，自动批准 → 直接进草稿
      if (!customModeRef.current) {
        pushLog(`✓ 自动批准（已为你简化流程，如需手动审核请打开"自定义"）`, "success");
        pushLog(`📝 生成草稿中…`, "running");
        try {
          const approved = await api.strategy.approve(strat.id);
          if (isStale()) return;
          setContentId(approved.contentId);
          setStep("approved");
          qc.invalidateQueries({ queryKey: ["content"] });
          toast({ title: "草稿已就绪", description: `#${approved.contentId} 可直接编辑或定时发布` });
        } catch (e: any) {
          if (sig.aborted || isStale()) return;
          pushLog(`⚠ 自动批准失败：${e?.message ?? "请手动审核"}`, "warn");
          setStep("review");
        }
      } else {
        setStep("review");
      }
    } catch (err: any) {
      if (sig.aborted || isStale()) return;
      pushLog(`❌ 失败：${err?.message ?? "未知错误"}`, "error");
      toast({ title: "自动驾驶中断", description: err?.message ?? "未知错误", variant: "destructive" });
      setStep("setup");
    }
  }

  // Cleanup: abort on unmount
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const approveMut = useMutation({
    mutationFn: () => api.strategy.approve(strategyResult.id),
    onSuccess: (data) => {
      setContentId(data.contentId);
      setStep("approved");
      toast({ title: "已批准", description: `已生成草稿 #${data.contentId}` });
    },
    onError: (err: any) => toast({ title: "批准失败", description: err?.message, variant: "destructive" }),
  });

  function handleStart() {
    if (!hasAccounts) {
      toast({
        title: `请先添加 ${platformMeta.name} 账号`,
        description: "AI 需要你的账号画像（地区 / 备注 / 受众）来定制策略",
        variant: "destructive",
      });
      return;
    }
    // 显式校验：必须有效选定一个业务身份，避免账号 effect race 期间提交导致后端走"前 5 个全用"默认
    if (!selectedAccount) {
      toast({
        title: "请先选定本次的业务身份",
        description: "上方账号选择器还没就绪，请稍候或手动点选一个账号",
        variant: "destructive",
      });
      return;
    }
    if (!niche.trim()) {
      toast({ title: "请输入行业关键词", variant: "destructive" });
      return;
    }
    customModeRef.current = customMode;
    runPipeline();
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center">
          <Rocket className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">AI 自动驾驶 · {platformMeta.name}</h1>
          <p className="text-sm text-muted-foreground">
            一句话告诉我你的行业，AI 自动 [发现同行 → 抓取爆款 → 生成策略 → 草稿入库]
          </p>
        </div>
      </div>

      {/* 进度 */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-2">
          {[
            { key: "setup", label: "需求", icon: FileEdit },
            { key: "running", label: "AI 流水线", icon: Brain },
            { key: "review", label: "审策略", icon: Sparkles },
            { key: "approved", label: "草稿就绪", icon: CheckCircle2 },
          ].map((s, i, arr) => {
            const order = ["setup", "running", "review", "approved"];
            const currentIdx = order.indexOf(step);
            const myIdx = order.indexOf(s.key);
            const done = myIdx < currentIdx;
            const active = myIdx === currentIdx;
            const Icon = s.icon;
            return (
              <div key={s.key} className="flex items-center flex-1">
                <div className={`flex flex-col items-center gap-1 ${active ? "text-primary" : done ? "text-emerald-600" : "text-muted-foreground/50"}`}>
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition ${active ? "border-primary bg-primary/10" : done ? "border-emerald-500 bg-emerald-50" : "border-muted-foreground/20"}`}>
                    {step === "running" && active ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                  </div>
                  <span className="text-xs font-medium">{s.label}</span>
                </div>
                {i < arr.length - 1 && <ArrowRight className="h-3 w-3 mx-2 text-muted-foreground/40 flex-shrink-0" />}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Step 1: 配置 */}
      {step === "setup" && (
        <Card className="p-6 space-y-5">
          {/* 前置检查 + 业务身份选择 */}
          {!hasAccounts ? (
            <div className="rounded-lg border p-3 text-sm bg-amber-50 border-amber-200 text-amber-800">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  还没有 {platformMeta.name} 账号。
                  <Link
                    href="/accounts"
                    onClick={() => setReturnToFlow("/autopilot")}
                    className="underline ml-1 font-medium"
                  >
                    去添加 / 授权 →
                  </Link>
                </div>
              </div>
            </div>
          ) : (accountsQ.data?.length ?? 0) === 1 ? (
            // 单账号：没的选，恢复原来的简洁绿色横幅，不强加"选业务身份"步骤
            <div className="rounded-lg border p-3 text-sm bg-emerald-50 border-emerald-200 text-emerald-800">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  已绑定 <strong>1</strong> 个 {platformMeta.name} 账号
                  {selectedAccount?.nickname && <>（<strong>{selectedAccount.nickname}</strong>）</>}
                  · 已添加 <strong>{existingCompetitors.length}</strong> 位同行
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Users2 className="h-4 w-4 text-primary" />
                  本次以哪个业务身份执行？
                  <span className="text-xs text-muted-foreground font-normal">
                    （草稿、定时发布都会归到这个账号）
                  </span>
                </div>
                <Link
                  href="/accounts"
                  onClick={() => setReturnToFlow("/autopilot")}
                  className="text-xs text-muted-foreground hover:text-primary underline"
                >
                  + 新增账号
                </Link>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {accountsQ.data!.map((acc: any) => {
                  const isSelected = acc.id === selectedAccountId;
                  return (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => setSelectedAccountId(acc.id)}
                      className={`text-left rounded-md border p-2.5 transition ${
                        isSelected
                          ? `${platformMeta.bgClass} ${platformMeta.borderClass} ring-2 ring-offset-1 ${platformMeta.textClass.replace("text-", "ring-")}`
                          : "bg-background hover:bg-muted/50 border-muted"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className={`w-8 h-8 rounded-full ${platformMeta.bgClass} ${platformMeta.textClass} flex items-center justify-center font-bold text-sm flex-shrink-0`}>
                          {(acc.nickname || "?").charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-sm truncate">{acc.nickname}</span>
                            {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />}
                          </div>
                          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                              {acc.region || "—"}
                            </Badge>
                            {acc.platformAccountId && (
                              <span className="text-[10px] text-muted-foreground truncate">
                                ID: {acc.platformAccountId}
                              </span>
                            )}
                          </div>
                          {acc.notes && (
                            <p className="text-[11px] text-muted-foreground mt-1 line-clamp-1">
                              {acc.notes}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="text-xs text-muted-foreground pt-1 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                已添加 <strong className="text-foreground">{existingCompetitors.length}</strong> 位同行
              </div>
            </div>
          )}

          <div>
            <label className="text-sm font-medium mb-1 block">
              <Zap className="h-3.5 w-3.5 inline mr-1" />
              行业 / 业务定位 <span className="text-red-500">*</span>
            </label>
            <Input
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder="如：美容培训、本地餐饮、AI 工具评测、母婴用品"
              className="text-base"
            />
            <div className="text-xs text-muted-foreground mt-1">越具体越好，AI 会用此关键词搜索同行 + 过滤无关数据</div>
          </div>

          {/* 一键模式说明 */}
          {!customMode && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm flex items-start gap-2">
              <Sparkles className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
              <div className="flex-1 text-foreground/80">
                <strong className="text-primary">一键模式：</strong>AI 会自动 [发现同行 → 抓爆款 → 生成策略 → <strong>自动批准</strong> → 草稿入库]，全程无需你点确认，完成后直接打开编辑器。
              </div>
            </div>
          )}

          {/* 自定义高级配置 */}
          <button
            type="button"
            onClick={() => setCustomMode((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition"
          >
            <Settings2 className="h-3.5 w-3.5" />
            {customMode ? "收起自定义" : "自定义（地区 / 额外要求 / 手动审核策略）"}
            <ChevronDown className={`h-3 w-3 transition-transform ${customMode ? "rotate-180" : ""}`} />
          </button>

          {customMode && (
            <div className="space-y-4 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 p-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">地区（可选）</label>
                  <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="如：马来西亚 / 上海" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">额外要求（可选）</label>
                  <Input value={extras} onChange={(e) => setExtras(e.target.value)} placeholder="如：突出价格优势、目标客单 ¥99" />
                </div>
              </div>

              {existingCompetitors.length === 0 && platform === "tiktok" && (
                <label className="flex items-start gap-2 text-sm cursor-pointer p-3 rounded-md border bg-background">
                  <Checkbox checked={autoDiscover} onCheckedChange={(v) => setAutoDiscover(!!v)} className="mt-0.5" />
                  <div>
                    <div className="font-medium flex items-center gap-1.5">
                      <Search className="h-3.5 w-3.5" />
                      自动发现 3 位 TikTok 同行 KOL
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">基于行业关键词搜索 → 自动入库 → 抓取最近爆款 → 喂给 AI</div>
                  </div>
                </label>
              )}

              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                ⚠ 自定义模式下，策略生成后会停在审核步骤，需你手动点击"批准"才会生成草稿。
              </div>
            </div>
          )}

          <Button
            size="lg"
            className="w-full bg-gradient-to-r from-primary to-purple-500 hover:opacity-90 text-base h-12"
            onClick={handleStart}
            disabled={!niche.trim() || !hasAccounts || !selectedAccount}
          >
            <Rocket className="h-5 w-5 mr-2" />
            {customMode ? "启动 AI 自动驾驶（手动审核）" : "一键启动 AI 自动驾驶"}
          </Button>
        </Card>
      )}

      {/* Step 2: 流水线运行中 */}
      {step === "running" && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Brain className="h-10 w-10 text-primary animate-pulse" />
              <Loader2 className="h-4 w-4 text-primary animate-spin absolute -bottom-0.5 -right-0.5" />
            </div>
            <div className="flex-1">
              <div className="font-semibold">流水线运行中…</div>
              <div className="text-xs text-muted-foreground">大约需要 20–60 秒，请勿离开页面</div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                abortRef.current?.abort();
                runIdRef.current++;
                pushLog("⏹ 用户取消（已中断后端请求）", "warn");
                setStep("setup");
              }}
            >
              取消
            </Button>
          </div>

          {/* 实时日志 */}
          <div
            ref={logEl}
            className="bg-zinc-950 text-zinc-100 rounded-lg p-4 font-mono text-xs space-y-1 max-h-80 overflow-y-auto"
          >
            {logs.map((l, i) => (
              <div
                key={i}
                className={
                  l.status === "success" ? "text-emerald-400" :
                  l.status === "warn" ? "text-amber-400" :
                  l.status === "error" ? "text-red-400" :
                  l.status === "running" ? "text-blue-300" :
                  "text-zinc-300"
                }
              >
                <span className="text-zinc-500 mr-2">{new Date(l.ts).toLocaleTimeString("zh-CN", { hour12: false })}</span>
                {l.text}
              </div>
            ))}
            <div className="text-zinc-500 animate-pulse">▊</div>
          </div>
        </Card>
      )}

      {/* Step 3: 策略卡 */}
      {step === "review" && strategyResult && (
        <div className="space-y-4">
          {/* 折叠后的成功日志 */}
          <Card className="p-3 bg-emerald-50/50 border-emerald-200">
            <div className="flex items-center gap-2 text-sm text-emerald-800">
              <CheckCircle2 className="h-4 w-4" />
              <span className="font-medium">流水线完成</span>
              <span className="text-xs text-emerald-600/80">
                · 同行 {strategyResult.meta.competitorsAnalyzed} · 样本 {strategyResult.meta.postsAnalyzed} · 模式 {strategyResult.meta.dataMode}
              </span>
            </div>
          </Card>

          {strategyResult.meta?.warning && (
            <Card className="p-3 border-amber-300 bg-amber-50">
              <div className="flex gap-2 text-sm text-amber-800">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <div>{strategyResult.meta.warning}</div>
              </div>
            </Card>
          )}

          <Card className="p-6 space-y-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">本期主题</div>
              <div className="text-xl font-bold">{strategyResult.strategy.theme}</div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-muted/40 rounded p-2"><strong>BGM:</strong> {strategyResult.strategy.bgmStyle}</div>
              <div className="bg-muted/40 rounded p-2"><strong>时长:</strong> {strategyResult.strategy.estimatedDuration}s</div>
              <div className="bg-muted/40 rounded p-2"><strong>画幅:</strong> {strategyResult.strategy.aspectRatio}</div>
              <div className="bg-muted/40 rounded p-2"><strong>发布:</strong> {strategyResult.strategy.bestPostingTime}</div>
            </div>

            <div>
              <div className="text-sm font-semibold mb-1">钩子公式</div>
              <div className="text-sm bg-primary/5 rounded p-3 italic">{strategyResult.strategy.hookFormula}</div>
            </div>

            <div>
              <div className="text-sm font-semibold mb-2">剧本 / 场景</div>
              <ol className="space-y-2">
                {strategyResult.strategy.scriptOutline?.map((s: any) => (
                  <li key={s.order} className="flex gap-3 text-sm border-l-2 border-primary/30 pl-3">
                    <span className="font-bold text-primary">{s.order}</span>
                    <div className="flex-1">
                      <div className="font-medium">{s.description} <span className="text-xs text-muted-foreground">({s.duration}s)</span></div>
                      <div className="text-muted-foreground text-xs mt-0.5">"{s.dialogue}"</div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {strategyResult.strategy.voiceoverScript && (
              <div>
                <div className="text-sm font-semibold mb-1">完整旁白 / 正文</div>
                <Textarea
                  value={strategyResult.strategy.voiceoverScript}
                  readOnly
                  rows={6}
                  className="text-sm bg-muted/30"
                />
              </div>
            )}

            <div>
              <div className="text-sm font-semibold mb-2">推荐标签</div>
              <div className="flex flex-wrap gap-1.5">
                {strategyResult.strategy.hashtags?.map((h: string, i: number) => (
                  <Badge key={i} variant="secondary">{h}</Badge>
                ))}
              </div>
            </div>

            {strategyResult.strategy.referenceCompetitors?.length > 0 && (
              <div>
                <div className="text-sm font-semibold mb-2">参考同行</div>
                <ul className="space-y-1 text-sm">
                  {strategyResult.strategy.referenceCompetitors.map((c: any, i: number) => (
                    <li key={i}><strong>@{c.handle}</strong> <span className="text-muted-foreground">— {c.why}</span></li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex gap-2 pt-3 border-t">
              <Button variant="outline" onClick={() => { setStep("setup"); setStrategyResult(null); }}>
                <RefreshCw className="h-4 w-4 mr-1.5" /> 重来
              </Button>
              <Button variant="outline" onClick={() => runPipeline()}>
                <Sparkles className="h-4 w-4 mr-1.5" /> 重生成策略
              </Button>
              <Button className="flex-1 bg-gradient-to-r from-primary to-purple-500 hover:opacity-90" onClick={() => approveMut.mutate()} disabled={approveMut.isPending}>
                {approveMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                批准 → 进编辑器
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Step 4: 完成 */}
      {step === "approved" && contentId && (
        <Card className="p-8 text-center space-y-4">
          <CheckCircle2 className="h-16 w-16 text-emerald-500 mx-auto" />
          <div>
            <div className="text-xl font-bold">草稿已生成 ✨</div>
            <div className="text-sm text-muted-foreground mt-1">
              下一步：在编辑器配图 / 微调文案，然后立即发布或定时发布
            </div>
          </div>

          {/* 一键模式下的策略简报 */}
          {strategyResult && (
            <div className="text-left bg-muted/30 rounded-lg p-4 space-y-2 text-sm border">
              <div className="font-semibold text-primary flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" /> AI 已为你定制本期内容
              </div>
              <div><strong>主题：</strong>{strategyResult.strategy.theme}</div>
              <div className="text-muted-foreground text-xs">
                <strong className="text-foreground">钩子：</strong>{strategyResult.strategy.hookFormula}
              </div>
              <div className="flex flex-wrap gap-1 pt-1">
                {strategyResult.strategy.hashtags?.slice(0, 6).map((h: string, i: number) => (
                  <Badge key={i} variant="secondary" className="text-xs">{h}</Badge>
                ))}
              </div>
              <div className="text-xs text-muted-foreground pt-1">
                参考 {strategyResult.meta.competitorsAnalyzed} 位同行 · {strategyResult.meta.postsAnalyzed} 条样本
              </div>
            </div>
          )}
          <div className="flex gap-2 justify-center flex-wrap">
            <Link href={`/content/${contentId}`}>
              <Button size="lg"><FileEdit className="h-4 w-4 mr-2" />打开编辑器</Button>
            </Link>
            <Link href="/schedules">
              <Button size="lg" variant="outline"><Send className="h-4 w-4 mr-2" />定时发布</Button>
            </Link>
            <Button variant="ghost" onClick={() => { setStep("setup"); setStrategyResult(null); setContentId(null); setLogs([]); }}>
              再来一条
            </Button>
          </div>
        </Card>
      )}

      {/* 底部辅助：去同行库手动管理 */}
      {step === "setup" && existingCompetitors.length > 0 && (
        <div className="text-xs text-center text-muted-foreground">
          已有 {existingCompetitors.length} 位同行 ·
          <Link href="/competitors" className="underline ml-1">去同行库管理 →</Link>
        </div>
      )}
    </div>
  );
}
