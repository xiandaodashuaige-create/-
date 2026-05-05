import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Calendar, Trash2, Clock } from "lucide-react";
import { usePlatform } from "@/lib/platform-context";
import { PLATFORMS } from "@/lib/platform-meta";

export default function Schedules() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { activePlatform } = usePlatform();
  const platformMeta = PLATFORMS[activePlatform];
  const PlatformIcon = platformMeta.icon;

  const { data: allSchedules = [], isLoading } = useQuery({
    queryKey: ["schedules"],
    queryFn: () => api.schedules.list(),
  });
  const schedules = allSchedules.filter((s: any) => (s.account?.platform || "xhs") === activePlatform);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.schedules.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedules"] });
      qc.invalidateQueries({ queryKey: ["content"] });
      toast({ title: "计划已取消" });
    },
  });

  const grouped = schedules.reduce((acc: Record<string, any[]>, s: any) => {
    const date = new Date(s.scheduledAt).toLocaleDateString("zh-CN");
    if (!acc[date]) acc[date] = [];
    acc[date].push(s);
    return acc;
  }, {} as Record<string, any[]>);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg ${platformMeta.bgClass} ${platformMeta.borderClass} border flex items-center justify-center`}>
          <PlatformIcon className={`h-5 w-5 ${platformMeta.textClass}`} />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{platformMeta.name} · 发布计划</h1>
          <p className="text-muted-foreground text-sm">
            {platformMeta.publishMode === "manual"
              ? "手动发布：复制内容 + 下载素材，按计划时间发布"
              : platformMeta.enabled
              ? "自动发布：到点后系统自动调用 API 投递"
              : `${platformMeta.name} 自动发布即将开放，目前可建立计划占位`}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="pt-6 h-24" />
            </Card>
          ))}
        </div>
      ) : schedules.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground py-12">
            <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>暂无发布计划</p>
            <p className="text-xs mt-1">在内容编辑器中设置定时发布</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([date, items]) => (
            <div key={date}>
              <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {date}
              </h3>
              <div className="space-y-2">
                {items.map((schedule: any) => (
                  <Card key={schedule.id}>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Clock className="h-3.5 w-3.5" />
                            {new Date(schedule.scheduledAt).toLocaleTimeString("zh-CN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </div>
                          <div>
                            <p className="font-medium text-sm">
                              {schedule.content?.title || "无标题"}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-muted-foreground">
                                {schedule.account?.nickname}
                              </span>
                              <Badge variant="outline" className="text-[10px]">
                                {schedule.account?.region}
                              </Badge>
                              <Badge
                                variant={schedule.status === "completed" ? "default" : "secondary"}
                                className="text-[10px]"
                              >
                                {schedule.status === "pending" ? "待发布" : schedule.status === "completed" ? "已完成" : schedule.status}
                              </Badge>
                            </div>
                          </div>
                        </div>
                        {schedule.status === "pending" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => {
                              if (confirm("确定取消该计划？")) deleteMutation.mutate(schedule.id);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
