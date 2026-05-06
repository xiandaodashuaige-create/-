import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { api } from "@/lib/api";
import { usePlatform } from "@/lib/platform-context";
import { PLATFORMS, type PlatformId } from "@/lib/platform-meta";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Heart, Link2, ShieldCheck, Loader2, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Mode = "needs-auth" | "xhs-only";

// XHS 不开放 OAuth，需要用户填昵称+地区+备注当账号画像；其它平台走 OAuth 跳转
const XHS_REGIONS: { val: string; label: string; placeholder: string }[] = [
  { val: "SG", label: "🇸🇬 新加坡", placeholder: "如：狮城美食探店、新加坡亲子日记" },
  { val: "HK", label: "🇭🇰 香港", placeholder: "如：香港穿搭日记、港式茶餐厅" },
  { val: "MY", label: "🇲🇾 马来西亚", placeholder: "如：吉隆坡美妆、马来甜品控" },
];

export function PlatformGuard({
  mode,
  children,
}: {
  mode: Mode;
  children: React.ReactNode;
}) {
  const { activePlatform } = usePlatform();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const meta = PLATFORMS[activePlatform];

  // 非小红书平台访问 XHS 专属页面（多由"切平台后页面没刷新"触发）
  // → 自动跳转到该平台的 AI 自动驾驶（多平台通用的 AI 工作台），而不是卡死胡同
  const shouldRedirect = mode === "xhs-only" && activePlatform !== "xhs";
  useEffect(() => {
    if (!shouldRedirect) return;
    toast({
      title: `${meta.name} 已为你跳转到 AI 自动驾驶`,
      description: "刚才那个页面是小红书专属的；你的平台对应功能在这里。",
    });
    setLocation("/autopilot");
  }, [shouldRedirect, meta.name, setLocation, toast]);

  if (shouldRedirect) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center text-sm text-muted-foreground">
        正在切换到 {meta.name} 的 AI 自动驾驶…
      </div>
    );
  }

  if (mode === "needs-auth") {
    return <NeedsAuthGate platform={activePlatform}>{children}</NeedsAuthGate>;
  }

  return <>{children}</>;
}

// 判定一个账号是否「真的能用来发布」。XHS 走画像直发；其他平台需 OAuth 已授权或 Ayrshare profileKey。
// 注意：/accounts 响应已剥离 oauthAccessToken（敏感字段不下发到前端），所以仅靠 authStatus 即可。
function isAccountReady(a: any): boolean {
  if (!a) return false;
  if (a.platform === "xhs") return true;
  if (a.ayrshareProfileKey && String(a.ayrshareProfileKey).length > 0) return true;
  return a.authStatus === "authorized";
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
        正在检查 {meta.name} 账号状态…
      </div>
    );
  }

  if (!accounts || accounts.length === 0) {
    // XHS 走内嵌快速添加（不需要 OAuth），其它平台走 OAuth 跳转引导
    if (platform === "xhs") {
      return <XhsQuickAdd />;
    }
    return <OAuthRedirectGate platform={platform} reason="missing" />;
  }

  // T1：非 XHS 平台必须存在「真的能用来发布」的账号
  if (platform !== "xhs") {
    const anyReady = (accounts as any[]).some(isAccountReady);
    if (!anyReady) {
      return <OAuthRedirectGate platform={platform} reason="unauthorized" />;
    }
  }

  return <>{children}</>;
}

// 小红书：内嵌快速添加表单 — 30 秒填完，无需跳页
function XhsQuickAdd() {
  const meta = PLATFORMS.xhs;
  const qc = useQueryClient();
  const { toast } = useToast();
  const [nickname, setNickname] = useState("");
  const [region, setRegion] = useState<string>(XHS_REGIONS[0]!.val);
  const [notes, setNotes] = useState("");

  const createMut = useMutation({
    mutationFn: () =>
      api.accounts.create({
        nickname: nickname.trim(),
        region,
        notes: notes.trim() || undefined,
        platform: "xhs",
      }),
    onSuccess: () => {
      // 让 NeedsAuthGate 自动放行 — 不用跳页、不用刷新
      qc.invalidateQueries({ queryKey: ["accounts"] });
      toast({
        title: "已添加，AI 立即可用",
        description: `${nickname} · ${XHS_REGIONS.find((r) => r.val === region)?.label}`,
      });
    },
    onError: (e: Error) =>
      toast({ title: "添加失败", description: e.message, variant: "destructive" }),
  });

  const currentRegion = XHS_REGIONS.find((r) => r.val === region) ?? XHS_REGIONS[0]!;

  return (
    <div className="max-w-xl mx-auto py-8">
      <Card className={`${meta.bgClass} ${meta.borderClass} border`}>
        <CardContent className="pt-7 pb-7 space-y-5">
          <div className="text-center space-y-2">
            <div className="mx-auto w-12 h-12 rounded-full bg-white flex items-center justify-center shadow-sm">
              <Heart className={`h-6 w-6 ${meta.textClass}`} />
            </div>
            <h2 className="text-lg font-semibold">添加你的小红书账号画像</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              小红书无需登录授权 —— 只要告诉 AI 你的<strong>账号定位</strong>，
              30 秒后即可开始生成爆款策略。
            </p>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="xhs-nickname" className="text-xs">
                账号名称 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="xhs-nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder={currentRegion.placeholder}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">目标地区 <span className="text-destructive">*</span></Label>
              <div className="grid grid-cols-3 gap-2">
                {XHS_REGIONS.map((r) => (
                  <button
                    key={r.val}
                    type="button"
                    onClick={() => setRegion(r.val)}
                    className={`text-sm py-2 rounded-md border transition ${
                      region === r.val
                        ? `${meta.bgClass} ${meta.textClass} ${meta.borderClass} font-medium`
                        : "bg-background hover:bg-muted/50"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="xhs-notes" className="text-xs">
                人设备注 <span className="text-muted-foreground">（可选，AI 会参考）</span>
              </Label>
              <Textarea
                id="xhs-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="如：25-35 岁女性、偏好治愈系生活、关注亲子+轻奢饮食…"
                rows={2}
                className="resize-none text-sm"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Button
              onClick={() => {
                if (!nickname.trim()) {
                  toast({ title: "请填写账号名称", variant: "destructive" });
                  return;
                }
                createMut.mutate();
              }}
              disabled={createMut.isPending}
              className="bg-red-500 hover:bg-red-600 w-full"
            >
              {createMut.isPending ? (
                <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />正在创建…</>
              ) : (
                <><Sparkles className="h-4 w-4 mr-1.5" />创建并开始使用</>
              )}
            </Button>
            <Button asChild variant="ghost" size="sm" className="text-xs text-muted-foreground">
              <Link href="/accounts">需要更多设置？打开完整账号管理 →</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// TikTok / IG / FB：走 OAuth 跳转，引导到 /accounts 完成授权
function OAuthRedirectGate({ platform, reason }: { platform: PlatformId; reason: "missing" | "unauthorized" }) {
  const meta = PLATFORMS[platform];
  const title = reason === "unauthorized" ? `${meta.name} 账号未完成授权` : `请先授权 ${meta.name} 账号`;
  const desc = reason === "unauthorized"
    ? `检测到你已添加 ${meta.name} 账号，但还没完成授权。AI 策略、自动发布、广告库等功能需要授权后才能调用真实接口。`
    : `${meta.name} 的同行分析、市场数据、AI 策略与自动发布都需要一个已授权的账号。到「账号管理」一键授权即可（约 30 秒）。`;
  return (
    <div className="max-w-2xl mx-auto py-12">
      <Card className={`${meta.bgClass} ${meta.borderClass} border`}>
        <CardContent className="pt-8 pb-8 text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-white flex items-center justify-center">
            <Link2 className={`h-6 w-6 ${meta.textClass}`} />
          </div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">{desc}</p>
          <div className="flex justify-center gap-2 pt-2">
            <Button asChild>
              <Link href="/accounts">
                <ShieldCheck className="h-4 w-4 mr-1.5" />
                去授权 {meta.name}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
