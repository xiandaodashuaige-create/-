import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePlatform } from "@/lib/platform-context";
import { PLATFORMS, type PlatformId } from "@/lib/platform-meta";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles, Loader2, CheckCircle2, ArrowRight, Users2, Brain, FileEdit, Send, AlertCircle,
} from "lucide-react";

type Step = "setup" | "generating" | "review" | "approved";

export default function AutopilotPage() {
  const { activePlatform } = usePlatform();
  const platform = activePlatform as PlatformId;
  const platformMeta = PLATFORMS[platform];
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("setup");
  const [niche, setNiche] = useState("");
  const [region, setRegion] = useState("");
  const [extras, setExtras] = useState("");
  const [strategyResult, setStrategyResult] = useState<any | null>(null);
  const [contentId, setContentId] = useState<number | null>(null);

  const competitorsQ = useQuery({
    queryKey: ["autopilot-competitors", platform],
    queryFn: () => api.competitors.list(platform),
  });
  const accountsQ = useQuery({
    queryKey: ["autopilot-accounts", platform],
    queryFn: () => api.accounts.list({ platform }),
  });

  const genMut = useMutation({
    mutationFn: () => api.strategy.generate({
      platform, region: region || undefined, niche: niche || undefined,
      customRequirements: extras || undefined,
    }),
    onSuccess: (data) => {
      setStrategyResult(data);
      setStep("review");
      if (data.meta?.warning) {
        toast({ title: "数据提醒", description: data.meta.warning });
      }
    },
    onError: (err: any) => {
      toast({ title: "生成失败", description: err?.message ?? "未知错误", variant: "destructive" });
      setStep("setup");
    },
  });

  const approveMut = useMutation({
    mutationFn: () => api.strategy.approve(strategyResult.id),
    onSuccess: (data) => {
      setContentId(data.contentId);
      setStep("approved");
      toast({ title: "已批准", description: `已生成草稿 #${data.contentId}` });
    },
    onError: (err: any) => toast({ title: "批准失败", description: err?.message, variant: "destructive" }),
  });

  function handleGenerate() {
    if (competitorsQ.data?.length === 0) {
      toast({
        title: "请先添加同行",
        description: "AI 自动驾驶需要参考真实同行数据，请先在「同行库」添加至少 1 个对标账号",
        variant: "destructive",
      });
      return;
    }
    setStep("generating");
    genMut.mutate();
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <Sparkles className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">AI 自动驾驶</h1>
          <p className="text-sm text-muted-foreground">
            一句话告诉我你的行业，AI 自动整合同行数据 + 账号画像 → 生成发布就绪的内容
          </p>
        </div>
      </div>

      {/* 进度 */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-2">
          {[
            { key: "setup", label: "需求", icon: FileEdit },
            { key: "generating", label: "AI 综合", icon: Brain },
            { key: "review", label: "查看策略", icon: Sparkles },
            { key: "approved", label: "草稿就绪", icon: CheckCircle2 },
          ].map((s, i, arr) => {
            const order = ["setup", "generating", "review", "approved"];
            const currentIdx = order.indexOf(step);
            const myIdx = order.indexOf(s.key);
            const done = myIdx < currentIdx;
            const active = myIdx === currentIdx;
            const Icon = s.icon;
            return (
              <div key={s.key} className="flex items-center flex-1">
                <div className={`flex flex-col items-center gap-1 ${active ? "text-primary" : done ? "text-emerald-600" : "text-muted-foreground/50"}`}>
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition ${active ? "border-primary bg-primary/10" : done ? "border-emerald-500 bg-emerald-50" : "border-muted-foreground/20"}`}>
                    {step === "generating" && active ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
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
        <Card className="p-6 space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">行业 / 业务定位</label>
            <Input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="如：美容培训、本地餐饮、AI 工具评测" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">地区（可选）</label>
            <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="如：马来西亚 / 上海" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">额外要求（可选）</label>
            <Textarea value={extras} onChange={(e) => setExtras(e.target.value)} rows={3} placeholder="如：突出价格优势、目标客单 ¥99、主打周末" />
          </div>

          <div className="bg-muted/40 rounded-lg p-3 text-xs space-y-1">
            <div className="flex items-center gap-2">
              <Users2 className="h-3.5 w-3.5" />
              已添加 <strong className="text-foreground">{competitorsQ.data?.length ?? 0}</strong> 个 {platformMeta.name} 同行
              {competitorsQ.data && competitorsQ.data.length === 0 && (
                <Link href="/competitors" className="text-primary underline ml-2">去添加 →</Link>
              )}
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5" />
              已绑定 <strong className="text-foreground">{accountsQ.data?.length ?? 0}</strong> 个 {platformMeta.name} 账号
            </div>
          </div>

          <Button size="lg" className="w-full" onClick={handleGenerate} disabled={!niche.trim()}>
            <Sparkles className="h-4 w-4 mr-2" />
            一键生成策略
          </Button>
        </Card>
      )}

      {/* Step 2: AI 综合 */}
      {step === "generating" && (
        <Card className="p-12 text-center space-y-3">
          <div className="relative inline-block">
            <Brain className="h-16 w-16 text-primary animate-pulse" />
            <Loader2 className="h-6 w-6 text-primary animate-spin absolute -bottom-1 -right-1" />
          </div>
          <div className="font-semibold text-lg">AI 正在综合分析...</div>
          <div className="text-sm text-muted-foreground space-y-1">
            <div>· 解析 {competitorsQ.data?.length ?? 0} 位 {platformMeta.name} 同行的爆款数据</div>
            <div>· 结合你的行业与地区定位</div>
            <div>· 生成钩子、剧本、BGM、标签建议</div>
          </div>
        </Card>
      )}

      {/* Step 3: 策略卡 */}
      {step === "review" && strategyResult && (
        <div className="space-y-4">
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
                {strategyResult.strategy.scriptOutline.map((s: any) => (
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
                <div className="text-sm bg-muted/40 rounded p-3 whitespace-pre-wrap">{strategyResult.strategy.voiceoverScript}</div>
              </div>
            )}

            <div>
              <div className="text-sm font-semibold mb-2">推荐标签</div>
              <div className="flex flex-wrap gap-1.5">
                {strategyResult.strategy.hashtags.map((h: string, i: number) => (
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

            <div className="text-xs text-muted-foreground border-t pt-3">
              基于 <strong>{strategyResult.meta.competitorsAnalyzed}</strong> 个同行 · <strong>{strategyResult.meta.postsAnalyzed}</strong> 条样本 · {strategyResult.meta.dataMode}
            </div>

            <div className="flex gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => setStep("setup")}>重新生成</Button>
              <Button className="flex-1" onClick={() => approveMut.mutate()} disabled={approveMut.isPending}>
                {approveMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                批准 → 生成草稿
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
            <div className="text-sm text-muted-foreground mt-1">前往内容编辑器，配图 / 微调文案 / 发布或定时</div>
          </div>
          <div className="flex gap-2 justify-center">
            <Link href={`/content/${contentId}`}>
              <Button size="lg"><FileEdit className="h-4 w-4 mr-2" />打开编辑器</Button>
            </Link>
            <Link href="/schedules">
              <Button size="lg" variant="outline"><Send className="h-4 w-4 mr-2" />定时发布</Button>
            </Link>
            <Button variant="ghost" onClick={() => { setStep("setup"); setStrategyResult(null); setContentId(null); }}>
              再来一条
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
