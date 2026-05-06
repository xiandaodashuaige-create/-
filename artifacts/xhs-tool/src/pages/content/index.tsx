import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, FileText, Trash2, Edit, Send, Calendar, Eye, Heart, Search, TrendingUp, Image as ImageIcon, Video as VideoIcon, ArrowRight } from "lucide-react";
import { useLocation } from "wouter";
import { usePlatform } from "@/lib/platform-context";
import { PLATFORMS, type PlatformId } from "@/lib/platform-meta";

const ALL_PLATFORMS: PlatformId[] = ["xhs", "tiktok", "instagram", "facebook"];

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
  const { activePlatform, setActivePlatform } = usePlatform();
  const platformMeta = PLATFORMS[activePlatform];
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: content = [], isLoading, isError } = useQuery({
    queryKey: ["content", activePlatform, statusFilter],
    queryFn: () => api.content.list({ platform: activePlatform, status: statusFilter }),
  });

  // 当前平台没有内容时，顺手查别的平台计数 → 一眼提示用户：可能是平台错位（草稿没消失，去其他平台看）
  // 仅在主查询成功且确实空时触发，避免把"加载失败"误判成"平台错位"
  const otherPlatforms = ALL_PLATFORMS.filter((p) => p !== activePlatform);
  const otherCountsQ = useQuery({
    queryKey: ["content-cross-counts", activePlatform, statusFilter],
    enabled: !isLoading && !isError && content.length === 0,
    queryFn: async () => {
      const settled = await Promise.allSettled(
        otherPlatforms.map((p) => api.content.list({ platform: p, status: statusFilter }))
      );
      return otherPlatforms
        .map((p, i) => {
          const r = settled[i];
          const list = r.status === "fulfilled" && Array.isArray(r.value) ? r.value : [];
          return { platform: p, count: list.length };
        })
        .filter((x) => x.count > 0);
    },
    staleTime: 30_000,
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
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg ${platformMeta.bgClass} ${platformMeta.borderClass} border flex items-center justify-center`}>
            <platformMeta.icon className={`h-5 w-5 ${platformMeta.textClass}`} />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{platformMeta.name} · 内容管理</h1>
            <p className="text-muted-foreground text-sm">创建和管理 {platformMeta.name} 内容</p>
          </div>
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
            <p>当前 {platformMeta.name} 平台暂无内容</p>
            {(otherCountsQ.data?.length ?? 0) > 0 && (
              <div className="mt-6 max-w-md mx-auto p-4 rounded-lg bg-amber-50 border border-amber-200 text-left">
                <p className="text-sm font-medium text-amber-900 mb-2">💡 你在其他平台还有草稿，可能只是平台错位了：</p>
                <div className="flex flex-wrap gap-2">
                  {otherCountsQ.data!.map((x) => {
                    const m = PLATFORMS[x.platform];
                    const Icon = m.icon;
                    return (
                      <Button
                        key={x.platform}
                        size="sm"
                        variant="outline"
                        className={`${m.bgClass} ${m.textClass} ${m.borderClass} hover:opacity-80`}
                        onClick={() => setActivePlatform(x.platform)}
                      >
                        <Icon className="h-3.5 w-3.5 mr-1.5" />
                        {m.shortName} · {x.count} 条
                        <ArrowRight className="h-3 w-3 ml-1.5" />
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}
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
            const cover: string | null = Array.isArray(item.imageUrls) && item.imageUrls[0] ? item.imageUrls[0] : null;
            const isVideo = item.mediaType === "video" || (item.videoUrl && String(item.videoUrl).length > 0);
            const imageCount = Array.isArray(item.imageUrls) ? item.imageUrls.length : 0;
            return (
              <Card key={item.id} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    {/* 缩略图：有图显示首图，是视频显示视频图标，纯文字显示文档占位 */}
                    <Link href={`/content/${item.id}`}>
                      <div className="w-20 h-20 shrink-0 rounded-lg border bg-muted overflow-hidden flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity">
                        {cover ? (
                          <img
                            src={cover}
                            alt=""
                            className="w-full h-full object-cover"
                            loading="lazy"
                            onError={(e) => {
                              const el = e.target as HTMLImageElement;
                              el.style.display = "none";
                              (el.parentElement as HTMLElement).innerHTML =
                                '<div class="w-full h-full flex items-center justify-center text-muted-foreground"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></div>';
                            }}
                          />
                        ) : isVideo ? (
                          <VideoIcon className="h-7 w-7 text-muted-foreground" />
                        ) : (
                          <FileText className="h-7 w-7 text-muted-foreground/60" />
                        )}
                      </div>
                    </Link>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-semibold truncate">{item.title}</h3>
                        {/* 媒体类型徽章：图文 N 张 / 视频 / 纯文字 */}
                        <Badge variant="outline" className="text-[10px] gap-1 bg-slate-50 text-slate-700 border-slate-200">
                          {isVideo ? (
                            <><VideoIcon className="h-2.5 w-2.5" />视频</>
                          ) : imageCount > 0 ? (
                            <><ImageIcon className="h-2.5 w-2.5" />图文 {imageCount}</>
                          ) : (
                            <><FileText className="h-2.5 w-2.5" />纯文字</>
                          )}
                        </Badge>
                        {(() => {
                          const pid = (item.platform as PlatformId) || "xhs";
                          const meta = PLATFORMS[pid] ?? platformMeta;
                          const PIcon = meta.icon;
                          return (
                            <Badge
                              variant="outline"
                              className={`text-[10px] gap-1 ${meta.bgClass} ${meta.textClass} ${meta.borderClass}`}
                            >
                              <PIcon className="h-2.5 w-2.5" />
                              {meta.shortName}
                            </Badge>
                          );
                        })()}
                        {/* XHS 没有 OAuth 直发，"published" 实际是"已生成草稿"，需手动到 XHS App 发布；其他平台才是真发布 */}
                        {item.platform === "xhs" && item.status === "published" ? (
                          <Badge variant="secondary" title="XHS 不支持自动发布，已生成的内容请手动复制到小红书 App">
                            已生成 · 手动发布
                          </Badge>
                        ) : (
                          <Badge variant={sc.variant}>{sc.label}</Badge>
                        )}
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
                        {item.account ? (
                          <span className="flex items-center gap-1">
                            <span className="w-4 h-4 rounded-full bg-primary/10 flex items-center justify-center text-[10px] text-primary font-bold">
                              {item.account.nickname?.charAt(0)}
                            </span>
                            {item.account.nickname}
                          </span>
                        ) : (item as any).accountDeleted ? (
                          <span
                            className="flex items-center gap-1 text-muted-foreground/70 italic"
                            title="原账号已被删除，历史内容保留供回顾"
                          >
                            <span className="w-4 h-4 rounded-full bg-muted flex items-center justify-center text-[10px]">×</span>
                            账号已删除
                          </span>
                        ) : null}
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
