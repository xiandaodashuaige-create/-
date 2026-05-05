import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, FileText, Image, Calendar, TrendingUp, Clock, PenSquare, ChevronRight, Heart, Bookmark, MessageCircle, Search } from "lucide-react";
import { usePlatform } from "@/lib/platform-context";
import { PLATFORMS, PLATFORM_LIST } from "@/lib/platform-meta";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { activePlatform, setActivePlatform } = usePlatform();
  const platformMeta = PLATFORMS[activePlatform];
  const PlatformIcon = platformMeta.icon;

  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats", activePlatform],
    queryFn: () => api.dashboard.stats({ platform: activePlatform }),
  });
  const { data: activity } = useQuery({
    queryKey: ["recent-activity", activePlatform],
    queryFn: () => api.dashboard.recentActivity(8, activePlatform),
  });
  const { data: byRegion } = useQuery({
    queryKey: ["content-by-region", activePlatform],
    queryFn: () => api.dashboard.contentByRegion({ platform: activePlatform }),
  });
  const { data: byStatus } = useQuery({
    queryKey: ["content-by-status", activePlatform],
    queryFn: () => api.dashboard.contentByStatus({ platform: activePlatform }),
  });
  const { data: trackings = [] } = useQuery<any[]>({
    queryKey: ["tracking"],
    queryFn: api.tracking.list,
    enabled: activePlatform === "xhs",
  });

  const statCards = [
    { label: `${platformMeta.shortName} 账号`, value: stats?.totalAccounts ?? 0, sub: `${stats?.activeAccounts ?? 0} 活跃`, icon: Users, color: "text-blue-500" },
    { label: "总内容数", value: stats?.totalContent ?? 0, sub: `今日 +${stats?.contentToday ?? 0}`, icon: FileText, color: "text-green-500" },
    { label: "已发布", value: stats?.publishedContent ?? 0, sub: `${stats?.scheduledContent ?? 0} 待发布`, icon: TrendingUp, color: "text-orange-500" },
    { label: "素材总数", value: stats?.totalAssets ?? 0, sub: `${stats?.draftContent ?? 0} 草稿`, icon: Image, color: "text-purple-500" },
  ];

  const regionLabels: Record<string, string> = { SG: "新加坡", HK: "香港", MY: "马来西亚", GLOBAL: "全球" };
  const statusLabels: Record<string, string> = { draft: "草稿", published: "已发布", scheduled: "待发布", review: "审核中", failed: "失败" };

  // 复制爆款 banner 文案：当前 XHS 走完整 wizard，其他平台目前只到内容/素材层
  const heroTitle = activePlatform === "xhs" ? "复制爆款·创建新笔记" : `复制爆款·创建 ${platformMeta.shortName} 内容`;
  const heroDesc = activePlatform === "xhs"
    ? "分析同行爆款 → AI生成同款原创 → 最佳时间发布，站在巨人肩膀上轻松出爆款"
    : platformMeta.enabled
    ? `${platformMeta.name} 自动发布已就绪 — 走通整套：内容生成 → 计划 → API 投递`
    : `${platformMeta.name} 内容/素材/草稿可立刻使用，自动发布将在 OAuth 接入后开放`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className={`w-11 h-11 rounded-xl ${platformMeta.bgClass} ${platformMeta.borderClass} border flex items-center justify-center`}>
            <PlatformIcon className={`h-6 w-6 ${platformMeta.textClass}`} />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{platformMeta.name} · 仪表盘</h1>
            <p className="text-muted-foreground text-sm">鹿联 Viral Suite · 全平台爆款矩阵概览</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {PLATFORM_LIST.map((p) => {
            const Icon = p.icon;
            const active = p.id === activePlatform;
            return (
              <button
                key={p.id}
                onClick={() => setActivePlatform(p.id)}
                title={`切换到 ${p.name}${p.enabled ? "" : "（即将开放）"}`}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${
                  active
                    ? `${p.bgClass} ${p.textClass} ${p.borderClass} font-semibold`
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{p.shortName}</span>
              </button>
            );
          })}
        </div>
      </div>

      <button onClick={() => setLocation("/workflow")} className="w-full group">
        <div
          className="relative overflow-hidden rounded-2xl p-6 text-white shadow-lg hover:shadow-xl transition-all"
          style={{
            background:
              "linear-gradient(to right, hsl(var(--platform-from)), hsl(var(--platform-via)), hsl(var(--platform-to)))",
          }}
        >
          <div className="absolute right-0 top-0 w-48 h-48 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/4" />
          <div className="absolute right-16 bottom-0 w-32 h-32 bg-white/5 rounded-full translate-y-1/2" />
          <div className="relative flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center">
              <PenSquare className="h-7 w-7" />
            </div>
            <div className="flex-1 text-left">
              <h3 className="text-xl font-bold">{heroTitle}</h3>
              <p className="text-white/80 text-sm mt-0.5">{heroDesc}</p>
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
            <CardTitle className="text-base">
              {activePlatform === "xhs" ? "各地区内容分布" : `${platformMeta.shortName} · 内容地区分布`}
            </CardTitle>
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
                    <Badge variant={s.status === "published" ? "default" : "secondary"}>
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

      {activePlatform === "xhs" && (
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
      )}

      {activePlatform !== "xhs" && (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            <TrendingUp className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p>{platformMeta.name} 笔记/视频表现追踪即将开放</p>
            <p className="text-xs mt-1">完成 OAuth 授权后将自动拉取互动数据</p>
          </CardContent>
        </Card>
      )}

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
