import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePlatform } from "@/lib/platform-context";
import { PLATFORMS, type PlatformId } from "@/lib/platform-meta";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Users2, RefreshCw, Trash2, Search, Sparkles, Heart, MessageCircle, Eye, Plus, ExternalLink, Loader2,
  TrendingUp, Hash, Music, Clock, BarChart3,
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
  const qc = useQueryClient();

  const [handle, setHandle] = useState("");
  const [region, setRegion] = useState("");
  const [keyword, setKeyword] = useState("");
  const [discovered, setDiscovered] = useState<any[]>([]);
  const [discoverNote, setDiscoverNote] = useState<string>("");
  const [discovering, setDiscovering] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [insightsOpen, setInsightsOpen] = useState(false);

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
    onError: (err: any) => toast({ title: "添加失败", description: err?.message ?? "未知错误", variant: "destructive" }),
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
        <Button
          variant={insightsOpen ? "default" : "outline"}
          onClick={() => {
            setInsightsOpen((v) => !v);
            if (!insightsOpen) qc.invalidateQueries({ queryKey: ["competitor-insights", platform] });
          }}
          disabled={list.length === 0}
        >
          <BarChart3 className="h-4 w-4 mr-2" />
          {insightsOpen ? "隐藏行业分析" : "运行行业分析"}
        </Button>
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
                    {c.avatarUrl ? <img src={c.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover" /> : <div className="w-9 h-9 rounded-full bg-muted" />}
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
                {c.avatarUrl ? <img src={c.avatarUrl} alt="" className="w-12 h-12 rounded-full object-cover" /> : <div className="w-12 h-12 rounded-full bg-muted" />}
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
                <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => delMut.mutate(c.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
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
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <h2 className="font-semibold">高赞内容样本</h2>
            <Badge variant="secondary" className="ml-auto">{posts.length} 条</Badge>
          </div>
          {posts.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">暂无样本，点 ↻ 刷新</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {posts.map((p: any) => (
                <a key={p.id} href={p.postUrl || "#"} target="_blank" rel="noreferrer" className="block group">
                  {p.coverUrl ? (
                    <img src={p.coverUrl} alt="" className="w-full aspect-[3/4] object-cover rounded border" loading="lazy" />
                  ) : (
                    <div className="w-full aspect-[3/4] bg-muted rounded border" />
                  )}
                  <div className="mt-1.5 text-xs line-clamp-2 group-hover:text-primary">{p.description || p.title || "(无描述)"}</div>
                  <div className="flex gap-2 mt-1 text-[10px] text-muted-foreground">
                    {p.viewCount > 0 && <span className="inline-flex items-center gap-0.5"><Eye className="h-3 w-3" />{formatCount(p.viewCount)}</span>}
                    <span className="inline-flex items-center gap-0.5"><Heart className="h-3 w-3" />{formatCount(p.likeCount)}</span>
                    <span className="inline-flex items-center gap-0.5"><MessageCircle className="h-3 w-3" />{formatCount(p.commentCount)}</span>
                    {p.isViral && <Badge className="text-[9px] py-0 px-1 bg-red-500">爆款</Badge>}
                  </div>
                </a>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
