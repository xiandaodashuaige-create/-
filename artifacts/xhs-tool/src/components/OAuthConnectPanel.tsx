import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ExternalLink, Link2, Unlink, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { PlatformId } from "@/lib/platform-meta";
import { PLATFORMS } from "@/lib/platform-meta";

type OAuthStatus = {
  authenticated: boolean;
  configured: { meta: boolean; tiktok: boolean; ayrshare: boolean; ayrshareDashboardUrl?: string };
  connected: Record<string, Array<{ id: number; nickname: string; platformAccountId: string | null; oauthExpiresAt: string | null; ayrshareProfileKey: string | null }>>;
};

async function fetchStatus(): Promise<OAuthStatus> {
  const r = await fetch("/api/oauth/status", { credentials: "include" });
  return r.json();
}

async function getAuthUrl(platform: "tiktok" | "facebook"): Promise<string> {
  const r = await fetch(`/api/oauth/${platform}/connect?json=1`, { credentials: "include" });
  if (!r.ok) throw new Error((await r.json()).error || "无法生成授权链接");
  return (await r.json()).authUrl;
}

export function OAuthConnectPanel({ platform }: { platform: PlatformId }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const meta = PLATFORMS[platform];

  const { data: status, refetch } = useQuery({
    queryKey: ["oauth-status"],
    queryFn: fetchStatus,
    refetchInterval: 15_000,
  });

  // 监听 OAuth 弹窗发回的完成消息
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.data?.type === "oauth-done") {
        refetch();
        qc.invalidateQueries({ queryKey: ["accounts"] });
        toast({ title: "授权完成，账号已同步" });
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [refetch, qc, toast]);

  const disconnect = useMutation({
    mutationFn: async (accountId: number) => {
      const r = await fetch("/api/oauth/disconnect", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      if (!r.ok) throw new Error("断开失败");
      return r.json();
    },
    onSuccess: () => {
      refetch();
      qc.invalidateQueries({ queryKey: ["accounts"] });
      toast({ title: "已断开授权" });
    },
  });

  const ayrshareSync = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/oauth/ayrshare/sync", {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error((await r.json()).error || "同步失败");
      return r.json();
    },
    onSuccess: (d: { synced: number; accounts: string[] }) => {
      refetch();
      qc.invalidateQueries({ queryKey: ["accounts"] });
      toast({ title: `已同步 ${d.synced} 个 Ayrshare 账号`, description: d.accounts.join(", ") || "无" });
    },
    onError: (e: Error) => toast({ title: "同步失败", description: e.message, variant: "destructive" }),
  });

  if (platform === "xhs") return null;

  async function connect(p: "tiktok" | "facebook") {
    try {
      const url = await getAuthUrl(p);
      window.open(url, "oauth", "width=600,height=750");
    } catch (e) {
      toast({ title: "无法启动授权", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  const connected = status?.connected[platform] ?? [];
  const cfg = status?.configured;

  // TikTok 既支持 Ayrshare 也支持 Direct；IG/FB 走 Meta Direct
  const canDirect = platform === "tiktok" ? cfg?.tiktok : cfg?.meta;
  const directLabel = platform === "tiktok" ? "TikTok" : "Meta (Facebook/Instagram)";
  const directEnvVars = platform === "tiktok"
    ? "TIKTOK_CLIENT_KEY + TIKTOK_CLIENT_SECRET"
    : "META_APP_ID + META_APP_SECRET";

  return (
    <Card className={`${meta.bgClass} ${meta.borderClass} border`}>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link2 className={`h-4 w-4 ${meta.textClass}`} />
            <h3 className="font-semibold text-sm">{meta.name} 平台授权</h3>
          </div>
          <Badge variant="outline" className="text-xs">
            已连接 {connected.length}
          </Badge>
        </div>

        {/* Direct OAuth */}
        <div className="rounded-md border bg-background p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              {canDirect ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-500" />
              )}
              <span className="font-medium">{directLabel} 直连</span>
            </div>
            {platform !== "instagram" && (
              <Button size="sm" disabled={!canDirect} onClick={() => connect(platform === "tiktok" ? "tiktok" : "facebook")}>
                {canDirect ? "授权登录" : "未配置"}
              </Button>
            )}
          </div>
          {!canDirect && (
            <p className="text-xs text-muted-foreground">
              需在 Replit Secrets 配置：<code className="text-[10px] bg-muted px-1 py-0.5 rounded">{directEnvVars}</code>
            </p>
          )}
          {platform === "instagram" && (
            <p className="text-xs text-muted-foreground">Instagram 通过授权 Facebook Page 自动接入（点击 Facebook 标签页授权）</p>
          )}
        </div>

        {/* Ayrshare 替代路线 */}
        <div className="rounded-md border bg-background p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              {cfg?.ayrshare ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-500" />
              )}
              <span className="font-medium">Ayrshare（统一聚合）</span>
            </div>
            <div className="flex gap-2">
              {cfg?.ayrshareDashboardUrl && (
                <Button size="sm" variant="outline" asChild>
                  <a href={cfg.ayrshareDashboardUrl} target="_blank" rel="noreferrer">
                    去 Ayrshare 授权 <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                </Button>
              )}
              <Button size="sm" disabled={!cfg?.ayrshare || ayrshareSync.isPending} onClick={() => ayrshareSync.mutate()}>
                <RefreshCw className={`h-3 w-3 mr-1 ${ayrshareSync.isPending ? "animate-spin" : ""}`} />
                同步账号
              </Button>
            </div>
          </div>
          {!cfg?.ayrshare && (
            <p className="text-xs text-muted-foreground">
              需在 Replit Secrets 配置：<code className="text-[10px] bg-muted px-1 py-0.5 rounded">AYRSHARE_API_KEY</code>
              ，先到 ayrshare.com 注册并授权 {meta.name}，然后点"同步账号"。
            </p>
          )}
        </div>

        {/* 已连接账号列表 */}
        {connected.length > 0 && (
          <div className="space-y-2">
            {connected.map((acc) => (
              <div key={acc.id} className="flex items-center justify-between rounded-md bg-background border px-3 py-2 text-sm">
                <div className="flex flex-col">
                  <span className="font-medium">{acc.nickname}</span>
                  <span className="text-xs text-muted-foreground">
                    {acc.ayrshareProfileKey ? "via Ayrshare" : "Direct OAuth"}
                    {acc.oauthExpiresAt ? ` · 到期 ${new Date(acc.oauthExpiresAt).toLocaleDateString("zh-CN")}` : ""}
                  </span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => disconnect.mutate(acc.id)}>
                  <Unlink className="h-3 w-3 mr-1" />
                  断开
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
