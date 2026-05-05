import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  ExternalLink,
  Heart,
  Bookmark,
  MessageCircle,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

export default function TrackingDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id || "0", 10);

  const { data, isLoading } = useQuery({
    queryKey: ["tracking", id],
    queryFn: () => api.tracking.get(id),
    enabled: !!id,
  });

  if (isLoading || !data) return <p className="text-muted-foreground">加载中…</p>;
  const { tracking, metrics, ranks } = data;

  // 互动曲线
  const metricChart = metrics.map((m: any) => ({
    date: m.date.slice(5),
    点赞: m.likedCount,
    收藏: m.collectedCount,
    评论: m.commentCount,
  }));

  // 关键词排名（按关键词分组成多条线）
  const keywords = Array.from(new Set(ranks.map((r: any) => r.keyword))) as string[];
  const allDates = Array.from(new Set(ranks.map((r: any) => r.date))).sort() as string[];
  const rankChart = allDates.map((date) => {
    const row: any = { date: date.slice(5) };
    for (const k of keywords) {
      const r = ranks.find((x: any) => x.date === date && x.keyword === k);
      row[k] = r?.found ? r.rank : null;
    }
    return row;
  });

  const colors = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6"];

  // 趋势计算
  const latest = metrics[metrics.length - 1];
  const prev = metrics[metrics.length - 2];
  const delta = latest && prev ? latest.likedCount - prev.likedCount : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/tracking">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{tracking.title || `笔记 ${tracking.xhsNoteId.slice(-8)}`}</h1>
          <a href={tracking.xhsUrl} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:text-red-500 flex items-center gap-1 mt-1">
            <ExternalLink className="h-3 w-3" />在小红书查看原帖
          </a>
        </div>
      </div>

      {/* 关键指标 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card><CardContent className="pt-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Heart className="h-4 w-4 text-rose-500" />点赞</div>
          <p className="text-2xl font-bold mt-1">{latest?.likedCount ?? "—"}</p>
          {prev && <p className="text-xs flex items-center gap-1 mt-1">
            {delta > 0 ? <TrendingUp className="h-3 w-3 text-green-500" /> : delta < 0 ? <TrendingDown className="h-3 w-3 text-red-500" /> : <Minus className="h-3 w-3 text-muted-foreground" />}
            <span className={delta > 0 ? "text-green-500" : delta < 0 ? "text-red-500" : "text-muted-foreground"}>
              {delta >= 0 ? "+" : ""}{delta} 较昨日
            </span>
          </p>}
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Bookmark className="h-4 w-4 text-amber-500" />收藏</div>
          <p className="text-2xl font-bold mt-1">{latest?.collectedCount ?? "—"}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><MessageCircle className="h-4 w-4 text-blue-500" />评论</div>
          <p className="text-2xl font-bold mt-1">{latest?.commentCount ?? "—"}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-5">
          <div className="text-sm text-muted-foreground">追踪天数</div>
          <p className="text-2xl font-bold mt-1">{metrics.length}</p>
        </CardContent></Card>
      </div>

      {/* 互动曲线 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">互动趋势</CardTitle>
        </CardHeader>
        <CardContent>
          {metricChart.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">还没有数据，定时任务会在 12 小时内拉取</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={metricChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="date" fontSize={12} />
                <YAxis fontSize={12} />
                <ReTooltip />
                <Legend />
                <Line type="monotone" dataKey="点赞" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="收藏" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="评论" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* 关键词排名 */}
      {keywords.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">关键词搜索排名（数字越小越好）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2 text-xs">
              {keywords.map((k, i) => {
                const latestRank = ranks.filter((r: any) => r.keyword === k && r.found).slice(-1)[0];
                return (
                  <Badge key={k} style={{ backgroundColor: colors[i % colors.length] + "20", color: colors[i % colors.length], borderColor: colors[i % colors.length] + "40" }} variant="outline">
                    {k}：{latestRank ? `第 ${latestRank.rank} 位` : "未进前 60"}
                  </Badge>
                );
              })}
            </div>
            {rankChart.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">还没有数据</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={rankChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="date" fontSize={12} />
                  <YAxis fontSize={12} reversed domain={[1, 60]} />
                  <ReTooltip />
                  <Legend />
                  {keywords.map((k, i) => (
                    <Line key={k} type="monotone" dataKey={k} stroke={colors[i % colors.length]} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
            <p className="text-xs text-muted-foreground">
              说明：每天凌晨自动用关键词搜索小红书，找到你的笔记在第几位（仅查前 60 名）
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
