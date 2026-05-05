import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, FileText, Image, Calendar, TrendingUp, Clock, PenSquare, ChevronRight, Sparkles, Heart, Bookmark, MessageCircle, Search } from "lucide-react";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { data: stats } = useQuery({ queryKey: ["dashboard-stats"], queryFn: api.dashboard.stats });
  const { data: activity } = useQuery({ queryKey: ["recent-activity"], queryFn: () => api.dashboard.recentActivity(8) });
  const { data: byRegion } = useQuery({ queryKey: ["content-by-region"], queryFn: api.dashboard.contentByRegion });
  const { data: byStatus } = useQuery({ queryKey: ["content-by-status"], queryFn: api.dashboard.contentByStatus });
  const { data: trackings = [] } = useQuery<any[]>({ queryKey: ["tracking"], queryFn: api.tracking.list });

  const statCards = [
    { label: "总账号数", value: stats?.totalAccounts ?? 0, sub: `${stats?.activeAccounts ?? 0} 活跃`, icon: Users, color: "text-blue-500" },
    { label: "总内容数", value: stats?.totalContent ?? 0, sub: `今日 +${stats?.contentToday ?? 0}`, icon: FileText, color: "text-green-500" },
    { label: "已发布", value: stats?.publishedContent ?? 0, sub: `${stats?.scheduledContent ?? 0} 待发布`, icon: TrendingUp, color: "text-orange-500" },
    { label: "素材总数", value: stats?.totalAssets ?? 0, sub: `${stats?.draftContent ?? 0} 草稿`, icon: Image, color: "text-purple-500" },
  ];

  const regionLabels: Record<string, string> = { SG: "新加坡", HK: "香港", MY: "马来西亚" };
  const statusLabels: Record<string, string> = { draft: "草稿", published: "已发布", scheduled: "待发布", review: "审核中" };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">仪表盘</h1>
          <p className="text-muted-foreground">鹿联AI爆款创作间 · 内容管理概览</p>
        </div>
      </div>

      <button
        onClick={() => setLocation("/workflow")}
        className="w-full group"
      >
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-red-500 via-pink-500 to-rose-400 p-6 text-white shadow-lg hover:shadow-xl transition-all">
          <div className="absolute right-0 top-0 w-48 h-48 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/4" />
          <div className="absolute right-16 bottom-0 w-32 h-32 bg-white/5 rounded-full translate-y-1/2" />
          <div className="relative flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center">
              <PenSquare className="h-7 w-7" />
            </div>
            <div className="flex-1 text-left">
              <h3 className="text-xl font-bold">复制爆款·创建新笔记</h3>
              <p className="text-white/80 text-sm mt-0.5">
                分析同行爆款 → AI生成同款原创 → 最佳时间发布，站在巨人肩膀上轻松出爆款
              </p>
            </div>
            <ChevronRight className="h-6 w-6 text-white/60 group-hover:text-white group-hover:translate-x-1 transition-all" />
          </div>
        </div>
      </button>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{s.label}</p>
                  <p className="text-3xl font-bold mt-1">{s.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{s.sub}</p>
                </div>
                <s.icon className={`h-8 w-8 ${s.color} opacity-80`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">各地区内容分布</CardTitle>
          </CardHeader>
          <CardContent>
            {byRegion && byRegion.length > 0 ? (
              <div className="space-y-3">
                {byRegion.map((r: any) => (
                  <div key={r.region} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{regionLabels[r.region] || r.region}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full"
                          style={{
                            width: `${Math.max(10, (r.count / Math.max(...byRegion.map((x: any) => x.count), 1)) * 100)}%`,
                          }}
                        />
                      </div>
                      <span className="text-sm font-medium w-8 text-right">{r.count}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">暂无数据</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">内容状态分布</CardTitle>
          </CardHeader>
          <CardContent>
            {byStatus && byStatus.length > 0 ? (
              <div className="space-y-3">
                {byStatus.map((s: any) => (
                  <div key={s.status} className="flex items-center justify-between">
                    <Badge
                      variant={s.status === "published" ? "default" : "secondary"}
                    >
                      {statusLabels[s.status] || s.status}
                    </Badge>
                    <span className="text-sm font-medium">{s.count} 篇</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">暂无数据</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-orange-200/60">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-orange-500" />
            我的笔记表现
            <Badge variant="outline" className="text-[10px] ml-1">每 12 小时自动更新</Badge>
          </CardTitle>
          {trackings.length > 0 && (
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => setLocation("/tracking")}>
              查看全部 <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {trackings.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">
              发布笔记后，在第3步粘贴笔记链接，系统会自动追踪互动数和关键词排名
            </div>
          ) : (
            <div className="space-y-2">
              {trackings.slice(0, 3).map((t: any) => {
                const m = t.latestMetrics || {};
                const ranks: any[] = t.latestRanks || [];
                const bestRank = ranks.filter((r) => r.rank).sort((a, b) => a.rank - b.rank)[0];
                return (
                  <button
                    key={t.id}
                    onClick={() => setLocation(`/tracking/${t.id}`)}
                    className="w-full text-left p-3 rounded-lg border hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <p className="font-medium text-sm truncate flex-1">{t.title || t.xhsNoteId}</p>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Heart className="h-3 w-3 text-red-400" />{m.likedCount ?? "—"}</span>
                      <span className="flex items-center gap-1"><Bookmark className="h-3 w-3 text-amber-400" />{m.collectedCount ?? "—"}</span>
                      <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3 text-blue-400" />{m.commentCount ?? "—"}</span>
                      {bestRank && (
                        <span className="flex items-center gap-1 ml-auto text-orange-600 font-medium">
                          <Search className="h-3 w-3" />#{bestRank.rank} · {bestRank.keyword}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" />
            最近动态
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activity && activity.length > 0 ? (
            <div className="space-y-3">
              {activity.map((a: any, i: number) => (
                <div key={a.id || i} className="flex items-start gap-3 text-sm">
                  <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                  <div className="flex-1">
                    <p>{a.description}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(a.createdAt).toLocaleString("zh-CN")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">暂无动态</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
