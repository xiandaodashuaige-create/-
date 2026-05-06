import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePlatform } from "@/lib/platform-context";
import { PLATFORMS, type PlatformId } from "@/lib/platform-meta";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useLocation } from "wouter";
import { setReturnToFlow } from "@/lib/return-to-flow";
import { proxyXhsImage } from "@/lib/image-proxy";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  Users2, RefreshCw, Trash2, Search, Sparkles, Heart, MessageCircle, Eye, Plus, ExternalLink, Loader2,
  TrendingUp, Hash, Music, Clock, BarChart3, Star, Compass, Calendar, CheckCircle2, XCircle, FileText, Mic,
} from "lucide-react";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-background p-3 border">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold mt-0.5">{value}</div>
    </div>
  );
}

function InsightBlock({ icon, title, body, tail }: { icon: React.ReactNode; title: string; body: string; tail?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-background p-4 border">
      <div className="flex items-center gap-2 text-sm font-medium mb-1.5">
        {icon}{title}
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
      {tail}
    </div>
  );
}

function formatCount(n: number | null | undefined): string {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

export default function CompetitorsPage() {
  const { activePlatform } = usePlatform();
  const platform = activePlatform as PlatformId;
  const platformMeta = PLATFORMS[platform];
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const [handle, setHandle] = useState("");
  const [region, setRegion] = useState("");
  const [keyword, setKeyword] = useState("");
  const [discovered, setDiscovered] = useState<any[]>([]);
  const [discoverNote, setDiscoverNote] = useState<string>("");
  const [discovering, setDiscovering] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [postFilter, setPostFilter] = useState<"all" | "starred" | "viral">("all");
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [strategyNiche, setStrategyNiche] = useState("");
  const [transcriptOpenPostId, setTranscriptOpenPostId] = useState<number | null>(null);

  const transcribeMut = useMutation({
    mutationFn: (postId: number) => api.competitors.transcribePost(postId),
    onSuccess: (_data, postId) => {
      qc.invalidateQueries({ queryKey: ["competitor-posts", openId] });
      setTranscriptOpenPostId(postId);
      toast({ title: "口播文案已提取", description: "已缓存到该帖，可直接查看或反复复用。" });
    },
    onError: (err: any) => {
      const msg = err?.message || "提取失败";
      const isNoMedia = /无媒体|no.*media|404/i.test(msg);
      toast({
        variant: "destructive",
        title: "提取失败",
        description: isNoMedia ? "该帖没有可下载的视频媒体" : msg,
      });
    },
  });

  const { data: list = [], isLoading } = useQuery({
    queryKey: ["competitors", platform],
    queryFn: () => api.competitors.list(platform),
  });

  const { data: posts = [] } = useQuery({
    queryKey: ["competitor-posts", openId],
    queryFn: () => (openId ? api.competitors.posts(openId) : Promise.resolve([])),
    enabled: !!openId,
  });

  const addMut = useMutation({
    mutationFn: (h: string) => api.competitors.add({ platform, handle: h, region: region || undefined }),
    onSuccess: (data) => {
      toast({ title: "已添加", description: `@${data.handle} · ${data.postCount ?? 0} 条样本` });
      setHandle("");
      qc.invalidateQueries({ queryKey: ["competitors", platform] });
    },
    onError: (err: any) => {
      const msg = String(err?.message ?? "");
      // 后端返回 facebook_not_authorized / instagram_not_authorized → 引导去授权
      // 关键 UX：不让用户卡死在"添加失败"，给一键跳到账号页 + 完成后自动返回的路径
      const needAuth =
        msg.includes("facebook_not_authorized") ||
        msg.includes("instagram_not_authorized") ||
        msg.includes("not_authorized") ||
        msg.includes("412");
      if (needAuth) {
        toast({
          title: "需要先授权对应平台账号",
          description:
            platform === "instagram"
              ? "Instagram 同行追踪需要绑定一个 Business 账号（通过关联 Facebook 主页授权获取）"
              : "Facebook 同行追踪需要先授权一个 Facebook 主页",
          variant: "destructive",
          action: (
            <ToastAction
              altText="去授权"
              onClick={() => {
                setReturnToFlow("/competitors");
                setLocation("/accounts");
              }}
            >
              去授权 →
            </ToastAction>
          ),
        });
        return;
      }
      toast({ title: "添加失败", description: msg || "未知错误", variant: "destructive" });
    },
  });

  const syncMut = useMutation({
    mutationFn: (id: number) => api.competitors.sync(id),
    onSuccess: (_d, id) => {
      toast({ title: "已重新同步" });
      qc.invalidateQueries({ queryKey: ["competitors", platform] });
      qc.invalidateQueries({ queryKey: ["competitor-posts", id] });
    },
    onError: (err: any) => toast({ title: "同步失败", description: err?.message, variant: "destructive" }),
  });

  const insightsQuery = useQuery({
    queryKey: ["competitor-insights", platform],
    queryFn: () => api.competitors.insights(platform),
    enabled: insightsOpen,
    retry: false,
  });

  const delMut = useMutation({
    mutationFn: (id: number) => api.competitors.remove(id),
    onSuccess: () => {
      toast({ title: "已删除" });
      setOpenId(null);
      qc.invalidateQueries({ queryKey: ["competitors", platform] });
    },
  });

  const starMut = useMutation({
    mutationFn: ({ postId, starred }: { postId: number; starred: boolean }) =>
      api.competitors.starPost(postId, starred),
    onMutate: async ({ postId, starred }) => {
      // 乐观更新，避免按钮抖动
      await qc.cancelQueries({ queryKey: ["competitor-posts", openId] });
      const prev = qc.getQueryData<any[]>(["competitor-posts", openId]);
      if (prev) {
        qc.setQueryData<any[]>(["competitor-posts", openId], prev.map((p) =>
          p.id === postId ? { ...p, analysisJson: { ...(p.analysisJson ?? {}), starred } } : p,
        ));
      }
      return { prev };
    },
    onError: (err: any, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["competitor-posts", openId], ctx.prev);
      toast({ title: "收藏失败", description: err?.message, variant: "destructive" });
    },
    onSuccess: (_d, { starred }) => {
      toast({ title: starred ? "已加入精选库 ⭐" : "已取消精选" });
    },
  });

  const strategyQuery = useQuery({
    queryKey: ["competitor-strategy", platform, strategyNiche],
    queryFn: ({ signal }) => api.competitors.operationsStrategy(platform, strategyNiche || undefined, { signal }),
    enabled: strategyOpen,
    retry: false,
    staleTime: 60_000,
  });

  const filteredPosts = posts.filter((p: any) => {
    if (postFilter === "starred") return p.analysisJson?.starred === true;
    if (postFilter === "viral") return p.isViral === true;
    return true;
  });
  const starredCount = posts.filter((p: any) => p.analysisJson?.starred === true).length;
  const viralCount = posts.filter((p: any) => p.isViral === true).length;

  async function handleDiscover() {
    if (!keyword.trim()) return;
    setDiscovering(true);
    try {
      const r = await api.competitors.discover(platform, keyword.trim(), 10);
      setDiscovered(r.creators ?? []);
      setDiscoverNote(r.note ?? "");
    } catch (err: any) {
      toast({ title: "搜索失败", description: err?.message, variant: "destructive" });
    } finally {
      setDiscovering(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Users2 className="h-7 w-7 text-primary" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold">同行库</h1>
          <p className="text-sm text-muted-foreground">
            添加 {platformMeta.name} 同行账号，AI 会基于他们的真实爆款数据帮你制定内容策略
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="default"
            className="bg-violet-600 hover:bg-violet-700 text-white"
            onClick={() => setStrategyOpen(true)}
            disabled={list.length === 0}
          >
            <Compass className="h-4 w-4 mr-2" />
            30 天运营策略
          </Button>
          <Button
            variant={insightsOpen ? "default" : "outline"}
            onClick={() => {
              setInsightsOpen((v) => !v);
              if (!insightsOpen) qc.invalidateQueries({ queryKey: ["competitor-insights", platform] });
            }}
            disabled={list.length === 0}
          >
            <BarChart3 className="h-4 w-4 mr-2" />
            {insightsOpen ? "隐藏行业分析" : "行业分析"}
          </Button>
        </div>
      </div>

      {/* 添加 + 发现 */}
      <Card className="p-4 space-y-4">
        <div>
          <div className="text-sm font-medium mb-2">手动添加（输入 @handle）</div>
          <div className="flex gap-2">
            <Input
              placeholder={platform === "tiktok" ? "@username" : platform === "facebook" ? "Page username 或 ID" : platform === "instagram" ? "@username (需 Business 账号)" : "@小红书号"}
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              className="flex-1"
            />
            <Input placeholder="地区(可选)" value={region} onChange={(e) => setRegion(e.target.value)} className="w-32" />
            <Button onClick={() => handle.trim() && addMut.mutate(handle.trim())} disabled={!handle.trim() || addMut.isPending}>
              {addMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              添加
            </Button>
          </div>
        </div>
        {platform === "tiktok" && (
          <div>
            <div className="text-sm font-medium mb-2">关键词发现（TikTok）</div>
            <div className="flex gap-2">
              <Input placeholder="行业关键词（如 美容 / fitness）" value={keyword} onChange={(e) => setKeyword(e.target.value)} className="flex-1" />
              <Button variant="outline" onClick={handleDiscover} disabled={discovering || !keyword.trim()}>
                {discovering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                发现
              </Button>
            </div>
            {discoverNote && <div className="text-xs text-muted-foreground mt-2">{discoverNote}</div>}
            {discovered.length > 0 && (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                {discovered.map((c) => (
                  <div key={c.handle} className="flex items-center gap-3 p-2 rounded border bg-muted/30">
                    {c.avatarUrl ? (
                      <img
                        src={proxyXhsImage(c.avatarUrl) || c.avatarUrl}
                        alt=""
                        className="w-9 h-9 rounded-full object-cover bg-muted"
                        referrerPolicy="no-referrer"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-muted" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">@{c.handle}</div>
                      <div className="text-xs text-muted-foreground">{formatCount(c.followerCount)} 粉 · {formatCount(c.videoCount)} 作品</div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => addMut.mutate(c.handle)} disabled={addMut.isPending}>
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* 列表 */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">加载中...</div>
      ) : list.length === 0 ? (
        <Card className="p-12 text-center">
          <Users2 className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">还没有添加任何 {platformMeta.name} 同行</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.map((c: any) => (
            <Card key={c.id} className={`p-4 cursor-pointer hover:shadow-md transition ${openId === c.id ? "ring-2 ring-primary" : ""}`} onClick={() => setOpenId(c.id)}>
              <div className="flex items-start gap-3">
                {c.avatarUrl ? (
                  <img
                    src={proxyXhsImage(c.avatarUrl) || c.avatarUrl}
                    alt=""
                    className="w-12 h-12 rounded-full object-cover bg-muted"
                    referrerPolicy="no-referrer"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-muted" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{c.displayName || c.handle}</div>
                  <div className="text-xs text-muted-foreground truncate">@{c.handle}</div>
                  <div className="flex gap-3 mt-2 text-xs">
                    <span><strong>{formatCount(c.followerCount)}</strong> 粉</span>
                    <span><strong>{c.postCount || 0}</strong> 样本</span>
                  </div>
                </div>
                <Badge variant="outline" className={platformMeta.borderClass}>
                  {platformMeta.shortName}
                </Badge>
              </div>
              <div className="flex gap-2 mt-3 pt-3 border-t" onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="ghost" onClick={() => syncMut.mutate(c.id)} disabled={syncMut.isPending}>
                  <RefreshCw className={`h-3.5 w-3.5 ${syncMut.isPending ? "animate-spin" : ""}`} />
                </Button>
                {c.profileUrl && (
                  <a href={c.profileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
                <ConfirmDialog
                  title="删除同行账号"
                  description={<>确定删除 <strong>@{c.handle}</strong>？该账号下已抓取的 <strong>{c.postCount || 0}</strong> 条爆款样本会一并被删除，此操作不可撤销。</>}
                  confirmLabel="删除"
                  destructive
                  onConfirm={() => delMut.mutate(c.id)}
                  trigger={
                    <Button size="sm" variant="ghost" className="ml-auto text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  }
                />
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* 行业聚合分析 */}
      {insightsOpen && (
        <Card className="p-5 space-y-5 border-primary/30 bg-primary/5">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">行业聚合分析（{platformMeta.name}）</h2>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => insightsQuery.refetch()} disabled={insightsQuery.isFetching}>
              <RefreshCw className={`h-3.5 w-3.5 ${insightsQuery.isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>

          {insightsQuery.isLoading || insightsQuery.isFetching ? (
            <div className="flex items-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在跨账号聚合数据并让 AI 提炼爆款规律…
            </div>
          ) : insightsQuery.error ? (
            <div className="text-sm text-destructive py-4">
              {(insightsQuery.error as any)?.message || "分析失败"}
              <div className="text-xs text-muted-foreground mt-1">提示：请先点同行卡上的 ↻ 抓取真实数据</div>
            </div>
          ) : insightsQuery.data ? (() => {
            const d = insightsQuery.data;
            return (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Stat label="分析账号" value={d.competitorsAnalyzed} />
                  <Stat label="样本内容" value={d.postsAnalyzed} />
                  <Stat label="累计播放" value={formatCount(d.totalViews)} />
                  <Stat label="平均互动率" value={`${d.avgEngagementRate}%`} />
                </div>

                <div className="rounded-lg bg-background p-4 border">
                  <div className="flex items-center gap-2 text-sm font-medium mb-2">
                    <Sparkles className="h-4 w-4 text-amber-500" />爆款公式
                  </div>
                  <p className="text-sm leading-relaxed">{d.viralFormula}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <InsightBlock icon={<Clock className="h-4 w-4" />} title={`最佳发布时段（${d.timezoneLabel}）`} body={d.postingStrategy}
                    tail={d.bestPostingHoursLocal.length > 0 && (
                      <div className="flex gap-1.5 flex-wrap mt-2">
                        {d.bestPostingHoursLocal.map((h) => (
                          <Badge key={h} variant="secondary">{h}:00</Badge>
                        ))}
                      </div>
                    )} />
                  <InsightBlock icon={<TrendingUp className="h-4 w-4" />} title="时长策略" body={`${d.durationStrategy} 平均 ${d.avgVideoLengthSec}s`} />
                  <InsightBlock icon={<Hash className="h-4 w-4" />} title="标签策略" body={d.hashtagStrategy}
                    tail={d.topHashtags.length > 0 && (
                      <div className="flex gap-1.5 flex-wrap mt-2">
                        {d.topHashtags.slice(0, 8).map((t) => (
                          <Badge key={t.tag} variant="outline">#{t.tag} <span className="ml-1 text-muted-foreground">×{t.count}</span></Badge>
                        ))}
                      </div>
                    )} />
                  <InsightBlock icon={<Music className="h-4 w-4" />} title="BGM 策略" body={d.bgmStrategy}
                    tail={d.topMusicTracks.length > 0 && (
                      <ul className="text-xs text-muted-foreground mt-2 space-y-0.5">
                        {d.topMusicTracks.slice(0, 3).map((m) => (
                          <li key={m.track}>· {m.track} <span className="text-foreground/60">×{m.count}</span></li>
                        ))}
                      </ul>
                    )} />
                </div>

                {d.keyInsights.length > 0 && (
                  <div className="rounded-lg bg-background p-4 border">
                    <div className="text-sm font-medium mb-2">关键洞察</div>
                    <ul className="space-y-1.5">
                      {d.keyInsights.map((k, i) => (
                        <li key={i} className="text-sm flex gap-2">
                          <span className="text-primary font-semibold">{i + 1}.</span><span>{k}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {d.competitorBreakdown.length > 0 && (
                  <div className="rounded-lg bg-background p-4 border overflow-x-auto">
                    <div className="text-sm font-medium mb-2">同行表现拆解</div>
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground">
                        <tr className="text-left border-b">
                          <th className="py-1.5 pr-3">账号</th>
                          <th className="py-1.5 pr-3">粉丝</th>
                          <th className="py-1.5 pr-3">样本</th>
                          <th className="py-1.5 pr-3">均播放</th>
                          <th className="py-1.5">最强钩子</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.competitorBreakdown.map((c) => (
                          <tr key={c.handle} className="border-b last:border-b-0">
                            <td className="py-1.5 pr-3 font-medium">@{c.handle}</td>
                            <td className="py-1.5 pr-3">{formatCount(c.followers)}</td>
                            <td className="py-1.5 pr-3">{c.posts}</td>
                            <td className="py-1.5 pr-3">{formatCount(c.avgViews)}</td>
                            <td className="py-1.5 truncate max-w-[280px]">{c.topHook}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            );
          })() : null}
        </Card>
      )}

      {/* 详情 — 同行内容 */}
      {openId && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <h2 className="font-semibold">高赞内容样本</h2>
            <Badge variant="secondary">{posts.length} 条</Badge>
            <Tabs value={postFilter} onValueChange={(v) => setPostFilter(v as any)} className="ml-auto">
              <TabsList className="h-8">
                <TabsTrigger value="all" className="text-xs h-6">全部</TabsTrigger>
                <TabsTrigger value="starred" className="text-xs h-6">
                  <Star className="h-3 w-3 mr-1 fill-amber-400 text-amber-400" />精选 {starredCount}
                </TabsTrigger>
                <TabsTrigger value="viral" className="text-xs h-6">🔥 爆款 {viralCount}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          {posts.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">暂无样本，点 ↻ 刷新</div>
          ) : filteredPosts.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              {postFilter === "starred" ? "还没收藏任何作品，点作品上的 ⭐ 加入精选库" : "暂无爆款样本"}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {filteredPosts.map((p: any) => {
                const isStarred = p.analysisJson?.starred === true;
                return (
                  <div key={p.id} className="block group relative">
                    <a href={p.postUrl || "#"} target="_blank" rel="noreferrer">
                      {p.coverUrl ? (
                        <img
                          src={proxyXhsImage(p.coverUrl) || p.coverUrl}
                          alt=""
                          className="w-full aspect-[3/4] object-cover rounded border bg-muted"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            const img = e.currentTarget;
                            if (img.dataset.fallback === "1") return;
                            img.dataset.fallback = "1";
                            img.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 160'><rect width='120' height='160' fill='%23f1f5f9'/><text x='60' y='85' text-anchor='middle' fill='%2394a3b8' font-size='12' font-family='sans-serif'>无封面</text></svg>";
                          }}
                        />
                      ) : (
                        <div className="w-full aspect-[3/4] bg-muted rounded border" />
                      )}
                    </a>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        starMut.mutate({ postId: p.id, starred: !isStarred });
                      }}
                      className={`absolute top-1.5 right-1.5 rounded-full p-1.5 backdrop-blur transition ${
                        isStarred ? "bg-amber-400/95 text-white shadow" : "bg-black/40 text-white/80 hover:bg-black/60"
                      }`}
                      title={isStarred ? "取消精选" : "加入精选库（AI 长期借鉴）"}
                    >
                      <Star className={`h-3.5 w-3.5 ${isStarred ? "fill-white" : ""}`} />
                    </button>
                    <a href={p.postUrl || "#"} target="_blank" rel="noreferrer" className="block">
                      <div className="mt-1.5 text-xs line-clamp-2 group-hover:text-primary">{p.description || p.title || "(无描述)"}</div>
                      <div className="flex gap-2 mt-1 text-[10px] text-muted-foreground items-center flex-wrap">
                        {p.viewCount > 0 && <span className="inline-flex items-center gap-0.5"><Eye className="h-3 w-3" />{formatCount(p.viewCount)}</span>}
                        <span className="inline-flex items-center gap-0.5"><Heart className="h-3 w-3" />{formatCount(p.likeCount)}</span>
                        <span className="inline-flex items-center gap-0.5"><MessageCircle className="h-3 w-3" />{formatCount(p.commentCount)}</span>
                        {p.isViral && <Badge className="text-[9px] py-0 px-1 bg-red-500">爆款</Badge>}
                        {isStarred && <Badge className="text-[9px] py-0 px-1 bg-amber-500">⭐ 精选</Badge>}
                      </div>
                    </a>
                    {/* 口播文案提取（仅视频帖；耗 1 积分） */}
                    {p.mediaUrl && /\.(mp4|mov|m3u8|webm)(\?|$|#|\/)/i.test(String(p.mediaUrl)) && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (p.transcript) {
                            setTranscriptOpenPostId(p.id);
                          } else {
                            transcribeMut.mutate(p.id);
                          }
                        }}
                        disabled={transcribeMut.isPending && transcribeMut.variables === p.id}
                        className="mt-1.5 w-full text-[10px] flex items-center justify-center gap-1 px-2 py-1 rounded border border-dashed hover:bg-muted/50 transition disabled:opacity-50"
                        title={p.transcript ? "查看已提取的口播文案" : "用 Whisper 提取该视频的口播（约 1 积分）"}
                      >
                        {transcribeMut.isPending && transcribeMut.variables === p.id ? (
                          <><Loader2 className="h-3 w-3 animate-spin" />提取中…</>
                        ) : p.transcript ? (
                          <><FileText className="h-3 w-3" />查看口播</>
                        ) : (
                          <><Mic className="h-3 w-3" />提取口播</>
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* 30 天运营策略弹窗 */}
      {/* 口播文案查看弹窗 */}
      <Dialog open={transcriptOpenPostId !== null} onOpenChange={(o) => !o && setTranscriptOpenPostId(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-amber-500" />
              视频口播文案
            </DialogTitle>
            <DialogDescription>
              由 Whisper 自动转写。可直接复制作为爆款 hook 灵感参考。
            </DialogDescription>
          </DialogHeader>
          {(() => {
            const post = posts.find((p: any) => p.id === transcriptOpenPostId);
            if (!post) return null;
            return (
              <div className="space-y-3 pt-2">
                <div className="text-xs text-muted-foreground">{post.description || post.title || "(无描述)"}</div>
                <div className="rounded-lg bg-muted/50 p-4 text-sm whitespace-pre-wrap leading-relaxed max-h-[50vh] overflow-y-auto">
                  {post.transcript || <span className="text-muted-foreground italic">暂无转写文本</span>}
                </div>
                {post.transcript && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(post.transcript);
                      toast({ title: "已复制到剪贴板" });
                    }}
                  >
                    复制全文
                  </Button>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={strategyOpen} onOpenChange={setStrategyOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Compass className="h-5 w-5 text-violet-600" />
              30 天内容运营策略（{platformMeta.name}）
            </DialogTitle>
            <DialogDescription>
              基于您长期沉淀的 ⭐ 精选 + 🔥 爆款样本，AI 给出未来一个月的运营节奏与执行清单。
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-2 items-center pt-2">
            <Input
              placeholder="行业关键词（如：宠物、烘焙、健身… 留空走通用）"
              value={strategyNiche}
              onChange={(e) => setStrategyNiche(e.target.value)}
              className="flex-1"
            />
            <Button onClick={() => strategyQuery.refetch()} disabled={strategyQuery.isFetching}>
              {strategyQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
              重新生成
            </Button>
          </div>

          {strategyQuery.isLoading || strategyQuery.isFetching ? (
            <div className="flex items-center gap-2 py-12 justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              AI 正在基于精选同行素材规划 30 天运营策略…
            </div>
          ) : strategyQuery.error ? (
            <div className="py-6 text-sm text-destructive">
              {(strategyQuery.error as any)?.message || "生成失败"}
              <div className="text-xs text-muted-foreground mt-1">提示：先在同行库添加 3-5 个对标账号并点 ↻ 抓取作品。</div>
            </div>
          ) : strategyQuery.data ? (() => {
            const { strategy: s, meta } = strategyQuery.data;
            return (
              <div className="space-y-5 pt-2">
                <div className="text-xs text-muted-foreground flex gap-3 flex-wrap">
                  <span>📊 分析 {meta.competitorsAnalyzed} 个同行</span>
                  <span>⭐ {meta.starredSamples} 条精选</span>
                  <span>🔥 {meta.viralSamples} 条爆款</span>
                  <span>共采纳 {meta.totalSamplesUsed} 条样本</span>
                </div>

                <div className="rounded-lg border bg-violet-50 dark:bg-violet-950/20 p-4">
                  <div className="text-sm font-semibold text-violet-700 dark:text-violet-300 mb-1.5">总策略</div>
                  <p className="text-sm leading-relaxed">{s.summary}</p>
                </div>

                {s.contentPillars?.length > 0 && (
                  <div>
                    <div className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <BarChart3 className="h-4 w-4" /> 内容支柱
                    </div>
                    <div className="grid md:grid-cols-2 gap-2">
                      {s.contentPillars.map((p, i) => (
                        <div key={i} className="rounded-lg border p-3 bg-background">
                          <div className="flex items-center justify-between mb-1">
                            <div className="font-medium text-sm">{p.name}</div>
                            <Badge variant="secondary">{p.ratio}%</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">{p.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {s.weeklyCadence && (
                  <div className="rounded-lg border p-3 bg-background">
                    <div className="text-sm font-semibold mb-1 flex items-center gap-2">
                      <Calendar className="h-4 w-4" /> 发布频率
                    </div>
                    <div className="text-sm">
                      <span className="text-2xl font-bold text-violet-600">{s.weeklyCadence.postsPerWeek}</span>
                      <span className="text-muted-foreground"> 条 / 周</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{s.weeklyCadence.rationale}</p>
                  </div>
                )}

                {s.hookTemplates?.length > 0 && (
                  <div>
                    <div className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-amber-500" /> 钩子模板库
                    </div>
                    <div className="space-y-1.5">
                      {s.hookTemplates.map((h, i) => (
                        <div key={i} className="rounded border p-2.5 bg-background text-xs">
                          <div className="font-medium">{h.template}</div>
                          <div className="text-muted-foreground mt-0.5">证据：{h.evidence}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {s.hashtagStrategy && (
                  <div className="rounded-lg border p-3 bg-background">
                    <div className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <Hash className="h-4 w-4" /> 标签策略
                    </div>
                    <div className="text-xs text-muted-foreground mb-1">核心标签（每条都用）</div>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {s.hashtagStrategy.core?.map((t, i) => <Badge key={i} className="bg-violet-600 text-white">{t}</Badge>)}
                    </div>
                    <div className="text-xs text-muted-foreground mb-1">轮换标签（按内容主题挑）</div>
                    <div className="flex flex-wrap gap-1">
                      {s.hashtagStrategy.rotation?.map((t, i) => <Badge key={i} variant="outline">{t}</Badge>)}
                    </div>
                  </div>
                )}

                {s.bestPostingWindows?.length > 0 && (
                  <div className="rounded-lg border p-3 bg-background">
                    <div className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <Clock className="h-4 w-4" /> 黄金发布时段
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {s.bestPostingWindows.map((w, i) => <Badge key={i} variant="secondary">{w}</Badge>)}
                    </div>
                  </div>
                )}

                <div className="grid md:grid-cols-2 gap-3">
                  {s.doList?.length > 0 && (
                    <div className="rounded-lg border p-3 bg-emerald-50 dark:bg-emerald-950/20">
                      <div className="text-sm font-semibold mb-2 flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="h-4 w-4" /> 一定要做
                      </div>
                      <ul className="text-xs space-y-1">
                        {s.doList.map((x, i) => <li key={i}>· {x}</li>)}
                      </ul>
                    </div>
                  )}
                  {s.dontList?.length > 0 && (
                    <div className="rounded-lg border p-3 bg-rose-50 dark:bg-rose-950/20">
                      <div className="text-sm font-semibold mb-2 flex items-center gap-1.5 text-rose-700 dark:text-rose-300">
                        <XCircle className="h-4 w-4" /> 一定要避免
                      </div>
                      <ul className="text-xs space-y-1">
                        {s.dontList.map((x, i) => <li key={i}>· {x}</li>)}
                      </ul>
                    </div>
                  )}
                </div>

                {s.next30DaysRoadmap?.length > 0 && (
                  <div>
                    <div className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <Calendar className="h-4 w-4" /> 30 天 Roadmap
                    </div>
                    <div className="space-y-2">
                      {s.next30DaysRoadmap.map((w, i) => (
                        <div key={i} className="rounded-lg border p-3 bg-background flex gap-3">
                          <div className="flex-shrink-0 w-12 h-12 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 font-bold flex items-center justify-center text-xs">
                            W{w.week}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium">{w.focus}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">{w.deliverables}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })() : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
