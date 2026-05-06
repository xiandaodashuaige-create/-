import { useState, useEffect } from "react";
import { useUser, useClerk } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { User, Sparkles, Coins, Globe, LogOut, Loader2, Check, Briefcase } from "lucide-react";
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

      {/* 3. 品牌画像（按平台） — 注入 AI 策略生成 prompt */}
      <BrandProfileCard platform={activePlatform as PlatformId} />

      {/* 4. 积分 */}
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

      {/* 5. 语言 */}
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

      {/* 6. 退出登录 */}
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

// ── 品牌画像卡（按平台 upsert）— 注入到 AI 策略生成 prompt ──
function BrandProfileCard({ platform }: { platform: PlatformId }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const platformMeta = PLATFORMS[platform];

  const { data: profile, isLoading } = useQuery({
    queryKey: ["brand-profile", platform],
    queryFn: () => api.brandProfile.get(platform),
  });

  const [category, setCategory] = useState("");
  const [products, setProducts] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [priceRange, setPriceRange] = useState("");
  const [tone, setTone] = useState("");
  const [forbiddenClaims, setForbiddenClaims] = useState("");
  const [conversionGoal, setConversionGoal] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!profile) {
      setCategory(""); setProducts(""); setTargetAudience(""); setPriceRange("");
      setTone(""); setForbiddenClaims(""); setConversionGoal("");
    } else {
      setCategory(profile.category ?? "");
      setProducts(profile.products ?? "");
      setTargetAudience(profile.targetAudience ?? "");
      setPriceRange(profile.priceRange ?? "");
      setTone(profile.tone ?? "");
      setForbiddenClaims((profile.forbiddenClaims ?? []).join(", "));
      setConversionGoal(profile.conversionGoal ?? "");
    }
    setDirty(false);
  }, [profile, platform]);

  const saveMut = useMutation({
    mutationFn: () => api.brandProfile.upsert({
      platform,
      category: category.trim() || null,
      products: products.trim() || null,
      targetAudience: targetAudience.trim() || null,
      priceRange: priceRange.trim() || null,
      tone: tone.trim() || null,
      forbiddenClaims: forbiddenClaims.split(/[,，;；\n]+/).map((s) => s.trim()).filter(Boolean),
      conversionGoal: conversionGoal.trim() || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brand-profile", platform] });
      toast({ title: "品牌画像已保存", description: `下次 ${platformMeta?.name} 生成策略会自动注入这些信息` });
      setDirty(false);
    },
    onError: (e: any) => {
      toast({ title: "保存失败", description: e?.message ?? "未知错误", variant: "destructive" });
    },
  });

  function markDirty<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setDirty(true); };
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Briefcase className="h-4 w-4 text-blue-600" /> 品牌画像 · {platformMeta?.name}
        </CardTitle>
        <CardDescription>
          填写后，AI 生成策略 / 文案时会自动按你的品牌定位输出，每个平台独立保存。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">品类</Label>
                <Input value={category} onChange={(e) => markDirty(setCategory)(e.target.value)} placeholder="如：美妆护肤、母婴、宠物食品" maxLength={100} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">价格带</Label>
                <Input value={priceRange} onChange={(e) => markDirty(setPriceRange)(e.target.value)} placeholder="如：100-300 RMB / 高端" maxLength={100} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">主推产品 / 服务</Label>
              <Textarea value={products} onChange={(e) => markDirty(setProducts)(e.target.value)} placeholder="列出 1-3 个主推 SKU 或服务，每行一个" maxLength={2000} rows={3} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">目标受众</Label>
              <Input value={targetAudience} onChange={(e) => markDirty(setTargetAudience)(e.target.value)} placeholder="如：25-35 岁都市女性、宝妈、运动爱好者" maxLength={500} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">品牌调性 / Tone</Label>
                <Input value={tone} onChange={(e) => markDirty(setTone)(e.target.value)} placeholder="如：温暖治愈 / 专业理性 / 玩梗活泼" maxLength={200} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">转化目标</Label>
                <Input value={conversionGoal} onChange={(e) => markDirty(setConversionGoal)(e.target.value)} placeholder="如：私信咨询 / 下单 / 留资" maxLength={200} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">禁用词 / 极限词</Label>
              <Input value={forbiddenClaims} onChange={(e) => markDirty(setForbiddenClaims)(e.target.value)} placeholder="逗号分隔，如：最好,最便宜,治愈,根治" maxLength={1000} />
              <p className="text-[11px] text-muted-foreground">AI 生成时会主动避开这些词</p>
            </div>

            <div className="flex items-center justify-end gap-2">
              {dirty && <span className="text-[11px] text-amber-600">有未保存的修改</span>}
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !dirty} size="sm">
                {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "保存品牌画像"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
