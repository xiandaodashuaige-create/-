import { useState, useRef, useEffect, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePlatform } from "@/lib/platform-context";
import { PLATFORMS, type PlatformId } from "@/lib/platform-meta";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { setReturnToFlow } from "@/lib/return-to-flow";
import { useI18n } from "@/lib/i18n";
import { proxyXhsImage } from "@/lib/image-proxy";
import {
  Sparkles, Loader2, CheckCircle2, ArrowRight, Users2, Brain, FileEdit, Send,
  AlertCircle, Search, RefreshCw, Zap, Rocket, Settings2, ChevronDown,
  Image as ImageIcon, Video as VideoIcon, X, Upload, Wand2, Save,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AssetPicker } from "@/components/AssetPicker";
import { ObjectUploader } from "@workspace/object-storage-web";

type Step = "setup" | "running" | "review" | "edit" | "schedule" | "done";

// 3 套生成 angle —— AI 同时跑 3 次，给用户选
// label/hint 通过 i18n 在运行时查找（labelKey / hintKey）
const STRATEGY_ANGLES: Array<{ key: string; emoji: string; labelKey: string; hintKey: string }> = [
  { key: "tutorial", emoji: "📚", labelKey: "autopilot.angle.tutorial.label", hintKey: "autopilot.angle.tutorial.hint" },
  { key: "emotion", emoji: "💗", labelKey: "autopilot.angle.emotion.label", hintKey: "autopilot.angle.emotion.hint" },
  { key: "contrast", emoji: "⚡", labelKey: "autopilot.angle.contrast.label", hintKey: "autopilot.angle.contrast.hint" },
];
type LogLine = { ts: number; text: string; status: "info" | "success" | "warn" | "error" | "running" };

function nowTs() { return Date.now(); }

// T2：在 done 步骤里一键再排 6 条（连 done 这条 = 7 天闭环）
function BulkCampaignCTA({
  accountId, platform, niche, region,
}: {
  accountId: number;
  platform: PlatformId;
  niche: string;
  region?: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Array<{ dayOffset: number; time: string; title: string; body: string; tags: string[] }> | null>(null);

  async function genPlan() {
    setBusy(true);
    try {
      const r = await api.ai.generateWeeklyPlan({
        platform, niche, region,
        frequency: "daily",
      });
      // 取 7 条草稿的后 6 条（避开第 0 天，留给当前 done 内容），重新映射 dayOffset=0..5
      // 因为 startDate 会用「明天 00:00」作为基准，dayOffset 从 0 起即明天发首条，避免和今天 done 内容撞日
      const items = (r.items ?? [])
        .filter((it) => it.dayOffset >= 1 && it.dayOffset <= 6)
        .slice(0, 6)
        .map((it, idx) => ({
          dayOffset: idx, // 0..5 → 明天起的连续 6 天
          time: it.time || "20:00",
          title: it.title,
          body: it.body,
          tags: it.tags ?? [],
        }));
      if (items.length === 0) {
        toast({ title: "暂无可排期条目", description: "稍后再试或换关键词", variant: "destructive" });
      } else {
        setDraft(items);
      }
    } catch (e: any) {
      toast({ title: "生成排期失败", description: e?.message ?? "未知错误", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!draft || draft.length === 0) return;
    setBusy(true);
    try {
      // 用「明天 00:00」作为 bulk 起点，避免和当前 done 内容撞日
      const tomorrow = new Date();
      tomorrow.setHours(0, 0, 0, 0);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const startDate = tomorrow.toISOString();
      const r = await api.schedules.bulkCreate({
        accountId,
        startDate,
        items: draft,
      });
      const skipped = (r as any).skipped ?? 0;
      toast({
        title: `已排期 ${r.created} 条`,
        description: skipped > 0
          ? `⚠ ${skipped} 条因时间冲突被跳过；请到排期表手动改时间`
          : "可在排期表查看与微调",
        variant: skipped > 0 && r.created === 0 ? "destructive" : undefined,
      });
      qc.invalidateQueries({ queryKey: ["schedules"] });
      setDraft(null);
    } catch (e: any) {
      toast({
        title: "批量排期失败",
        description: e?.message ?? "未知错误",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  if (!draft) {
    return (
      <div className="text-center space-y-2">
        <div className="text-sm text-muted-foreground">想让 AI 一次帮你排满下周 6 天？</div>
        <Button variant="secondary" size="sm" onClick={genPlan} disabled={busy}>
          {busy ? "生成中…" : "AI 生成下周 6 条排期"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">即将创建 {draft.length} 条草稿 + 排期：</div>
      <div className="space-y-1.5 max-h-56 overflow-y-auto">
        {draft.map((it, i) => (
          <div key={i} className="text-xs border rounded p-2 bg-muted/20">
            <div className="font-semibold">D+{it.dayOffset} {it.time} · {it.title}</div>
            <div className="text-muted-foreground line-clamp-2">{it.body}</div>
          </div>
        ))}
      </div>
      <div className="flex gap-2 justify-center">
        <Button size="sm" onClick={commit} disabled={busy}>
          {busy ? "创建中…" : `确认创建 ${draft.length} 条`}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={busy}>
          取消
        </Button>
      </div>
    </div>
  );
}

// 品牌画像 inline 折叠面板（autopilot setup 步内嵌，避免用户必须先去设置页填）
// 强烈建议填好 → AI 周计划/策略生成会读 brandProfilesTable 注入 brandBlock，
// 严守品牌定位 + 禁用宣称（含同义词 / 暗示 / 反问） → 防止草稿踩广告法。
function BrandProfileInlinePanel({ platform }: { platform: PlatformId }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{
    category: string; products: string; targetAudience: string; priceRange: string;
    tone: string; conversionGoal: string; forbiddenClaimsText: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const q = useQuery({
    queryKey: ["brand-profile", platform],
    queryFn: () => api.brandProfile.get(platform),
  });

  // 数据加载后初始化 draft（仅一次）
  useEffect(() => {
    if (q.data && draft === null) {
      setDraft({
        category: q.data.category ?? "",
        products: q.data.products ?? "",
        targetAudience: q.data.targetAudience ?? "",
        priceRange: q.data.priceRange ?? "",
        tone: q.data.tone ?? "",
        conversionGoal: q.data.conversionGoal ?? "",
        forbiddenClaimsText: (q.data.forbiddenClaims ?? []).join("、"),
      });
    } else if (q.data === null && draft === null) {
      setDraft({
        category: "", products: "", targetAudience: "", priceRange: "",
        tone: "", conversionGoal: "", forbiddenClaimsText: "",
      });
    }
  }, [q.data, draft]);

  // 切平台时 reset
  useEffect(() => { setDraft(null); }, [platform]);

  const filledCount = q.data ? [
    q.data.category, q.data.products, q.data.targetAudience,
    q.data.priceRange, q.data.tone, q.data.conversionGoal,
  ].filter((x) => x && String(x).trim().length > 0).length + (q.data.forbiddenClaims?.length ?? 0 > 0 ? 1 : 0) : 0;

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const forbiddenClaims = draft.forbiddenClaimsText
        .split(/[、,，\n;；]+/).map((s) => s.trim()).filter((s) => s.length > 0).slice(0, 50);
      await api.brandProfile.upsert({
        platform,
        category: draft.category || null,
        products: draft.products || null,
        targetAudience: draft.targetAudience || null,
        priceRange: draft.priceRange || null,
        tone: draft.tone || null,
        conversionGoal: draft.conversionGoal || null,
        forbiddenClaims,
      });
      await qc.invalidateQueries({ queryKey: ["brand-profile", platform] });
      toast({ title: "品牌画像已保存", description: "AI 生成时会严格遵守该画像与禁用宣称" });
    } catch (e: any) {
      toast({ title: "保存失败", description: e?.message ?? "未知错误", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border bg-background">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/30 transition rounded-lg"
      >
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-purple-500" />
          <span className="text-sm font-medium">品牌画像</span>
          {filledCount > 0 ? (
            <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-300">
              已填 {filledCount} 项 · AI 会严格遵守
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-300">
              建议填写 · 让 AI 不偏离定位
            </Badge>
          )}
        </div>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && draft && (
        <div className="p-4 pt-0 space-y-3 border-t">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">类目</label>
              <Input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="医美 / 餐饮 / 母婴…" className="text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">商品/服务</label>
              <Input value={draft.products} onChange={(e) => setDraft({ ...draft, products: e.target.value })} placeholder="如：面部骨雕、私厨菜单" className="text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">目标受众</label>
              <Input value={draft.targetAudience} onChange={(e) => setDraft({ ...draft, targetAudience: e.target.value })} placeholder="25-40 女性 / 高净值 / 宝妈…" className="text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">价位带</label>
              <Input value={draft.priceRange} onChange={(e) => setDraft({ ...draft, priceRange: e.target.value })} placeholder="2k-5k / 高端" className="text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">品牌调性</label>
              <Input value={draft.tone} onChange={(e) => setDraft({ ...draft, tone: e.target.value })} placeholder="专业冷静 / 温暖治愈 / 反差幽默" className="text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block text-muted-foreground">转化目标</label>
              <Input value={draft.conversionGoal} onChange={(e) => setDraft({ ...draft, conversionGoal: e.target.value })} placeholder="预约咨询 / 私信 / 进店" className="text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block text-muted-foreground">
              禁用宣称（绝对不能出现，含同义词/暗示/反问）
            </label>
            <Textarea
              value={draft.forbiddenClaimsText}
              onChange={(e) => setDraft({ ...draft, forbiddenClaimsText: e.target.value })}
              placeholder="如：最有效、根治、立刻见效、医保报销 —— 用、或换行分隔"
              rows={2}
              className="text-sm"
            />
            <div className="text-[10px] text-muted-foreground mt-1">最多 50 个，每个 ≤ 100 字</div>
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={save} disabled={saving} className="gap-1">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              保存品牌画像
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AutopilotPage() {
  const { activePlatform } = usePlatform();
  const platform = activePlatform as PlatformId;
  const platformMeta = PLATFORMS[platform];
  const { toast } = useToast();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();

  // 小红书有自己的原生向导（/workflow），autopilot 是给 TikTok/IG/FB 的统一流水线。
  // XHS 在这个页面要直接跳回老向导，不走"统一一键"那套（市场数据/同行池/业务身份选择器）。
  // ⚠ 用 useEffect 而不是条件 early-return，否则切平台时 hook 数量变化会崩 React。
  useEffect(() => {
    if (platform === "xhs") setLocation("/workflow");
  }, [platform, setLocation]);

  const [step, setStep] = useState<Step>("setup");
  // HMR 保护：旧版本可能残留 step="approved" 等已删除值，启动时归一化
  useEffect(() => {
    const valid: Step[] = ["setup", "running", "review", "edit", "schedule", "done"];
    if (!valid.includes(step)) setStep("setup");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 草稿就地编辑表单（采用方案后从 content.get 拉一份填进来）
  const [editForm, setEditForm] = useState<{
    title: string; body: string; tags: string[]; tagInput: string;
    imageUrls: string[]; videoUrl: string;
  }>({ title: "", body: "", tags: [], tagInput: "", imageUrls: [], videoUrl: "" });
  const [savingEdit, setSavingEdit] = useState(false);
  const [regeneratingImg, setRegeneratingImg] = useState(false);
  const [niche, setNiche] = useState("");
  const [region, setRegion] = useState("");
  const [extras, setExtras] = useState("");
  // 用户手动指定的同行账号 / 主页链接（一行一个或逗号分隔）
  // —— 跟 XHS workflow 的 competitorLink 输入对齐，让客户能精准锚定要参考谁
  const [customCompetitors, setCustomCompetitors] = useState("");
  // TT/IG 视频平台：是否让 AI 一并产出视频脚本（hook + 分镜 + 字幕 + 封面字）
  // 默认开（仅视频平台默认 true，FB 默认 false 因为 FB 多图文）
  // 用户手动改过之后就不再随 platform 切换覆盖，避免吞掉用户的选择
  const [wantVideoScript, setWantVideoScript] = useState(platform === "tiktok" || platform === "instagram");
  const videoScriptTouchedRef = useRef(false);
  useEffect(() => {
    if (videoScriptTouchedRef.current) return;
    setWantVideoScript(platform === "tiktok" || platform === "instagram");
  }, [platform]);
  const [autoDiscover, setAutoDiscover] = useState(true);
  const [customMode, setCustomMode] = useState(false);
  const customModeRef = useRef(false);
  // 多账号场景：用户必须明确选定"本次 AI 用哪个业务身份"，
  // 否则草稿会被绑到 backend 默认（前 5 个全用），用户无法预知归属
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  // 3 套候选策略（按 STRATEGY_ANGLES 顺序，可能含 null 如果某条生成失败）
  const [strategyOptions, setStrategyOptions] = useState<Array<any | null>>([]);
  const [selectedStrategyIdx, setSelectedStrategyIdx] = useState<number | null>(null);
  const [contentId, setContentId] = useState<number | null>(null);
  // 排期相关
  const [scheduledAt, setScheduledAt] = useState<string>("");  // datetime-local 字符串
  const [scheduling, setScheduling] = useState(false);
  // 兼容老逻辑（review 详情视图引用）：选中那条
  const strategyResult = selectedStrategyIdx !== null ? strategyOptions[selectedStrategyIdx] : null;
  const [logs, setLogs] = useState<LogLine[]>([]);
  // 市场洞察 + 同行样本汇总（在审策略页展示）
  const [marketInsights, setMarketInsights] = useState<{
    trendingItems: Array<{ id: string; title: string; likes?: number; views?: number; hashtags?: string[]; thumbnailUrl?: string }>;
    trendingSource: string;
    bestTimes: { bestHours: number[]; bestDays: string[]; insight: string } | null;
    competitors: Array<{ id: number; handle: string; nickname?: string; postCount?: number }>;
    totalSamples: number;
  } | null>(null);
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
  const meQ = useQuery({ queryKey: ["me"], queryFn: () => api.user.me() });
  const isPro = meQ.data?.plan === "pro";

  // Sora 高清电影级视频生成（仅 Pro 用户）
  const [soraJobId, setSoraJobId] = useState<string | null>(null);
  const [soraStatus, setSoraStatus] = useState<string | null>(null);
  const [soraProgress, setSoraProgress] = useState(0);
  const soraGenerating = soraJobId != null && soraStatus !== "succeeded" && soraStatus !== "failed";

  useEffect(() => {
    if (!soraJobId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await api.ai.videoJob(soraJobId);
        if (cancelled) return;
        setSoraStatus(r.status);
        setSoraProgress(r.progress);
        if (r.status === "succeeded" && r.result?.videoUrl) {
          setEditForm((p) => ({ ...p, videoUrl: r.result!.videoUrl }));
          toast({ title: "Sora 高清视频已生成 ✨", description: `时长 ${r.result.durationSec}s · 已自动填入视频区` });
          setSoraJobId(null);
        } else if (r.status === "failed") {
          toast({ title: "Sora 生成失败，已自动退还 250 积分", description: r.error?.slice(0, 200) ?? "未知错误", variant: "destructive" });
          setSoraJobId(null);
        }
      } catch (err: any) {
        if (cancelled) return;
        // 轮询失败先不打断，继续重试
        // eslint-disable-next-line no-console
        console.warn("[sora poll] failed:", err?.message);
      }
    };
    void tick();
    const id = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [soraJobId]);

  async function handleGenerateSora() {
    if (!isPro) {
      toast({
        title: "仅 Pro 套餐可用",
        description: "Sora 高清电影级视频是 Pro 专享功能，请联系顾问升级套餐。",
        variant: "destructive",
      });
      return;
    }
    if (!editForm.title && !editForm.body) {
      toast({ title: "请先填写标题或正文", description: "Sora 需要文案作为画面 prompt", variant: "destructive" });
      return;
    }
    if (!confirm("本次将消耗 250 积分（≈ 43 元）生成 1080P 12 秒高清电影级视频。\n生成约需 2-5 分钟，失败会自动退款。\n\n确认继续？")) return;
    try {
      const r = await api.ai.generateVideoSora({
        platform,
        newTopic: editForm.title || editForm.body.slice(0, 60),
        newTitle: editForm.title || undefined,
        newKeyPoints: editForm.body ? [editForm.body.slice(0, 200)] : undefined,
        niche: niche || null,
        region: region || null,
        mimicStrength: "partial",
      });
      setSoraJobId(r.jobId);
      setSoraStatus(r.status);
      setSoraProgress(0);
      toast({ title: r.deduplicated ? "已有进行中的视频任务" : "Sora 高清视频任务已入队", description: r.message });
    } catch (err: any) {
      toast({ title: "Sora 任务创建失败", description: err?.message ?? "请稍后重试", variant: "destructive" });
    }
  }

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
    if (!stillExists) {
      // 优先选已授权账号；防止默认落到未 OAuth 的占位账号导致 schedule 步被后端 isAccountReadyToPublish 拦下
      const ready = list.find((a: any) =>
        a.platform === "xhs" ||
        a.authStatus === "authorized" ||
        (a.ayrshareProfileKey && String(a.ayrshareProfileKey).length > 0)
      );
      setSelectedAccountId((ready ?? list[0]).id);
    }
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
    // 用 ref 里写死的最终 niche，避开 setNiche 异步更新导致的闭包陈旧
    // （用户可能在 fit-check 弹窗里改用了 AI 推荐的 niche，但 React state 还没刷到这次闭包里）
    const niche = finalNicheRef.current || (() => { throw new Error("finalNicheRef not set"); })();

    setLogs([]);
    setStep("running");
    setStrategyOptions([]);
    setSelectedStrategyIdx(null);
    setContentId(null);
    setMarketInsights(null);

    try {
      pushLog(`🚀 启动 ${platformMeta.name} AI 自动驾驶`, "info");
      pushLog(`目标行业：${niche}${region ? ` · 地区：${region}` : ""}`, "info");

      // ── Stage 1: 市场洞察 ──（拉行业热门内容 + 本平台最佳发布时间）
      pushLog(`📊 拉取 ${platformMeta.name} 行业「${niche}」市场热门数据…`, "running");
      let trendingItems: any[] = [];
      let trendingSource = "mock";
      let bestTimes: { bestHours: number[]; bestDays: string[]; insight: string } | null = null;
      // 用 allSettled：trending / bestTimes 单点失败不互相拖累
      const [trendSettled, btSettled] = await Promise.allSettled([
        api.marketData.trending(platform, niche, region || "MY"),
        api.marketData.bestTimes(),
      ]);
      if (isStale()) return;
      if (trendSettled.status === "fulfilled") {
        trendingItems = trendSettled.value.items ?? [];
        trendingSource = trendSettled.value.source ?? "mock";
        const topHashtagsAll = trendingItems.flatMap((i) => i.hashtags ?? []).filter(Boolean);
        const hashtagFreq: Record<string, number> = {};
        topHashtagsAll.forEach((h: string) => { hashtagFreq[h] = (hashtagFreq[h] ?? 0) + 1; });
        const topHashtags = Object.entries(hashtagFreq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([h]) => h);
        pushLog(`✓ 市场数据：${trendingItems.length} 条热门内容（来源 ${trendingSource}）`, "success");
        if (topHashtags.length > 0) pushLog(`  · 高频标签：${topHashtags.map(h => "#" + h).join("、")}`, "info");
      } else {
        pushLog(`⚠ 市场热门拉取失败：${(trendSettled.reason as any)?.message ?? "skip"}`, "warn");
      }
      if (btSettled.status === "fulfilled") {
        bestTimes = (btSettled.value as any)[platform] ?? null;
        if (bestTimes) {
          const src = (bestTimes as any).source as string | undefined;
          const srcTag = src === "real" ? "🟢 真实数据" : src === "fallback" ? "🟡 经验回退" : src === "mock" ? "⚪ 示例" : "";
          pushLog(`  · 最佳发布时段：${bestTimes.bestHours.map(h => `${h}:00`).join("、")} — ${bestTimes.insight}${srcTag ? ` [${srcTag}]` : ""}`, "info");
        }
      } else {
        pushLog(`⚠ 最佳发布时段拉取失败：${(btSettled.reason as any)?.message ?? "skip"}`, "warn");
      }

      if (isStale()) return;

      // ── Stage 2: 同行库 ──
      let competitorPool = [...existingCompetitors];

      // (a) 优先处理用户手动填写的同行账号 / 主页链接
      // 解析规则：按逗号 / 换行 / 空格切；从 URL 抽 handle（认 path 第一段，过滤 reel/p/share/video 等保留路径）
      const RESERVED_PATHS = new Set([
        "reel","reels","p","tv","stories","explore","share","video","videos","watch","groups","pages","photo","photos","posts","story","direct","accounts","tag","tags","hashtag","music","discover","trending","foryou","following",
      ]);
      const seenLower = new Set<string>();
      const existingLower = new Set(competitorPool.map((c: any) => (c.handle || "").toLowerCase()));
      const manualHandles = customCompetitors
        .split(/[\s,，\n]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((raw) => {
          // 优先尝试当 URL 解析
          let candidate: string | null = null;
          if (/^https?:\/\//i.test(raw) || /(tiktok|instagram|facebook|fb)\.com/i.test(raw)) {
            try {
              const u = new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`);
              const seg = u.pathname.split("/").filter(Boolean);
              if (seg.length > 0) {
                let first = seg[0].replace(/^@/, "");
                // 第一段是 reel/p/share 等保留词时，不可作为 handle
                if (RESERVED_PATHS.has(first.toLowerCase())) candidate = null;
                else candidate = first;
              }
            } catch { /* 不是合法 URL，按裸 handle 处理 */ }
          }
          if (!candidate) {
            candidate = raw.replace(/^@+/, "").replace(/[/?#].*$/, "");
          }
          return candidate;
        })
        .filter((h): h is string => !!h && /^[A-Za-z0-9._-]{1,60}$/.test(h))
        .filter((h) => {
          const lo = h.toLowerCase();
          if (seenLower.has(lo) || existingLower.has(lo)) return false;
          seenLower.add(lo);
          return true;
        });

      if (manualHandles.length > 0) {
        pushLog(`👤 你指定了 ${manualHandles.length} 位同行：${manualHandles.slice(0, 3).map((h) => "@" + h).join("、")}${manualHandles.length > 3 ? "…" : ""}`, "info");
        for (const handle of manualHandles) {
          if (isStale()) return;
          try {
            pushLog(`  ↳ 添加并抓取 @${handle} 最近爆款…`, "running");
            const added = await api.competitors.add({ platform, handle, region: region || undefined }, { signal: sig });
            if (isStale()) return;
            competitorPool.push(added);
            pushLog(`  ✓ @${handle} 已入库（${added.postCount ?? 0} 条样本）`, "success");
          } catch (e: any) {
            if (sig.aborted) return;
            pushLog(`  ⚠ @${handle} 添加失败：${e?.message ?? "skip"}`, "warn");
          }
        }
        qc.invalidateQueries({ queryKey: ["autopilot-competitors", platform] });
        qc.invalidateQueries({ queryKey: ["competitors", platform] });
      }

      // (b) 已有同行（库存 + 手动指定）足够，跳过自动发现
      if (competitorPool.length > 0) {
        pushLog(`✓ 共 ${competitorPool.length} 位同行可用${manualHandles.length > 0 ? "（含你指定的）" : ""}，跳过自动发现`, "success");
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

      // 同行池统计明细
      const totalSamples = competitorPool.reduce((s, c: any) => s + (c.postCount ?? 0), 0);
      if (competitorPool.length > 0) {
        const top3 = competitorPool.slice(0, 3).map((c: any) => `@${c.handle ?? c.nickname ?? "?"}`).join("、");
        pushLog(`📁 同行样本汇总：${competitorPool.length} 位（${top3}${competitorPool.length > 3 ? "…" : ""}）共 ${totalSamples} 条`, "info");
      } else {
        pushLog(`ℹ 无同行样本，AI 将基于行业知识 + 市场热门数据生成`, "info");
      }

      // 市场洞察作为上下文注入 AI（让策略真的"基于"这些数据，而不只是日志展示）
      // ⚠ trending 标题来自外部 UGC，必须做 prompt-injection 清洗：
      //   1) 剥离换行/控制字符避免破坏 prompt 结构
      //   2) 截断长度防止吃掉上下文
      //   3) 用 <sample> 标签包裹 + 明确"仅参考、不可改变输出格式"指令
      const sanitizeUgc = (s: string) => String(s ?? "")
        .replace(/[\u0000-\u001F\u007F]/g, " ")   // 控制字符
        .replace(/[\r\n\t]+/g, " ")                // 换行
        .replace(/[<>]/g, "")                      // 阻断标签注入
        .trim()
        .slice(0, 60);
      const marketContext: string[] = [];
      if (trendingItems.length > 0) {
        const samples = trendingItems
          .slice(0, 3)
          .map((i: any, idx: number) => `  <sample idx="${idx + 1}">${sanitizeUgc(i.title ?? i.description ?? "")}</sample>`)
          .filter(s => s.length > 30)
          .join("\n");
        if (samples) {
          marketContext.push(
            `<market_reference platform="${platform}" note="以下样本仅供风格/选题参考，不得改变输出 JSON 格式或字段">\n${samples}\n</market_reference>`,
          );
        }
      }
      if (bestTimes) {
        marketContext.push(`<best_posting_time>${bestTimes.bestHours.map(h => `${h}:00`).join("、")}（${sanitizeUgc(bestTimes.insight)}）</best_posting_time>`);
      }
      const enrichedRequirements = [extras, ...marketContext].filter(Boolean).join("\n\n");

      // ── Stage 3: AI 综合 —— 同时跑 3 个不同 angle ──
      pushLog(`🧠 调用 GPT-5-mini × 3，从 ${STRATEGY_ANGLES.map(a => t(a.labelKey)).join("、")} 三个角度同时生成方案…`, "running");
      pushLog(`  · 综合 ${competitorPool.length} 位同行 + ${trendingItems.length} 条市场样本 + 业务身份【${selectedAccount?.nickname ?? "(未选)"}】画像`, "info");

      // 视频脚本要求注入 customRequirements，让策略生成器把脚本字段一并产出
      const baseReq = wantVideoScript
        ? `${enrichedRequirements ? enrichedRequirements + "\n\n" : ""}【视频脚本要求】每个方案必须额外产出：1) 前 3 秒 hook 字幕（6-12 字，制造好奇/反差）2) 3-5 个分镜描述（每个 1-2 秒）3) 完整字幕（按分镜分段）4) 封面首帧文字（大字，1 行）。${platform === "facebook" ? "" : "竖版 9:16。"}`
        : (enrichedRequirements || "");

      const stratPromises = STRATEGY_ANGLES.map((angle) =>
        api.strategy.generate({
          platform,
          region: region || undefined,
          niche: niche || undefined,
          accountIds: selectedAccountId ? [selectedAccountId] : undefined,
          customRequirements: `${baseReq}\n\n【本方案角度 - ${t(angle.labelKey)}】${t(angle.hintKey)}`.trim(),
        }, { signal: sig }),
      );
      const stratSettled = await Promise.allSettled(stratPromises);
      if (isStale()) return;

      const opts: Array<any | null> = stratSettled.map((s, i) => {
        if (s.status === "fulfilled") {
          const v = s.value as any;
          v._angleKey = STRATEGY_ANGLES[i].key;
          v._angleLabel = t(STRATEGY_ANGLES[i].labelKey);
          v._angleEmoji = STRATEGY_ANGLES[i].emoji;
          pushLog(`  ✓ ${STRATEGY_ANGLES[i].emoji} ${t(STRATEGY_ANGLES[i].labelKey)}：${v.strategy.theme}`, "success");
          return v;
        } else {
          pushLog(`  ⚠ ${STRATEGY_ANGLES[i].emoji} ${t(STRATEGY_ANGLES[i].labelKey)} 失败：${(s.reason as any)?.message ?? "skip"}`, "warn");
          return null;
        }
      });
      const okCount = opts.filter(Boolean).length;
      if (okCount === 0) {
        pushLog(`❌ 全部 3 个方案均失败，请稍后重试`, "error");
        toast({ title: t("autopilot.toast.aiFail"), description: t("autopilot.toast.aiFailDesc"), variant: "destructive" });
        setStep("setup");
        return;
      }
      pushLog(`✓ 共 ${okCount}/3 个方案就绪${customModeRef.current ? "，请挑选" : "（一键模式将自动选最优）"}`, "success");

      setStrategyOptions(opts);
      setSelectedStrategyIdx(null);
      setMarketInsights({
        trendingItems: trendingItems.slice(0, 6),
        trendingSource,
        bestTimes,
        competitors: competitorPool.map((c: any) => ({
          id: c.id, handle: c.handle, nickname: c.nickname, postCount: c.postCount,
        })),
        totalSamples,
      });

      // 推荐发布时间预填（取本地下一个最佳时段）
      let prefillIso: string | null = null;
      if (bestTimes?.bestHours?.length) {
        const now = new Date();
        const target = new Date(now);
        const sorted = [...bestTimes.bestHours].sort((a, b) => a - b);
        let pickHour = sorted.find((h) => h > now.getHours() + 1) ?? sorted[0];
        if (pickHour <= now.getHours() + 1) target.setDate(target.getDate() + 1);
        target.setHours(pickHour, 0, 0, 0);
        // 转 datetime-local 字符串（YYYY-MM-DDTHH:mm，本地时区）
        const pad = (n: number) => String(n).padStart(2, "0");
        setScheduledAt(`${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T${pad(target.getHours())}:${pad(target.getMinutes())}`);
        prefillIso = target.toISOString();
      }

      // 一键模式：自动选第一个存活方案 → approve → 自动排到推荐时间 → done
      if (!customModeRef.current) {
        const firstIdx = opts.findIndex((o) => o);
        if (firstIdx >= 0) {
          setSelectedStrategyIdx(firstIdx);
          pushLog(`🤖 一键模式：自动采用 ${STRATEGY_ANGLES[firstIdx].emoji} ${t(STRATEGY_ANGLES[firstIdx].labelKey)} 方案`, "info");
          try {
            const approved = await api.strategy.approve(opts[firstIdx].id);
            if (isStale()) return;
            setContentId(approved.contentId);
            qc.invalidateQueries({ queryKey: ["content"] });
            pushLog(`✓ 草稿 #${approved.contentId} 已生成`, "success");

            if (prefillIso && new Date(prefillIso).getTime() > Date.now()) {
              pushLog(`📅 自动排期：${new Date(prefillIso).toLocaleString()}`, "running");
              try {
                await api.content.schedule(approved.contentId, prefillIso);
                if (isStale()) return;
                qc.invalidateQueries({ queryKey: ["schedules"] });
                pushLog(`✓ 已排入计划`, "success");
                setStep("done");
                toast({ title: t("autopilot.toast.oneClickDone"), description: `${t("autopilot.edit.draftReadyPrefix")}${approved.contentId} ${t("autopilot.toast.oneClickDoneMiddle")} ${new Date(prefillIso).toLocaleString()}` });
                return;
              } catch (e: any) {
                if (sig.aborted || isStale()) return;
                pushLog(`⚠ 自动排期失败：${e?.message ?? "请手动排期"}`, "warn");
                setStep("schedule"); // 退回排期步骤让用户手动确认
                return;
              }
            } else {
              setStep("schedule"); // 没有推荐时间，停在排期让用户挑
              return;
            }
          } catch (e: any) {
            if (sig.aborted || isStale()) return;
            pushLog(`⚠ 自动批准失败：${e?.message ?? "请手动选方案"}`, "warn");
            // fall through to review
          }
        }
      }

      setStep("review");
    } catch (err: any) {
      if (sig.aborted || isStale()) return;
      pushLog(`❌ 失败：${err?.message ?? "未知错误"}`, "error");
      toast({ title: t("autopilot.toast.pipelineAbort"), description: err?.message ?? t("common.error"), variant: "destructive" });
      setStep("setup");
    }
  }

  // Cleanup: abort on unmount
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  // 把 contentId 对应的草稿拉下来灌进 editForm；失败抛错，由调用方决定是否继续
  async function loadContentIntoEditForm(cid: number) {
    const c = await api.content.get(cid);
    setEditForm({
      title: c.title || "",
      body: c.body || "",
      tags: Array.isArray(c.tags) ? c.tags : [],
      tagInput: "",
      imageUrls: Array.isArray(c.imageUrls) ? c.imageUrls : [],
      videoUrl: c.videoUrl || "",
    });
  }

  const approveMut = useMutation({
    mutationFn: (stratId: number) => api.strategy.approve(stratId),
    onSuccess: async (data) => {
      setContentId(data.contentId);
      qc.invalidateQueries({ queryKey: ["content"] });
      try {
        await loadContentIntoEditForm(data.contentId);
        setStep("edit"); // 进就地编辑步骤，不再直接跳排期
        toast({ title: t("autopilot.toast.adopted"), description: `${t("autopilot.edit.draftReadyPrefix")}${data.contentId} ${t("autopilot.toast.adoptedDescSuffix")}` });
      } catch (e: any) {
        // 拉草稿失败：不进 edit 空表单，退回 schedule 兜底
        toast({ title: t("autopilot.toast.draftLoadFail"), description: `${e?.message ?? t("common.error")} ${t("autopilot.toast.draftLoadFailSuffix")}`, variant: "destructive" });
        setStep("schedule");
      }
    },
    onError: (err: any) => toast({ title: t("autopilot.toast.adoptFail"), description: err?.message, variant: "destructive" }),
  });

  // 保存就地修改 → 进排期
  async function handleSaveEditAndProceed() {
    if (!contentId) return;
    if (savingEdit) return;
    setSavingEdit(true);
    try {
      // 后端 UpdateContentBody 不接受 null —— videoUrl 为空时直接省略字段
      const payload: any = {
        title: editForm.title,
        body: editForm.body,
        tags: editForm.tags,
        imageUrls: editForm.imageUrls,
      };
      if (editForm.videoUrl) payload.videoUrl = editForm.videoUrl;
      await api.content.update(contentId, payload);
      qc.invalidateQueries({ queryKey: ["content"] });
      toast({ title: t("autopilot.toast.saved"), description: t("autopilot.toast.savedDesc") });
      setStep("schedule");
    } catch (e: any) {
      toast({ title: t("autopilot.toast.saveFail"), description: e?.message, variant: "destructive" });
    } finally {
      setSavingEdit(false);
    }
  }

  // AI 重新生成一张配图，加到 imageUrls 头部
  async function handleRegenImageInEdit() {
    if (regeneratingImg) return;
    setRegeneratingImg(true);
    try {
      const prompt = `${niche || ""} 平台 ${platformMeta.name} · 主题：${editForm.title || strategyResult?.strategy?.theme || ""}`;
      const r = await api.ai.generateImage({ prompt });
      const url = (r as any).storedUrl || (r as any).imageUrl;
      if (url) {
        setEditForm((p) => ({ ...p, imageUrls: [url, ...p.imageUrls].slice(0, 9) }));
        toast({ title: t("autopilot.toast.imgGenerated") });
      }
    } catch (e: any) {
      toast({ title: t("autopilot.toast.aiFail"), description: e?.message, variant: "destructive" });
    } finally {
      setRegeneratingImg(false);
    }
  }

  // 上传素材：拿预签名 PUT URL
  async function handleGetUploadParameters(file: any) {
    const res = await fetch("/api/storage/uploads/request-url", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
    });
    if (!res.ok) throw new Error("Failed to get upload URL");
    const data = await res.json();
    (file as any)._objectPath = data.objectPath;
    return { method: "PUT" as const, url: data.uploadURL, headers: { "Content-Type": file.type } };
  }
  function handleImageUploadComplete(result: any) {
    const files = result.successful || [];
    for (const file of files) {
      const objectPath = (file as any)._objectPath;
      if (objectPath) {
        const url = `/api/storage${objectPath}`;
        setEditForm((p) => ({ ...p, imageUrls: [...p.imageUrls, url].slice(0, 9) }));
      }
    }
    if (files.length > 0) toast({ title: `${t("autopilot.toast.imgUploadDonePrefix")} ${files.length} ${t("autopilot.toast.imgUploadDoneSuffix")}` });
  }
  function handleVideoUploadComplete(result: any) {
    const files = result.successful || [];
    const file = files[0];
    if (file) {
      const objectPath = (file as any)._objectPath;
      if (objectPath) {
        setEditForm((p) => ({ ...p, videoUrl: `/api/storage${objectPath}` }));
        toast({ title: t("autopilot.toast.videoUploaded") });
      }
    }
  }
  function addTag() {
    const t = editForm.tagInput.trim().replace(/^#/, "");
    if (!t) return;
    if (editForm.tags.includes(t)) { setEditForm((p) => ({ ...p, tagInput: "" })); return; }
    setEditForm((p) => ({ ...p, tags: [...p.tags, t].slice(0, 12), tagInput: "" }));
  }

  // 排期：把已生成的草稿挂到指定时间
  const scheduleMut = useMutation({
    mutationFn: ({ id, iso }: { id: number; iso: string }) => api.content.schedule(id, iso),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedules"] });
      qc.invalidateQueries({ queryKey: ["content"] });
      setStep("done");
      toast({ title: t("autopilot.toast.scheduled"), description: t("autopilot.toast.scheduledDesc") });
    },
    onError: (err: any) => toast({ title: t("autopilot.toast.scheduleFail"), description: err?.message, variant: "destructive" }),
  });

  function handleAdoptStrategy(idx: number) {
    if (approveMut.isPending) return; // 硬防抖：避免双击发起多次 approve 产生重复 content
    const opt = strategyOptions[idx];
    if (!opt) return;
    setSelectedStrategyIdx(idx);
    approveMut.mutate(opt.id);
  }

  function handleScheduleNow() {
    if (scheduling || scheduleMut.isPending) return; // 硬防抖：避免重复排期
    if (!contentId || !scheduledAt) {
      toast({ title: t("autopilot.toast.pickTime"), variant: "destructive" });
      return;
    }
    // datetime-local → ISO
    const d = new Date(scheduledAt);
    if (isNaN(d.getTime()) || d.getTime() <= Date.now() - 30_000) {
      toast({ title: t("autopilot.toast.timeMustFuture"), variant: "destructive" });
      return;
    }
    setScheduling(true);
    scheduleMut.mutate({ id: contentId, iso: d.toISOString() }, {
      onSettled: () => setScheduling(false),
    });
  }

  function toLocalInputString(d: Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // 基于同行 bestHours / bestDays 生成 5 个候选发布时段（按时间近→远排序）
  // bestDays: ["Wednesday","Friday",...] 英文全称（marketData 后端返回格式）；同时容错 3 字母缩写
  const WEEKDAY_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const WEEKDAY_MAP: Record<string, number> = {
    Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const recommendedSlots = useMemo(() => {
    const bt = marketInsights?.bestTimes;
    const bestHoursRaw = bt?.bestHours?.length ? bt.bestHours : [12, 19, 21]; // 兜底通用时段
    const bestHours = [...new Set(bestHoursRaw)].sort((a, b) => a - b);
    const bestDaySet = new Set((bt?.bestDays ?? []).map((d) => WEEKDAY_MAP[d]).filter((d) => d !== undefined));
    const now = Date.now();
    const minTime = now + 15 * 60 * 1000; // 至少 15 分钟后
    const slots: Array<{ key: string; dt: Date; iso: string; localInput: string; primary: string; reason: string; isPeak: boolean }> = [];
    for (let dayOffset = 0; dayOffset < 7 && slots.length < 5; dayOffset++) {
      const base = new Date();
      base.setDate(base.getDate() + dayOffset);
      const isPeakDay = bestDaySet.size === 0 || bestDaySet.has(base.getDay());
      for (const h of bestHours) {
        if (slots.length >= 5) break;
        const d = new Date(base);
        d.setHours(h, 0, 0, 0);
        if (d.getTime() < minTime) continue;
        const dayLabel = dayOffset === 0 ? "今天" : dayOffset === 1 ? "明天" : dayOffset === 2 ? "后天" : WEEKDAY_CN[d.getDay()];
        const hourLabel = `${String(h).padStart(2, "0")}:00`;
        const reason = bt?.bestHours?.includes(h)
          ? `同行该时段流量最高${isPeakDay && bestDaySet.size > 0 ? " · 高峰日" : ""}`
          : "通用建议时段";
        slots.push({
          key: `${dayOffset}-${h}`,
          dt: d, iso: d.toISOString(), localInput: toLocalInputString(d),
          primary: `${dayLabel} ${hourLabel}`,
          reason,
          isPeak: bt?.bestHours?.includes(h) === true && (isPeakDay || bestDaySet.size === 0),
        });
      }
    }
    return slots;
  }, [marketInsights?.bestTimes]);

  // 进入 done 步时，若 editForm 还没填（一键模式从没经过 edit 步），主动拉一次内容回填
  // —— 否则 done 页只能看到干巴巴的策略文字，看不到真实标题/正文/封面/视频
  useEffect(() => {
    if (step === "done" && contentId && !editForm.title && !editForm.imageUrls.length && !editForm.videoUrl) {
      loadContentIntoEditForm(contentId).catch(() => {/* 静默失败：done 页只少一块预览，不影响主流程 */});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, contentId]);

  // 进入 schedule 步时，无论 runPipeline 之前是否已 prefill，都强制重置为第一张推荐卡
  // —— 这样用户视觉上看到的「已选中卡片」和实际 scheduledAt 始终一致；
  // 用 ref 跟踪「上一帧 step」做单次触发，避免在 schedule 步内反复覆盖用户手选
  const prevStepRef = useRef<typeof step>(step);
  useEffect(() => {
    if (step === "schedule" && prevStepRef.current !== "schedule" && recommendedSlots[0]) {
      setScheduledAt(recommendedSlots[0].localInput);
    }
    prevStepRef.current = step;
  }, [step, recommendedSlots]);

  const [customTimeOpen, setCustomTimeOpen] = useState(false);

  function resetAll() {
    setStep("setup");
    setStrategyOptions([]);
    setSelectedStrategyIdx(null);
    setContentId(null);
    setLogs([]);
    setScheduledAt("");
    setEditForm({ title: "", body: "", tags: [], tagInput: "", imageUrls: [], videoUrl: "" });
  }

  // 账号画像 vs niche 一致性校验（弹窗状态）
  const [fitDialog, setFitDialog] = useState<{
    open: boolean;
    fit: number;
    suggestedNiche: string;
    reason: string;
    accountSummary: string;
  } | null>(null);
  const [checkingFit, setCheckingFit] = useState(false);

  // 真正启动流水线（已通过/绕过画像校验后调）
  // 用 ref 把最终 niche 写到 runPipeline 能直接读到的位置，避免 setNiche 的 React 异步更新导致 runPipeline 闭包读到旧值
  const finalNicheRef = useRef<string>("");
  function startPipelineWith(finalNiche: string) {
    customModeRef.current = customMode;
    finalNicheRef.current = finalNiche;
    if (finalNiche !== niche) setNiche(finalNiche); // 同步 UI 显示
    runPipeline();
  }

  async function handleStart() {
    if (!hasAccounts) {
      toast({
        title: `${t("autopilot.toast.needAccountPrefix")} ${platformMeta.name} ${t("autopilot.toast.needAccountSuffix")}`,
        description: t("autopilot.toast.needAccountDesc"),
        variant: "destructive",
      });
      return;
    }
    // 显式校验：必须有效选定一个业务身份，避免账号 effect race 期间提交导致后端走"前 5 个全用"默认
    if (!selectedAccount) {
      toast({
        title: t("autopilot.toast.needIdentity"),
        description: t("autopilot.toast.needIdentityDesc"),
        variant: "destructive",
      });
      return;
    }
    if (!niche.trim()) {
      toast({ title: t("autopilot.toast.needNiche"), variant: "destructive" });
      return;
    }

    // 一致性校验：账号画像 vs 本次 niche；fit < 0.5 弹窗确认
    setCheckingFit(true);
    try {
      const fitRes = await api.ai.checkNicheFit({ accountId: selectedAccount.id, niche: niche.trim() });
      if (fitRes.fit < 0.5 && fitRes.hasHistory) {
        setFitDialog({
          open: true,
          fit: fitRes.fit,
          suggestedNiche: fitRes.suggestedNiche,
          reason: fitRes.reason,
          accountSummary: fitRes.accountSummary,
        });
        return; // 等用户在弹窗里选
      }
    } catch (err) {
      // 校验本身失败不能阻塞主流程，正常往下走
      console.warn("niche-fit check failed, proceeding anyway", err);
    } finally {
      setCheckingFit(false);
    }

    startPipelineWith(niche.trim());
  }

  // FB / IG 自动驾驶尚未真正接入（platform endpoints + onboarding 流水线 only XHS+TikTok adapted）。
  // 不能让用户走完 4 步流程到最后失败 → 在入口直接拦截显示 Coming Soon 占位。
  // 用 boolean 中转避免 TS narrow 影响下游 platform 比较
  const isAutopilotUnsupported: boolean = (platform as string) === "facebook" || (platform as string) === "instagram";
  if (isAutopilotUnsupported) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center">
            <Rocket className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t("autopilot.header.title")} · {platformMeta.name}</h1>
            <p className="text-sm text-muted-foreground">{t("autopilot.header.desc")}</p>
          </div>
        </div>
        <Card className="p-8 text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-muted">
            <Rocket className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-xl font-bold">{platformMeta.name} 自动驾驶 · Coming Soon</h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
              {platformMeta.name} 的一键养号流水线（市场分析 → 内容生成 → 自动发布）尚未上线。
              目前可使用<Link href="/workflow" className="underline mx-1 text-primary">小红书自动创作</Link>
              或<Link href="/content" className="underline mx-1 text-primary">手动创建 {platformMeta.name} 内容</Link>。
            </p>
          </div>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={() => setLocation("/dashboard")}>返回仪表盘</Button>
            <Button onClick={() => setLocation("/content")}>去内容管理</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center">
          <Rocket className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{t("autopilot.header.title")} · {platformMeta.name}</h1>
          <p className="text-sm text-muted-foreground">
            {t("autopilot.header.desc")}
          </p>
        </div>
      </div>

      {/* 进度 */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-2">
          {[
            { key: "setup", label: t("autopilot.step.setup"), icon: FileEdit },
            { key: "running", label: t("autopilot.step.running"), icon: Brain },
            { key: "review", label: t("autopilot.step.review"), icon: Sparkles },
            { key: "edit", label: t("autopilot.step.edit"), icon: Wand2 },
            { key: "schedule", label: t("autopilot.step.schedule"), icon: Send },
          ].map((s, i, arr) => {
            const order = ["setup", "running", "review", "edit", "schedule", "done"];
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
                  {t("autopilot.setup.noAccountPrefix")} {platformMeta.name} {t("autopilot.setup.noAccountSuffix")}
                  <Link
                    href="/accounts"
                    onClick={() => setReturnToFlow("/autopilot")}
                    className="underline ml-1 font-medium"
                  >
                    {t("autopilot.setup.goAdd")}
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
                  {t("autopilot.setup.bound")} <strong>{t("autopilot.setup.boundOne")}</strong> {platformMeta.name} {t("autopilot.setup.account")}
                  {selectedAccount?.nickname && <>（<strong>{selectedAccount.nickname}</strong>）</>}
                  · {t("autopilot.setup.added")} <strong>{existingCompetitors.length}</strong> {t("autopilot.setup.competitorsUnit")}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Users2 className="h-4 w-4 text-primary" />
                  {t("autopilot.setup.whichIdentity")}
                  <span className="text-xs text-muted-foreground font-normal">
                    {t("autopilot.setup.identityHint")}
                  </span>
                </div>
                <Link
                  href="/accounts"
                  onClick={() => setReturnToFlow("/autopilot")}
                  className="text-xs text-muted-foreground hover:text-primary underline"
                >
                  {t("autopilot.setup.addAccount")}
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
                {t("autopilot.setup.added")} <strong className="text-foreground">{existingCompetitors.length}</strong> {t("autopilot.setup.competitorsUnit")}
              </div>
            </div>
          )}

          <div>
            <label className="text-sm font-medium mb-1 block">
              <Zap className="h-3.5 w-3.5 inline mr-1" />
              {t("autopilot.setup.nicheLabel")} <span className="text-red-500">*</span>
            </label>
            <Input
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder={t("autopilot.setup.nichePlaceholder")}
              className="text-base"
            />
            <div className="text-xs text-muted-foreground mt-1">{t("autopilot.setup.nicheHint")}</div>
          </div>

          {/* 对标同行链接 / 账号 —— 跟 XHS workflow 对齐，让客户精准锚定参考对象 */}
          <div>
            <label className="text-sm font-medium mb-1 block">
              <Users2 className="h-3.5 w-3.5 inline mr-1 text-blue-500" />
              {t("autopilot.setup.competitorsLabel")} <span className="text-muted-foreground text-xs font-normal">{t("autopilot.setup.competitorsOptional")}</span>
            </label>
            <Textarea
              value={customCompetitors}
              onChange={(e) => setCustomCompetitors(e.target.value)}
              placeholder={
                platform === "tiktok"
                  ? "@charlidamelio, https://tiktok.com/@mrbeast"
                  : platform === "instagram"
                  ? "@cristiano, https://instagram.com/zendaya"
                  : "@TheRock, https://facebook.com/TastyOfficial"
              }
              rows={2}
              className="text-sm font-mono"
            />
            <div className="text-xs text-muted-foreground mt-1">
              {t("autopilot.setup.competitorsHint")}
              {existingCompetitors.length > 0 && (
                <> · {t("autopilot.setup.poolHintPrefix")} <strong className="text-foreground">{existingCompetitors.length}</strong> {t("autopilot.setup.poolHintSuffix")}</>
              )}
            </div>
          </div>

          {/* 视频脚本开关 —— 仅 TT/IG 主推；FB 以图文为主但也可选 */}
          <label className="flex items-start gap-2.5 text-sm cursor-pointer p-3 rounded-md border bg-background hover:bg-muted/30 transition">
            <Checkbox
              checked={wantVideoScript}
              onCheckedChange={(v) => { videoScriptTouchedRef.current = true; setWantVideoScript(!!v); }}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="font-medium flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-purple-500" />
                {t("autopilot.setup.videoLabel")}
                {(platform === "tiktok" || platform === "instagram") && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">{t("autopilot.setup.recommended")}</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {t("autopilot.setup.videoHint")}
              </div>
            </div>
          </label>

          {/* 一键模式说明 */}
          {!customMode && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm flex items-start gap-2">
              <Sparkles className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
              <div className="flex-1 text-foreground/80">
                <strong className="text-primary">{t("autopilot.setup.oneClickTitle")}</strong>{t("autopilot.setup.oneClickDesc")}<span className="text-xs text-muted-foreground">{t("autopilot.setup.oneClickNote")}</span>
              </div>
            </div>
          )}

          {/* 品牌画像（per-platform）：避免用户必须先去设置页填，强烈建议填好让 AI 严格符合品牌定位/避开禁用宣称 */}
          <BrandProfileInlinePanel platform={platform} />

          {/* 自定义高级配置 */}
          <button
            type="button"
            onClick={() => setCustomMode((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition"
          >
            <Settings2 className="h-3.5 w-3.5" />
            {customMode ? t("autopilot.setup.advancedCollapse") : t("autopilot.setup.advancedExpand")}
            <ChevronDown className={`h-3 w-3 transition-transform ${customMode ? "rotate-180" : ""}`} />
          </button>

          {customMode && (
            <div className="space-y-4 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 p-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">{t("autopilot.setup.region")}</label>
                  <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder={t("autopilot.setup.regionPlaceholder")} />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">{t("autopilot.setup.extras")}</label>
                  <Input value={extras} onChange={(e) => setExtras(e.target.value)} placeholder={t("autopilot.setup.extrasPlaceholder")} />
                </div>
              </div>

              {existingCompetitors.length === 0 && platform === "tiktok" && (
                <label className="flex items-start gap-2 text-sm cursor-pointer p-3 rounded-md border bg-background">
                  <Checkbox checked={autoDiscover} onCheckedChange={(v) => setAutoDiscover(!!v)} className="mt-0.5" />
                  <div>
                    <div className="font-medium flex items-center gap-1.5">
                      <Search className="h-3.5 w-3.5" />
                      {t("autopilot.setup.autoDiscover")}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{t("autopilot.setup.autoDiscoverHint")}</div>
                  </div>
                </label>
              )}

              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                {t("autopilot.setup.advancedWarning")}
              </div>
            </div>
          )}

          <Button
            size="lg"
            className="w-full bg-gradient-to-r from-primary to-purple-500 hover:opacity-90 text-base h-12"
            onClick={handleStart}
            disabled={!niche.trim() || !hasAccounts || !selectedAccount || checkingFit}
          >
            {checkingFit ? (
              <><Loader2 className="h-5 w-5 mr-2 animate-spin" />{t("autopilot.setup.checking")}</>
            ) : (
              <><Rocket className="h-5 w-5 mr-2" />{customMode ? t("autopilot.setup.startCustom") : t("autopilot.setup.startOneClick")}</>
            )}
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
              <div className="font-semibold">{t("autopilot.running.title")}</div>
              <div className="text-xs text-muted-foreground">{t("autopilot.running.hint")}</div>
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
              {t("autopilot.running.cancel")}
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
      {step === "review" && strategyOptions.length > 0 && (() => {
        const okOpts = strategyOptions.filter(Boolean);
        const refOpt = okOpts[0]; // 任一存活方案的 meta 用作总览展示
        return (
        <div className="space-y-4">
          {/* 折叠后的成功日志 */}
          <Card className="p-3 bg-emerald-50/50 border-emerald-200">
            <div className="flex items-center gap-2 text-sm text-emerald-800">
              <CheckCircle2 className="h-4 w-4" />
              <span className="font-medium">{t("autopilot.review.pipelineDone")} {okOpts.length}/3 {t("autopilot.review.optionsReady")}</span>
              <span className="text-xs text-emerald-600/80">
                · {t("autopilot.review.competitorsLabel")} {refOpt.meta.competitorsAnalyzed} · {t("autopilot.review.samplesLabel")} {refOpt.meta.postsAnalyzed} · {t("autopilot.review.modeLabel")} {refOpt.meta.dataMode}
              </span>
            </div>
          </Card>

          {/* 市场数据洞察 + 同行样本（让用户看到 AI 是基于哪些真实数据生成的） */}
          {marketInsights && (
            <Card className="p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Search className="h-4 w-4 text-primary" />
                {t("autopilot.review.marketRef")}
                <Badge variant="outline" className="text-[10px] ml-auto">
                  {t("autopilot.review.dataSource")}{marketInsights.trendingSource}
                </Badge>
              </div>

              {/* 同行 */}
              {marketInsights.competitors.length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1.5">
                    {t("autopilot.review.competitorsIcon")}（{marketInsights.competitors.length} · {marketInsights.totalSamples} {t("autopilot.review.samplesUnit")}）
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {marketInsights.competitors.slice(0, 8).map((c) => (
                      <Badge key={c.id} variant="secondary" className="text-xs gap-1">
                        @{c.handle ?? c.nickname}
                        {typeof c.postCount === "number" && (
                          <span className="text-[10px] text-muted-foreground">·{c.postCount}</span>
                        )}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* 热门内容 */}
              {marketInsights.trendingItems.length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1.5">
                    {t("autopilot.review.trendingHead")} {marketInsights.trendingItems.length})
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {marketInsights.trendingItems.map((it) => (
                      <div key={it.id} className="rounded-md border bg-muted/20 p-2 text-xs space-y-1 overflow-hidden">
                        {it.thumbnailUrl && (
                          <div className="aspect-video bg-muted rounded overflow-hidden">
                            <img
                              src={proxyXhsImage(it.thumbnailUrl) || it.thumbnailUrl}
                              alt=""
                              className="w-full h-full object-cover"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                const img = e.currentTarget;
                                if (img.dataset.fallback === "1") { img.style.display = "none"; return; }
                                img.dataset.fallback = "1";
                                img.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 90'><rect width='160' height='90' fill='%23f1f5f9'/><text x='80' y='50' text-anchor='middle' fill='%2394a3b8' font-size='10' font-family='sans-serif'>无封面</text></svg>";
                              }}
                            />
                          </div>
                        )}
                        <div className="line-clamp-2 font-medium">{it.title || t("autopilot.review.noTitle")}</div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          {typeof it.likes === "number" && <span>♥ {it.likes.toLocaleString()}</span>}
                          {typeof it.views === "number" && <span>👁 {it.views.toLocaleString()}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 最佳发布时间 */}
              {marketInsights.bestTimes && (
                <div className="rounded-md border bg-primary/5 p-2.5 text-xs">
                  <div className="font-medium mb-0.5 flex items-center gap-1">
                    ⏰ {platformMeta.name} {t("autopilot.review.bestTime")}
                  </div>
                  <div className="text-muted-foreground">
                    {t("autopilot.review.bestTimeDaily")} <strong className="text-foreground">{marketInsights.bestTimes.bestHours.map((h) => `${h}:00`).join(" / ")}</strong>
                    {" · "}
                    <span>{marketInsights.bestTimes.insight}</span>
                  </div>
                </div>
              )}

              <div className="text-[11px] text-muted-foreground pt-1 border-t">
                {t("autopilot.review.contextHint")}
              </div>
            </Card>
          )}

          {refOpt.meta?.warning && (
            <Card className="p-3 border-amber-300 bg-amber-50">
              <div className="flex gap-2 text-sm text-amber-800">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <div>{refOpt.meta.warning}</div>
              </div>
            </Card>
          )}

          {/* 3 方案卡片选择（点采用 → approve → 进排期步骤） */}
          <div>
            <div className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              {t("autopilot.review.choose")}
              <span className="text-xs text-muted-foreground font-normal">{t("autopilot.review.chooseHint")}</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {strategyOptions.map((opt, idx) => {
                const angle = STRATEGY_ANGLES[idx];
                const isSelected = selectedStrategyIdx === idx;
                if (!opt) {
                  return (
                    <Card key={idx} className="p-4 border-dashed text-center text-xs text-muted-foreground bg-muted/20">
                      <div className="text-2xl mb-1">{angle.emoji}</div>
                      <div className="font-medium mb-1">{t(angle.labelKey)}</div>
                      <div>{t("autopilot.review.optionFailed")}</div>
                    </Card>
                  );
                }
                const s = opt.strategy;
                return (
                  <Card
                    key={idx}
                    className={`p-4 space-y-2.5 transition cursor-pointer hover:shadow-md ${
                      isSelected ? "border-primary ring-2 ring-primary/20" : ""
                    }`}
                    onClick={() => setSelectedStrategyIdx(idx)}
                  >
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="text-[10px] gap-1">
                        <span>{angle.emoji}</span> {t("autopilot.review.optionLabel")} {idx + 1}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">{t(angle.labelKey)}</span>
                    </div>
                    <div className="font-bold text-sm leading-tight line-clamp-2">{s.theme}</div>
                    <div className="text-xs bg-primary/5 rounded p-2 italic line-clamp-3">
                      <strong className="not-italic text-primary">{t("autopilot.review.hook")}</strong>{s.hookFormula}
                    </div>
                    {Array.isArray(s.scriptOutline) && s.scriptOutline.length > 0 && (
                      <div className="text-[11px] text-muted-foreground line-clamp-3 leading-relaxed">
                        {s.scriptOutline.slice(0, 3).map((sc: any) => `${sc.order}. ${sc.description}`).join(" · ")}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1 pt-1">
                      {s.hashtags?.slice(0, 4).map((h: string, i: number) => (
                        <span key={i} className="text-[10px] text-primary">#{h}</span>
                      ))}
                      {(s.hashtags?.length ?? 0) > 4 && (
                        <span className="text-[10px] text-muted-foreground">+{s.hashtags.length - 4}</span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-1 text-[10px] text-muted-foreground pt-1 border-t">
                      <div>⏱ {s.estimatedDuration}s</div>
                      <div>🎵 {s.bgmStyle}</div>
                      <div>📐 {s.aspectRatio}</div>
                    </div>
                    <Button
                      className="w-full mt-1"
                      size="sm"
                      disabled={approveMut.isPending}
                      onClick={(e) => { e.stopPropagation(); handleAdoptStrategy(idx); }}
                    >
                      {approveMut.isPending && isSelected
                        ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />{t("autopilot.review.generating")}</>
                        : <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />{t("autopilot.review.adopt")}</>
                      }
                    </Button>
                  </Card>
                );
              })}
            </div>

            {/* 选中方案的展开详情（剧本 + 旁白 + 同行） */}
            {selectedStrategyIdx !== null && strategyResult && (
              <Card className="p-4 mt-3 bg-muted/10 space-y-3">
                <div className="text-xs font-semibold text-primary flex items-center gap-1.5">
                  <Search className="h-3.5 w-3.5" />
                  {t("autopilot.review.optionLabel")} {selectedStrategyIdx + 1} {t("autopilot.review.detailSuffix")}
                </div>
                {strategyResult.strategy.scriptOutline?.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold mb-1">{t("autopilot.review.scriptOutline")}</div>
                    <ol className="space-y-1.5">
                      {strategyResult.strategy.scriptOutline.map((s: any) => (
                        <li key={s.order} className="flex gap-2 text-xs border-l-2 border-primary/30 pl-2">
                          <span className="font-bold text-primary">{s.order}</span>
                          <div className="flex-1">
                            <div className="font-medium">{s.description} <span className="text-[10px] text-muted-foreground">({s.duration}s)</span></div>
                            {s.dialogue && <div className="text-muted-foreground text-[11px] mt-0.5">"{s.dialogue}"</div>}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {strategyResult.strategy.voiceoverScript && (
                  <div>
                    <div className="text-xs font-semibold mb-1">{t("autopilot.review.voiceover")}</div>
                    <Textarea value={strategyResult.strategy.voiceoverScript} readOnly rows={5} className="text-xs bg-background" />
                  </div>
                )}
                {strategyResult.strategy.referenceCompetitors?.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold mb-1">{t("autopilot.review.refCompetitors")}</div>
                    <ul className="space-y-0.5 text-xs">
                      {strategyResult.strategy.referenceCompetitors.map((c: any, i: number) => (
                        <li key={i}><strong>@{c.handle}</strong> <span className="text-muted-foreground">— {c.why}</span></li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            )}
          </div>

          <div className="flex gap-2 justify-center pt-2">
            <Button variant="outline" size="sm" onClick={resetAll}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> {t("autopilot.review.restart")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => runPipeline()}>
              <Sparkles className="h-3.5 w-3.5 mr-1.5" /> {t("autopilot.review.regen3")}
            </Button>
          </div>
        </div>
        );
      })()}

      {/* Step 4: 就地编辑 —— 改文案 / 换图 / 上传视频，全部不离开本页 */}
      {step === "edit" && contentId && (
        <div className="space-y-4">
          <Card className="p-4 bg-emerald-50 border-emerald-200">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="flex-1 text-sm">
                <div className="font-semibold text-emerald-800">{t("autopilot.edit.draftReadyPrefix")}{contentId} {t("autopilot.edit.draftReadySuffix")}</div>
                <div className="text-xs text-emerald-700/80 mt-0.5">
                  {t("autopilot.edit.tip")}
                </div>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* 左：实时预览 */}
            <Card className="p-4 space-y-3">
              <div className="text-sm font-semibold flex items-center gap-1.5">
                <Search className="h-4 w-4 text-primary" /> {t("autopilot.edit.preview")}（{platformMeta.name}）
              </div>
              <div className="rounded-xl border overflow-hidden bg-white">
                {editForm.videoUrl ? (
                  <video src={editForm.videoUrl} controls className="w-full max-h-64 bg-black object-contain" />
                ) : editForm.imageUrls[0] ? (
                  <div className="aspect-[4/3] bg-muted overflow-hidden">
                    <img src={editForm.imageUrls[0]} alt="封面" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="aspect-[4/3] flex items-center justify-center bg-amber-50 text-amber-600 text-sm">
                    <ImageIcon className="h-8 w-8 mr-2" /> {t("autopilot.edit.noCover")}
                  </div>
                )}
                <div className="p-3 space-y-1.5">
                  <div className="font-bold text-base leading-tight">{editForm.title || t("autopilot.edit.noTitle")}</div>
                  <div className="text-sm text-gray-700 whitespace-pre-wrap line-clamp-6">
                    {editForm.body || t("autopilot.edit.noBody")}
                  </div>
                  {editForm.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {editForm.tags.map((t) => (
                        <span key={t} className="text-xs text-primary">#{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {editForm.imageUrls.length > 1 && (
                <div>
                  <div className="text-[11px] text-muted-foreground mb-1">{t("autopilot.edit.allImages")}（{editForm.imageUrls.length} {t("autopilot.edit.imagesCountUnit")}）</div>
                  <div className="grid grid-cols-4 gap-1">
                    {editForm.imageUrls.map((u, i) => (
                      <div key={i} className="aspect-square rounded overflow-hidden border bg-muted">
                        <img src={u} alt={`配图 ${i + 1}`} className="w-full h-full object-cover" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            {/* 右：编辑表单 */}
            <Card className="p-4 space-y-4">
              <div>
                <Label className="text-xs">{t("autopilot.edit.titleLabel")}（{editForm.title.length} {t("autopilot.edit.charsUnit")}）</Label>
                <Input
                  value={editForm.title}
                  onChange={(e) => setEditForm((p) => ({ ...p, title: e.target.value }))}
                  placeholder={t("autopilot.edit.titlePlaceholder")}
                  className="mt-1"
                />
              </div>

              <div>
                <Label className="text-xs">{t("autopilot.edit.bodyLabel")}（{editForm.body.length} {t("autopilot.edit.charsUnit")}）</Label>
                <Textarea
                  value={editForm.body}
                  onChange={(e) => setEditForm((p) => ({ ...p, body: e.target.value }))}
                  rows={8}
                  className="mt-1 text-sm"
                  placeholder={t("autopilot.edit.bodyPlaceholder")}
                />
              </div>

              <div>
                <Label className="text-xs">{t("autopilot.edit.tagsLabel")}（{editForm.tags.length} {t("autopilot.edit.tagsCountUnit")}）</Label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {editForm.tags.map((t) => (
                    <Badge key={t} variant="secondary" className="text-xs gap-1">
                      #{t}
                      <button
                        onClick={() => setEditForm((p) => ({ ...p, tags: p.tags.filter((x) => x !== t) }))}
                        className="hover:text-destructive"
                      ><X className="h-3 w-3" /></button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-1.5 mt-2">
                  <Input
                    value={editForm.tagInput}
                    onChange={(e) => setEditForm((p) => ({ ...p, tagInput: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                    placeholder={t("autopilot.edit.tagPlaceholder")}
                    className="h-8 text-xs"
                  />
                  <Button size="sm" variant="outline" onClick={addTag} className="h-8">{t("autopilot.edit.addTag")}</Button>
                </div>
              </div>

              {/* 配图管理 */}
              <div className="space-y-2 pt-2 border-t">
                <div className="flex items-center justify-between">
                  <Label className="text-xs flex items-center gap-1">
                    <ImageIcon className="h-3.5 w-3.5 text-purple-500" /> {t("autopilot.edit.imagesLabel")}（{editForm.imageUrls.length}/9）
                  </Label>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm" variant="outline" className="h-7 text-xs"
                      onClick={handleRegenImageInEdit}
                      disabled={regeneratingImg || editForm.imageUrls.length >= 9}
                    >
                      {regeneratingImg
                        ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        : <Sparkles className="h-3 w-3 mr-1" />}
                      {t("autopilot.edit.aiGen")}
                    </Button>
                    <AssetPicker
                      type="image" multiple triggerLabel={t("autopilot.edit.assets")} triggerSize="sm"
                      onPick={(urls) => setEditForm((p) => {
                        const merged = [...p.imageUrls];
                        for (const u of urls) if (!merged.includes(u) && merged.length < 9) merged.push(u);
                        return { ...p, imageUrls: merged };
                      })}
                    />
                    <ObjectUploader
                      maxNumberOfFiles={9 - editForm.imageUrls.length || 1}
                      maxFileSize={10485760}
                      allowedFileTypes={["image/*"]}
                      onGetUploadParameters={handleGetUploadParameters}
                      onComplete={handleImageUploadComplete}
                      buttonClassName="inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-md text-xs font-medium h-7 px-2 border border-input bg-background hover:bg-accent"
                    >
                      <Upload className="h-3 w-3 mr-1" />上传
                    </ObjectUploader>
                  </div>
                </div>
                {editForm.imageUrls.length > 0 && (
                  <div className="grid grid-cols-3 gap-1.5">
                    {editForm.imageUrls.map((url, i) => (
                      <div key={i} className="relative group aspect-square rounded-md overflow-hidden border bg-muted">
                        <img src={url} alt={`配图 ${i + 1}`} className="w-full h-full object-cover" />
                        <button
                          onClick={() => setEditForm((p) => ({ ...p, imageUrls: p.imageUrls.filter((_, j) => j !== i) }))}
                          className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        ><X className="h-3 w-3" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 视频（TT/IG 强烈建议） */}
              <div className="space-y-2 pt-2 border-t">
                <div className="flex items-center justify-between">
                  <Label className="text-xs flex items-center gap-1">
                    <VideoIcon className="h-3.5 w-3.5 text-blue-500" /> {t("autopilot.edit.videoLabel")}
                    {(platform === "tiktok" || platform === "instagram") && (
                      <span className="text-[10px] text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded">{t("autopilot.setup.recommended")}</span>
                    )}
                  </Label>
                  {!editForm.videoUrl && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <AssetPicker
                        type="video" multiple={false} triggerLabel={t("autopilot.edit.assets")} triggerSize="sm"
                        onPick={(urls) => { if (urls[0]) setEditForm((p) => ({ ...p, videoUrl: urls[0] })); }}
                      />
                      <ObjectUploader
                        maxNumberOfFiles={1} maxFileSize={104857600}
                        allowedFileTypes={["video/*"]}
                        onGetUploadParameters={handleGetUploadParameters}
                        onComplete={handleVideoUploadComplete}
                        buttonClassName="inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-md text-xs font-medium h-7 px-2 border border-input bg-background hover:bg-accent"
                      >
                        <Upload className="h-3 w-3 mr-1" />{t("autopilot.edit.uploadShort")}
                      </ObjectUploader>
                      {isPro && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs border-purple-300 bg-gradient-to-r from-purple-50 to-pink-50 hover:from-purple-100 hover:to-pink-100 text-purple-700"
                          onClick={handleGenerateSora}
                          disabled={soraGenerating}
                          title="OpenAI Sora 2 Pro · 1080P · 12s · 250 积分"
                        >
                          <Sparkles className="h-3 w-3 mr-1" />
                          {soraGenerating ? `Sora 生成中 ${soraProgress}%` : "Sora 高清电影级 (Pro · 250)"}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                {soraGenerating && (
                  <div className="text-[11px] text-purple-700 bg-purple-50 border border-purple-200 rounded px-2 py-1.5 mt-1">
                    🎬 Sora 2 Pro 高清生成中（{soraStatus} · {soraProgress}%）—— 通常 2-5 分钟，请保持本页打开。完成后会自动填入下方视频区。
                  </div>
                )}
                {editForm.videoUrl && (
                  <div className="relative group rounded-md overflow-hidden border bg-muted">
                    <video src={editForm.videoUrl} controls className="w-full max-h-40 object-contain" />
                    <button
                      onClick={() => setEditForm((p) => ({ ...p, videoUrl: "" }))}
                      className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    ><X className="h-3 w-3" /></button>
                  </div>
                )}
              </div>
            </Card>
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button variant="ghost" size="sm" onClick={() => setStep("review")}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> {t("autopilot.edit.back")}
            </Button>
            <Button
              className="flex-1 h-11 bg-gradient-to-r from-primary to-purple-500 hover:opacity-90"
              onClick={handleSaveEditAndProceed}
              disabled={savingEdit}
            >
              {savingEdit ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              {t("autopilot.edit.saveAndProceed")}
            </Button>
          </div>
        </div>
      )}

      {/* Step 5: 排期发布 —— 草稿已生成，挑选发布时间 */}
      {step === "schedule" && contentId && (
        <Card className="p-6 space-y-5">
          <div className="flex items-center gap-3 pb-3 border-b">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            <div className="flex-1">
              <div className="font-bold">{t("autopilot.edit.draftReadyPrefix")}{contentId} {t("autopilot.schedule.draftReadySuffix")}</div>
              <div className="text-xs text-muted-foreground">
                {strategyResult?.strategy?.theme && <span>{t("autopilot.schedule.themePrefix")}{strategyResult.strategy.theme}</span>}
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => setStep("edit")}>
              <FileEdit className="h-3.5 w-3.5 mr-1.5" />{t("autopilot.schedule.editBack")}
            </Button>
          </div>

          {/* 推荐时段说明 */}
          <div className="rounded-md border bg-primary/5 p-3 text-sm">
            <div className="font-medium mb-1 flex items-center gap-1.5">
              {t("autopilot.schedule.recHead1")} {marketInsights?.bestTimes
                ? <>{t("autopilot.schedule.competitorsLabel")} <strong>{marketInsights.totalSamples}</strong> {t("autopilot.schedule.samplesUnit")}</>
                : t("autopilot.schedule.fallbackSource")} {t("autopilot.schedule.recHead2")} {recommendedSlots.length} {t("autopilot.schedule.recHead3")}
            </div>
            <div className="text-xs text-muted-foreground">
              {marketInsights?.bestTimes?.insight ?? t("autopilot.schedule.fallbackInsight")}
            </div>
          </div>

          {/* 推荐时段卡片 —— 用户挑一张就行，不用自己想时间 */}
          <div className="space-y-2">
            <div className="text-sm font-semibold">{t("autopilot.schedule.pickSlot")}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {recommendedSlots.map((s) => {
                const selected = scheduledAt === s.localInput;
                return (
                  <button
                    key={s.key}
                    onClick={() => setScheduledAt(s.localInput)}
                    className={`text-left rounded-md border p-3 transition-all ${
                      selected
                        ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                        : "hover:border-primary/50 hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-sm">{s.primary}</div>
                      {s.isPeak && <Badge variant="default" className="text-[10px] h-4 bg-rose-500 hover:bg-rose-500">{t("autopilot.schedule.peak")}</Badge>}
                      {selected && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{s.reason}</div>
                  </button>
                );
              })}
            </div>

            {/* 折叠的「自定义时间」入口 —— 默认收起，避免让用户陷入选择困难 */}
            <button
              onClick={() => setCustomTimeOpen((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4 mt-2"
            >
              {customTimeOpen ? t("autopilot.schedule.collapseTime") : t("autopilot.schedule.expandTime")}
            </button>
            {customTimeOpen && (
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm bg-background mt-2"
              />
            )}
          </div>

          <div className="flex gap-2 pt-3 border-t flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              disabled={strategyOptions.filter(Boolean).length === 0}
              onClick={() => setStep("review")}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> {t("autopilot.edit.back")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setStep("edit")}>
              <FileEdit className="h-3.5 w-3.5 mr-1.5" />{t("autopilot.schedule.editBack")}
            </Button>
            <Button
              className="flex-1 bg-gradient-to-r from-primary to-purple-500 hover:opacity-90"
              onClick={handleScheduleNow}
              disabled={scheduling || scheduleMut.isPending || !scheduledAt}
            >
              {(scheduling || scheduleMut.isPending) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              {t("autopilot.schedule.confirm")}
            </Button>
          </div>
        </Card>
      )}

      {/* Step 6: 完成态 */}
      {step === "done" && contentId && (
        <Card className="p-6 space-y-4">
          <div className="text-center space-y-2">
            <CheckCircle2 className="h-14 w-14 text-emerald-500 mx-auto" />
            <div className="text-xl font-bold">{t("autopilot.done.title")}</div>
            <div className="text-sm text-muted-foreground">
              {t("autopilot.edit.draftReadyPrefix")}{contentId} {t("autopilot.done.descSuffix")}
            </div>
          </div>

          {/* 真实素材预览（不再只是干巴巴的简报） */}
          {(editForm.title || editForm.imageUrls.length > 0 || editForm.videoUrl) && (
            <div className="rounded-xl border overflow-hidden bg-white">
              {editForm.videoUrl ? (
                <video src={editForm.videoUrl} controls className="w-full max-h-64 bg-black object-contain" />
              ) : editForm.imageUrls[0] ? (
                <div className="aspect-[4/3] bg-muted overflow-hidden">
                  <img src={editForm.imageUrls[0]} alt="封面" className="w-full h-full object-cover" />
                </div>
              ) : null}
              <div className="p-3 space-y-1.5">
                <div className="font-bold text-base">{editForm.title}</div>
                <div className="text-sm text-gray-700 whitespace-pre-wrap line-clamp-4">{editForm.body}</div>
                {editForm.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {editForm.tags.slice(0, 8).map((t) => (
                      <span key={t} className="text-xs text-primary">#{t}</span>
                    ))}
                  </div>
                )}
                {editForm.imageUrls.length > 1 && (
                  <div className="text-[11px] text-muted-foreground pt-1">共 {editForm.imageUrls.length} 张配图</div>
                )}
              </div>
            </div>
          )}

          {strategyResult && (
            <div className="text-left bg-muted/30 rounded-lg p-3 space-y-1 text-xs border">
              <div className="font-semibold text-primary flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" /> 本次方案
              </div>
              <div><strong>主题：</strong>{strategyResult.strategy.theme}</div>
              <div className="text-muted-foreground">
                <strong className="text-foreground">钩子：</strong>{strategyResult.strategy.hookFormula}
              </div>
            </div>
          )}
          <div className="flex gap-2 justify-center flex-wrap">
            <Button size="lg" onClick={() => setStep("edit")}>
              <FileEdit className="h-4 w-4 mr-2" />返回微调内容
            </Button>
            <Link href="/schedules">
              <Button size="lg" variant="outline"><Send className="h-4 w-4 mr-2" />查看排期表</Button>
            </Link>
            <Button variant="ghost" onClick={resetAll}>
              再来一条
            </Button>
          </div>

          {/* T2：一键再排 6 条（连同已发布的当前 1 条共 7 天闭环） */}
          {selectedAccount && niche.trim() && (
            <div className="border-t pt-4 mt-2">
              <BulkCampaignCTA
                accountId={selectedAccount.id}
                platform={platform}
                niche={niche.trim()}
                region={region.trim() || undefined}
              />
            </div>
          )}
        </Card>
      )}

      {/* 底部辅助：去同行库手动管理 */}
      {step === "setup" && existingCompetitors.length > 0 && (
        <div className="text-xs text-center text-muted-foreground">
          已有 {existingCompetitors.length} 位同行 ·
          <Link href="/competitors" className="underline ml-1">去同行库管理 →</Link>
        </div>
      )}

      {/* 账号画像 vs niche 不一致 → 弹窗让用户三选一 */}
      <AlertDialog open={!!fitDialog?.open} onOpenChange={(o) => { if (!o) setFitDialog(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              账号画像跟你输入的行业对不上
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <div className="rounded-md bg-muted/50 p-3 whitespace-pre-line text-foreground">
                  {fitDialog?.accountSummary}
                </div>
                <div>
                  <span className="text-muted-foreground">本次你想做：</span>
                  <strong className="text-foreground">{niche.trim()}</strong>
                  <span className="ml-2 text-xs text-amber-600">
                    一致性 {Math.round((fitDialog?.fit ?? 0) * 100)}%
                  </span>
                </div>
                {fitDialog?.reason && (
                  <div className="text-muted-foreground">AI 判断：{fitDialog.reason}</div>
                )}
                <div className="text-foreground">怎么继续？</div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-col gap-2">
            {fitDialog?.suggestedNiche && (
              <AlertDialogAction
                className="w-full"
                onClick={() => {
                  const target = fitDialog.suggestedNiche;
                  setFitDialog(null);
                  startPipelineWith(target);
                }}
              >
                改用「{fitDialog.suggestedNiche}」跑（贴合账号原画像）
              </AlertDialogAction>
            )}
            <AlertDialogAction
              className="w-full bg-amber-600 hover:bg-amber-700"
              onClick={() => {
                const target = niche.trim();
                setFitDialog(null);
                startPipelineWith(target);
              }}
            >
              仍按「{niche.trim()}」跑（我在做转型/拓品类）
            </AlertDialogAction>
            <AlertDialogCancel className="w-full mt-0">取消，让我重填</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
