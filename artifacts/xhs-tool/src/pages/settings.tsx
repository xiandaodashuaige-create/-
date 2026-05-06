import { useState, useEffect } from "react";
import { useUser, useClerk } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { User, Sparkles, Coins, Globe, LogOut, Loader2, Check } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n, type Lang } from "@/lib/i18n";
import { usePlatform } from "@/lib/platform-context";
import { ENABLED_PLATFORMS, PLATFORMS, type PlatformId } from "@/lib/platform-meta";
import { useToast } from "@/hooks/use-toast";

const PREF_REGION_KEY = "pref.region";
const PREF_NICHE_KEY = "pref.niche";

const REGIONS: Array<{ value: string; labelKey: string }> = [
  { value: "SG", labelKey: "region.SG" },
  { value: "HK", labelKey: "region.HK" },
  { value: "MY", labelKey: "region.MY" },
  { value: "ALL", labelKey: "region.ALL" },
];

export default function Settings() {
  const { t, lang, setLang } = useI18n();
  const { user: clerkUser } = useUser();
  const { signOut } = useClerk();
  const { activePlatform, setActivePlatform } = usePlatform();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: dbUser, isLoading } = useQuery({
    queryKey: ["user-me"],
    queryFn: () => api.user.me(),
  });

  // ── 个人资料 ─────────────────────────────────────────────
  const [nickname, setNickname] = useState("");
  useEffect(() => {
    if (dbUser?.nickname) setNickname(dbUser.nickname);
  }, [dbUser?.nickname]);

  const updateMut = useMutation({
    mutationFn: (data: { nickname?: string; language?: string }) => api.user.update(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-me"] });
      toast({ title: t("settings.profile.saved") });
    },
    onError: () => {
      toast({ title: t("common.error"), variant: "destructive" });
    },
  });

  // ── 创作偏好（localStorage） ──────────────────────────────
  const [region, setRegion] = useState<string>(() => {
    if (typeof window === "undefined") return "MY";
    return window.localStorage.getItem(PREF_REGION_KEY) || "MY";
  });
  const [niche, setNiche] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(PREF_NICHE_KEY) || "";
  });

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(PREF_REGION_KEY, region);
  }, [region]);
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(PREF_NICHE_KEY, niche);
  }, [niche]);

  // ── 退出登录确认 ──────────────────────────────────────────
  const [confirmingLogout, setConfirmingLogout] = useState(false);

  const platformMeta = PLATFORMS[activePlatform as PlatformId];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("settings.subtitle")}</p>
      </div>

      {/* 1. 个人资料 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4" /> {t("settings.profile.title")}
          </CardTitle>
          <CardDescription>{t("settings.profile.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-medium shrink-0"
              style={{ background: "hsl(var(--platform-soft-bg))", color: "hsl(var(--platform-soft-text))" }}
            >
              {(nickname || clerkUser?.firstName || clerkUser?.emailAddresses?.[0]?.emailAddress || "U")[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {clerkUser?.emailAddresses?.[0]?.emailAddress || "—"}
              </p>
              {dbUser?.role === "admin" && (
                <Badge className="bg-purple-100 text-purple-700 text-[10px] h-4 mt-1">{t("user.role.admin")}</Badge>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="nickname" className="text-xs">{t("settings.profile.nickname")}</Label>
            <div className="flex gap-2">
              <Input
                id="nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder={t("settings.profile.nicknamePlaceholder")}
                maxLength={32}
              />
              <Button
                onClick={() => updateMut.mutate({ nickname: nickname.trim() })}
                disabled={!nickname.trim() || nickname === dbUser?.nickname || updateMut.isPending}
              >
                {updateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("settings.profile.save")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. 创作偏好 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> {t("settings.prefs.title")}
          </CardTitle>
          <CardDescription>{t("settings.prefs.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs">{t("settings.prefs.platform")}</Label>
              <Select value={activePlatform} onValueChange={(v) => setActivePlatform(v as PlatformId)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ENABLED_PLATFORMS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="flex items-center gap-2">
                        <p.icon className="h-3.5 w-3.5" /> {p.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {t("settings.prefs.platformHint").replace("{name}", platformMeta?.name || "")}
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">{t("settings.prefs.region")}</Label>
              <Select value={region} onValueChange={setRegion}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REGIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{t(r.labelKey)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="niche" className="text-xs">{t("settings.prefs.niche")}</Label>
            <Input
              id="niche"
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder={t("settings.prefs.nichePlaceholder")}
              maxLength={50}
            />
          </div>

          <p className="text-[11px] text-emerald-600 flex items-center gap-1">
            <Check className="h-3 w-3" /> {t("settings.prefs.autoSaved")}
          </p>
        </CardContent>
      </Card>

      {/* 3. 积分 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Coins className="h-4 w-4 text-amber-600" /> {t("settings.credits.title")}
          </CardTitle>
          <CardDescription>{t("settings.credits.desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : dbUser ? (
            <>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-center">
                  <p className="text-2xl font-bold text-amber-700">{dbUser.credits ?? 0}</p>
                  <p className="text-[10px] text-amber-700/70 mt-0.5 uppercase tracking-wide">{t("settings.credits.balance")}</p>
                </div>
                <div className="rounded-lg bg-muted/50 border p-3 text-center">
                  <p className="text-2xl font-bold">{dbUser.totalCreditsUsed ?? 0}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wide">{t("settings.credits.totalUsed")}</p>
                </div>
                <div className="rounded-lg bg-muted/50 border p-3 text-center flex flex-col items-center justify-center">
                  <Badge variant={dbUser.plan !== "free" ? "default" : "secondary"} className={dbUser.plan === "pro" ? "bg-purple-600" : ""}>
                    {dbUser.plan === "starter" ? t("credits.starter") : dbUser.plan === "pro" ? t("credits.pro") : t("credits.free")}
                  </Badge>
                  <p className="text-[10px] text-muted-foreground mt-1.5 uppercase tracking-wide">{t("settings.credits.plan")}</p>
                </div>
              </div>
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900 space-y-1">
                <p className="font-medium">{t("settings.credits.topUp")}</p>
                <p className="text-blue-800/80">{t("credits.consultantWeChat")}</p>
                <p className="text-blue-800/80">{t("credits.consultantWhatsApp")}</p>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      {/* 4. 语言 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4" /> {t("settings.lang.title")}
          </CardTitle>
          <CardDescription>{t("settings.lang.desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {([["zh", t("lang.zh")], ["zh-HK", t("lang.zhHK")], ["en", t("lang.en")]] as const).map(([code, label]) => (
              <Button
                key={code}
                variant={lang === code ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setLang(code as Lang);
                  // 同步保存到后端，下次登录沿用
                  updateMut.mutate({ language: code });
                }}
                style={lang === code ? { background: "hsl(var(--platform-primary))", color: "hsl(var(--platform-primary-fg))" } : undefined}
              >
                {label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 5. 退出登录 */}
      <Card className="border-red-200">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2 text-red-700">
            <LogOut className="h-4 w-4" /> {t("settings.logout.title")}
          </CardTitle>
          <CardDescription>{t("settings.logout.desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {!confirmingLogout ? (
            <Button variant="outline" className="border-red-200 text-red-600 hover:bg-red-50" onClick={() => setConfirmingLogout(true)}>
              <LogOut className="h-4 w-4 mr-2" /> {t("settings.logout.button")}
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-red-700">{t("settings.logout.confirm")}</span>
              <Button variant="destructive" size="sm" onClick={() => signOut()}>
                {t("common.confirm")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmingLogout(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
