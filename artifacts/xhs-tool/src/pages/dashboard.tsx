import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, FileText, Image, Calendar, TrendingUp, Clock } from "lucide-react";

export default function Dashboard() {
  const { data: stats } = useQuery({ queryKey: ["dashboard-stats"], queryFn: api.dashboard.stats });
  const { data: activity } = useQuery({ queryKey: ["recent-activity"], queryFn: () => api.dashboard.recentActivity(8) });
  const { data: byRegion } = useQuery({ queryKey: ["content-by-region"], queryFn: api.dashboard.contentByRegion });
  const { data: byStatus } = useQuery({ queryKey: ["content-by-status"], queryFn: api.dashboard.contentByStatus });

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
      <div>
        <h1 className="text-2xl font-bold">仪表盘</h1>
        <p className="text-muted-foreground">小红书内容管理概览</p>
      </div>

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
