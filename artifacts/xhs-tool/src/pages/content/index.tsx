import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, FileText, Trash2, Edit, Send, Calendar, Eye, Heart, Search, TrendingUp } from "lucide-react";
import { useLocation } from "wouter";

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  draft: { label: "草稿", variant: "secondary" },
  published: { label: "已发布", variant: "default" },
  scheduled: { label: "待发布", variant: "outline" },
  review: { label: "审核中", variant: "outline" },
};

export default function ContentList() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [statusFilter, setStatusFilter] = useState("all");
  const [regionFilter, setRegionFilter] = useState("ALL");

  const { data: content = [], isLoading } = useQuery({
    queryKey: ["content", statusFilter, regionFilter],
    queryFn: () => api.content.list({ status: statusFilter, region: regionFilter }),
  });

  const { data: trackings = [] } = useQuery<any[]>({
    queryKey: ["tracking"],
    queryFn: api.tracking.list,
  });
  // 按 contentId 建立查找索引：可以一行一行展示该笔记的实时表现
  const trackingByContentId = new Map<number, any>();
  for (const t of trackings) {
    if (t.contentId) trackingByContentId.set(Number(t.contentId), t);
  }

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.content.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["content"] });
      toast({ title: "内容已删除" });
    },
  });

  const publishMutation = useMutation({
    mutationFn: (id: number) => api.content.publish(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["content"] });
      toast({ title: "内容已发布" });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">内容管理</h1>
          <p className="text-muted-foreground">创建和管理小红书内容</p>
        </div>
        <Link href="/content/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            创建内容
          </Button>
        </Link>
      </div>

      <div className="flex gap-3 flex-wrap">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="draft">草稿</SelectItem>
            <SelectItem value="published">已发布</SelectItem>
            <SelectItem value="scheduled">待发布</SelectItem>
          </SelectContent>
        </Select>
        <Select value={regionFilter} onValueChange={setRegionFilter}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="地区" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部地区</SelectItem>
            <SelectItem value="SG">新加坡</SelectItem>
            <SelectItem value="HK">香港</SelectItem>
            <SelectItem value="MY">马来西亚</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="pt-6 h-24" />
            </Card>
          ))}
        </div>
      ) : content.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground py-12">
            <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>暂无内容，点击上方按钮创建</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {content.map((item: any) => {
            const sc = statusConfig[item.status] || statusConfig.draft;
            const tracking = trackingByContentId.get(Number(item.id));
            const m = tracking?.latestMetrics || {};
            const ranks: any[] = tracking?.latestRanks || [];
            const bestRank = ranks.filter((r) => r.rank).sort((a, b) => a.rank - b.rank)[0];
            return (
              <Card key={item.id} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-semibold truncate">{item.title}</h3>
                        <Badge variant={sc.variant}>{sc.label}</Badge>
                        {tracking && (
                          <button
                            onClick={() => setLocation(`/tracking/${tracking.id}`)}
                            className="inline-flex items-center gap-2 text-xs px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 transition-colors"
                            title="点击查看追踪详情"
                          >
                            <TrendingUp className="h-3 w-3" />
                            <span className="flex items-center gap-1"><Heart className="h-3 w-3" />{m.likedCount ?? "—"}</span>
                            {bestRank && (
                              <span className="flex items-center gap-1 border-l border-orange-200 pl-2">
                                <Search className="h-3 w-3" />#{bestRank.rank}
                              </span>
                            )}
                          </button>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {item.body}
                      </p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        {item.account && (
                          <span className="flex items-center gap-1">
                            <span className="w-4 h-4 rounded-full bg-primary/10 flex items-center justify-center text-[10px] text-primary font-bold">
                              {item.account.nickname?.charAt(0)}
                            </span>
                            {item.account.nickname}
                          </span>
                        )}
                        {item.tags?.length > 0 && (
                          <span>
                            {item.tags.slice(0, 3).map((t: string) => `#${t}`).join(" ")}
                          </span>
                        )}
                        <span>
                          {new Date(item.createdAt).toLocaleDateString("zh-CN")}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Link href={`/content/${item.id}`}>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                      {item.status === "draft" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => publishMutation.mutate(item.id)}
                        >
                          <Send className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => {
                          if (confirm("确定删除该内容？")) deleteMutation.mutate(item.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
