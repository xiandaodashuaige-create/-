import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { api } from "@/lib/api";
import { usePlatform } from "@/lib/platform-context";
import { PLATFORMS, type PlatformId } from "@/lib/platform-meta";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Heart, Link2, ShieldCheck, ArrowRight } from "lucide-react";

type Mode = "needs-auth" | "xhs-only";

export function PlatformGuard({
  mode,
  children,
}: {
  mode: Mode;
  children: React.ReactNode;
}) {
  const { activePlatform, setActivePlatform } = usePlatform();
  const meta = PLATFORMS[activePlatform];

  if (mode === "xhs-only" && activePlatform !== "xhs") {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <Card className="border-red-200 bg-red-50/40">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
              <Heart className="h-6 w-6 text-red-500" />
            </div>
            <h2 className="text-lg font-semibold">此功能为小红书专属</h2>
            <p className="text-sm text-muted-foreground">
              当前平台是 <b>{meta.name}</b>。该模块（工作流向导 / 笔记追踪 / 敏感词）
              只针对小红书业务设计，{meta.name} 请使用左侧的「同行库」「AI 自动驾驶」「市场数据」与「定时发布」。
            </p>
            <div className="flex justify-center gap-2 pt-2">
              <Button onClick={() => setActivePlatform("xhs")} className="bg-red-500 hover:bg-red-600">
                <Heart className="h-4 w-4 mr-1.5" /> 切回小红书
              </Button>
              <Button variant="outline" asChild>
                <Link href="/autopilot">
                  去 {meta.name} 自动驾驶 <ArrowRight className="h-4 w-4 ml-1.5" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (mode === "needs-auth") {
    return <NeedsAuthGate platform={activePlatform}>{children}</NeedsAuthGate>;
  }

  return <>{children}</>;
}

function NeedsAuthGate({ platform, children }: { platform: PlatformId; children: React.ReactNode }) {
  const meta = PLATFORMS[platform];
  const { data: accounts, isLoading } = useQuery({
    queryKey: ["accounts", platform],
    queryFn: () => api.accounts.list({ platform }),
    staleTime: 10_000,
  });

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center text-sm text-muted-foreground">
        正在检查 {meta.name} 授权状态…
      </div>
    );
  }

  if (!accounts || accounts.length === 0) {
    const isXhs = platform === "xhs";
    return (
      <div className="max-w-2xl mx-auto py-12">
        <Card className={`${meta.bgClass} ${meta.borderClass} border`}>
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <div className={`mx-auto w-12 h-12 rounded-full bg-white flex items-center justify-center`}>
              {isXhs ? <Heart className={`h-6 w-6 ${meta.textClass}`} /> : <Link2 className={`h-6 w-6 ${meta.textClass}`} />}
            </div>
            <h2 className="text-lg font-semibold">
              请先{isXhs ? "添加" : "授权"} {meta.name} 账号
            </h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              {isXhs
                ? "小红书目前不开放 OAuth，请在「账号管理」手动添加你的小红书号、地区与人设标签后即可使用所有功能。"
                : `${meta.name} 的同行分析、市场数据、AI 策略与自动发布都需要一个已授权的账号。请先到「账号管理」完成 OAuth 授权。`}
            </p>
            <div className="flex justify-center gap-2 pt-2">
              <Button asChild className={isXhs ? "bg-red-500 hover:bg-red-600" : ""}>
                <Link href="/accounts">
                  <ShieldCheck className="h-4 w-4 mr-1.5" />
                  {isXhs ? "去添加账号" : `去授权 ${meta.name}`}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
