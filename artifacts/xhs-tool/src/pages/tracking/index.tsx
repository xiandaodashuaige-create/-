import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  TrendingUp,
  Plus,
  RefreshCw,
  Trash2,
  Heart,
  Bookmark,
  MessageCircle,
  Search,
  ExternalLink,
  Activity,
} from "lucide-react";
import HotTopicsCard from "@/components/tracking/HotTopicsCard";
import { usePlatform } from "@/lib/platform-context";
import { PLATFORMS } from "@/lib/platform-meta";

export default function TrackingPage() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { activePlatform, setActivePlatform } = usePlatform();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ xhsUrl: "", title: "", keywords: "" });

  const { data: list = [], isLoading } = useQuery<any[]>({
    queryKey: ["tracking"],
    queryFn: () => api.tracking.list(),
  });

  const addMutation = useMutation({
    mutationFn: () =>
      api.tracking.add({
        xhsUrl: form.xhsUrl.trim(),
        title: form.title.trim(),
        targetKeywords: form.keywords.split(/[,，]/).map((k) => k.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      toast({ title: "添加成功", description: "笔记已加入追踪，首次数据将在 1 分钟内拉取" });
      setOpen(false);
      setForm({ xhsUrl: "", title: "", keywords: "" });
      qc.invalidateQueries({ queryKey: ["tracking"] });
    },
    onError: (e: any) => toast({ title: "添加失败", description: e.message, variant: "destructive" }),
  });

  const refreshMutation = useMutation({
    mutationFn: (id: number) => api.tracking.refresh(id),
    onSuccess: () => {
      toast({ title: "已触发刷新", description: "数据将在 10 秒内更新" });
      setTimeout(() => qc.invalidateQueries({ queryKey: ["tracking"] }), 8000);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.tracking.remove(id),
    onSuccess: () => {
      toast({ title: "已移除追踪" });
      qc.invalidateQueries({ queryKey: ["tracking"] });
    },
  });

  const isXhs = activePlatform === "xhs";
  const platformMeta = PLATFORMS[activePlatform];

  return (
    <div className="space-y-6">
      {!isXhs && (
        <div className={`rounded-xl border ${platformMeta.borderClass} ${platformMeta.bgClass} px-4 py-3 text-sm`}>
          <p className={`font-medium ${platformMeta.textClass}`}>{platformMeta.name} · 表现追踪</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            互动数据将通过 {platformMeta.publishVia === "ayrshare" ? "Ayrshare 反向回拉" : "Meta Graph Insights API"} 抓取，正在接入中。
            目前可在<button onClick={() => setActivePlatform("xhs")} className="underline mx-1">小红书</button>下使用完整追踪能力。
          </p>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-red-500" />
            {isXhs ? "笔记表现追踪" : `${platformMeta.name} 表现追踪`}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isXhs
              ? "追踪自家笔记发布后的点赞/收藏/评论曲线 + 关键词搜索排名 · 全程公开数据，无需账号授权"
              : `${platformMeta.name} 互动数据接入中，先以列表占位`}
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-red-500 hover:bg-red-600">
              <Plus className="h-4 w-4 mr-1" />添加追踪
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>添加笔记追踪</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label>小红书笔记链接 *</Label>
                <Input
                  placeholder="https://www.xiaohongshu.com/explore/xxxxx?xsec_token=..."
                  value={form.xhsUrl}
                  onChange={(e) => setForm({ ...form, xhsUrl: e.target.value })}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  请在小红书 App 或网页版打开笔记，点击"分享"→"复制链接"得到的链接
                </p>
              </div>
              <div>
                <Label>笔记标题（可选，提高匹配率）</Label>
                <Input
                  placeholder="例如：新加坡10个最值得打卡的咖啡馆"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </div>
              <div>
                <Label>目标关键词（最多 5 个，用逗号分隔）</Label>
                <Input
                  placeholder="新加坡咖啡, 咖啡馆推荐, 周末咖啡"
                  value={form.keywords}
                  onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  每天会自动查这些关键词下，你的笔记排在第几位
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
              <Button onClick={() => addMutation.mutate()} disabled={!form.xhsUrl.trim() || addMutation.isPending}>
                {addMutation.isPending ? "添加中..." : "添加"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {isLoading && <p className="text-muted-foreground">加载中…</p>}
          {!isLoading && list.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center space-y-3">
                <Activity className="h-12 w-12 text-muted-foreground/40 mx-auto" />
                <p className="text-muted-foreground">还没有追踪任何笔记</p>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                  发布完笔记后，回来这里粘贴笔记链接 + 你想抢占的关键词，系统每天自动追踪你的互动数和搜索排名
                </p>
              </CardContent>
            </Card>
          )}
          {list.map((t) => {
            const m = t.latestMetrics;
            return (
              <Card key={t.id} className="hover:border-red-200 transition-colors">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <Link href={`/tracking/${t.id}`}>
                        <h3 className="font-medium hover:text-red-500 cursor-pointer truncate">
                          {t.title || `笔记 ${t.xhsNoteId.slice(-8)}`}
                        </h3>
                      </Link>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {(t.targetKeywords || []).map((k: string) => (
                          <Badge key={k} variant="outline" className="text-xs">
                            <Search className="h-3 w-3 mr-1" />{k}
                          </Badge>
                        ))}
                      </div>
                      <div className="flex items-center gap-4 mt-3 text-sm">
                        <span className="flex items-center gap-1 text-rose-500">
                          <Heart className="h-3.5 w-3.5" />{m?.likedCount ?? "—"}
                        </span>
                        <span className="flex items-center gap-1 text-amber-500">
                          <Bookmark className="h-3.5 w-3.5" />{m?.collectedCount ?? "—"}
                        </span>
                        <span className="flex items-center gap-1 text-blue-500">
                          <MessageCircle className="h-3.5 w-3.5" />{m?.commentCount ?? "—"}
                        </span>
                        <a href={t.xhsUrl} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:text-red-500 flex items-center gap-1 ml-auto">
                          <ExternalLink className="h-3 w-3" />原帖
                        </a>
                      </div>
                      {t.lastCheckedAt && (
                        <p className="text-xs text-muted-foreground mt-2">
                          上次刷新：{new Date(t.lastCheckedAt).toLocaleString("zh-CN")}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => refreshMutation.mutate(t.id)} disabled={refreshMutation.isPending}>
                        <RefreshCw className={`h-3.5 w-3.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => {
                        if (confirm("确定取消追踪这条笔记？历史数据将保留但不再更新")) deleteMutation.mutate(t.id);
                      }}>
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div>
          <HotTopicsCard />
        </div>
      </div>
    </div>
  );
}
