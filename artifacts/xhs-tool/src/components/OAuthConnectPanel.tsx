import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ExternalLink, Link2, Unlink, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { PlatformId } from "@/lib/platform-meta";
import { PLATFORMS } from "@/lib/platform-meta";
import { api } from "@/lib/api";

export function OAuthConnectPanel({ platform }: { platform: PlatformId }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const meta = PLATFORMS[platform];

  const { data: status, refetch } = useQuery({
    queryKey: ["oauth-status"],
    queryFn: () => api.oauth.status(),
    refetchInterval: 15_000,
  });

  // 监听 OAuth 弹窗发回的完成消息
  // 如果用户是从「AI 自动驾驶」等页面被引流过来授权的（sessionStorage.oauth_return_to 有值），
  // 授权完后自动跳回原页面继续 AI 流程，避免"断流"体验。
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.data?.type === "oauth-done") {
        refetch();
        qc.invalidateQueries({ queryKey: ["accounts"] });
        const returnTo = sessionStorage.getItem("oauth_return_to");
        if (returnTo) {
          sessionStorage.removeItem("oauth_return_to");
          toast({ title: "授权完成 ✓ 正在返回 AI 自动驾驶…" });
          // 给 invalidate 一点时间刷数据再跳
          setTimeout(() => { window.location.href = returnTo; }, 600);
        } else {
          toast({ title: "授权完成，账号已同步" });
        }
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [refetch, qc, toast]);

  const disconnect = useMutation({
    mutationFn: (accountId: number) => api.oauth.disconnect(accountId),
    onSuccess: () => {
      refetch();
      qc.invalidateQueries({ queryKey: ["accounts"] });
      toast({ title: "已断开授权" });
    },
    onError: (e: Error) => toast({ title: "断开失败", description: e.message, variant: "destructive" }),
  });

  const ayrshareSync = useMutation({
    mutationFn: () => api.oauth.ayrshareSync(),
    onSuccess: (d) => {
      refetch();
      qc.invalidateQueries({ queryKey: ["accounts"] });
      toast({ title: `已同步 ${d.synced} 个 Ayrshare 账号`, description: d.accounts.join(", ") || "无" });
    },
    onError: (e: Error) => toast({ title: "同步失败", description: e.message, variant: "destructive" }),
  });

  // Ayrshare 弹窗自动轮询：用户在 Ayrshare 后台授权完 TikTok/FB/IG 后无需手动点同步
  const popupRef = useRef<Window | null>(null);
  const pollRef = useRef<number | null>(null);
  const [ayrsharePolling, setAyrsharePolling] = useState(false);
  const beforeCountRef = useRef(0);

  function stopAyrsharePoll() {
    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
    setAyrsharePolling(false);
  }

  function openAyrshareAuth() {
    if (!cfg?.ayrshareDashboardUrl) return;
    beforeCountRef.current = (status?.connected?.[platform] ?? []).length;
    const popup = window.open(
      cfg.ayrshareDashboardUrl,
      "ayrshare-auth",
      "width=960,height=760,menubar=no,toolbar=no,location=no",
    );
    popupRef.current = popup;
    if (!popup) {
      toast({ title: "弹窗被浏览器拦截", description: "请允许弹出窗口后重试", variant: "destructive" });
      return;
    }
    setAyrsharePolling(true);
    let elapsed = 0;
    const intervalMs = 4000;
    const maxMs = 5 * 60 * 1000;

    pollRef.current = window.setInterval(async () => {
      elapsed += intervalMs;
      const closed = popup.closed;

      try {
        const synced = await api.oauth.ayrshareSync();
        await refetch();
        qc.invalidateQueries({ queryKey: ["accounts"] });
        const fresh = await api.oauth.status();
        const nowCount = fresh.connected?.[platform]?.length ?? 0;
        if (nowCount > beforeCountRef.current) {
          toast({
            title: `检测到新账号 ✓`,
            description: `${meta.name}：${synced.accounts.join(", ") || "已绑定"}`,
          });
          stopAyrsharePoll();
          if (!closed) popup.close();
          return;
        }
      } catch {
        // 静默重试
      }

      if (closed) {
        // 弹窗已关，再做一次最终同步
        try { await ayrshareSync.mutateAsync(); } catch {}
        stopAyrsharePoll();
        return;
      }
      if (elapsed >= maxMs) {
        toast({ title: "授权检测超时", description: "请回到 Ayrshare 后台完成授权后点「同步账号」" });
        stopAyrsharePoll();
      }
    }, intervalMs);
  }

  useEffect(() => () => stopAyrsharePoll(), []);

  if (platform === "xhs") return null;

  async function connect(p: "tiktok" | "facebook") {
    try {
      const { authUrl } = await api.oauth.getAuthUrl(p);
      window.open(authUrl, "oauth", "width=600,height=750");
    } catch (e) {
      toast({ title: "无法启动授权", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  const connected = status?.connected?.[platform] ?? [];
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
                <Button
                  size="sm"
                  variant="outline"
                  disabled={ayrsharePolling}
                  onClick={openAyrshareAuth}
                >
                  {ayrsharePolling ? (
                    <><RefreshCw className="h-3 w-3 mr-1 animate-spin" />等待授权…</>
                  ) : (
                    <>授权登录 <ExternalLink className="h-3 w-3 ml-1" /></>
                  )}
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={!cfg?.ayrshare || ayrshareSync.isPending} onClick={() => ayrshareSync.mutate()}>
                <RefreshCw className={`h-3 w-3 mr-1 ${ayrshareSync.isPending ? "animate-spin" : ""}`} />
                手动同步
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
