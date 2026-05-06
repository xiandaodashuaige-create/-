import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Coins, TrendingDown, TrendingUp, Crown, Loader2, MessageCircle, History } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export default function CreditsPage() {
  const { t } = useI18n();

  const { data: user, isLoading: loadingUser } = useQuery({
    queryKey: ["user-me"],
    queryFn: () => api.user.me(),
  });

  const { data: transactions, isLoading: loadingTx } = useQuery({
    queryKey: ["user-transactions", 100],
    queryFn: () => api.user.transactions(100),
  });

  const planLabel = user?.plan === "starter" ? t("credits.starter") : user?.plan === "pro" ? t("credits.pro") : t("credits.free");
  const planClass = user?.plan === "pro" ? "bg-purple-600 text-white" : user?.plan === "starter" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700";

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Coins className="h-6 w-6 text-amber-600" /> {t("credits.page.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("credits.page.desc")}</p>
      </div>

      {/* 三联统计卡 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-amber-200">
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-amber-700/70 uppercase tracking-wide font-medium">{t("credits.currentBalance")}</p>
                <p className="text-3xl font-bold text-amber-700 mt-1">
                  {loadingUser ? <Loader2 className="h-6 w-6 animate-spin" /> : (user?.credits ?? 0)}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">{t("credits.unit")}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                <Coins className="h-5 w-5 text-amber-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{t("settings.credits.totalUsed")}</p>
                <p className="text-3xl font-bold mt-1">
                  {loadingUser ? <Loader2 className="h-6 w-6 animate-spin" /> : (user?.totalCreditsUsed ?? 0)}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">{t("credits.unit")}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                <TrendingDown className="h-5 w-5 text-muted-foreground" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{t("settings.credits.plan")}</p>
                <Badge className={`${planClass} mt-2 text-sm px-3 py-1`}>
                  {user?.plan === "pro" && <Crown className="h-3 w-3 mr-1 inline" />}
                  {planLabel}
                </Badge>
              </div>
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                <Crown className="h-5 w-5 text-muted-foreground" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 充值引导 */}
      <Card className="border-blue-200 bg-blue-50/40">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2 text-blue-900">
            <MessageCircle className="h-4 w-4" /> {t("credits.topUp.title")}
          </CardTitle>
          <CardDescription className="text-blue-800/70">{t("credits.topUp.desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 rounded-lg bg-white border border-blue-200 p-3">
              <p className="text-xs text-blue-700/70 uppercase tracking-wide mb-1">WeChat</p>
              <p className="text-sm font-medium text-blue-900">{t("credits.consultantWeChat").replace(/^[^：:]*[：:]\s*/, "")}</p>
            </div>
            <div className="flex-1 rounded-lg bg-white border border-blue-200 p-3">
              <p className="text-xs text-blue-700/70 uppercase tracking-wide mb-1">WhatsApp</p>
              <p className="text-sm font-medium text-blue-900">{t("credits.consultantWhatsApp").replace(/^[^：:]*[：:]\s*/, "")}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 流水 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4" /> {t("credits.history.title")}
          </CardTitle>
          <CardDescription>{t("credits.history.desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingTx ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !transactions || transactions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <History className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">{t("credits.history.empty")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="py-2 px-3 font-medium">{t("credits.history.time")}</th>
                    <th className="py-2 px-3 font-medium">{t("credits.history.operation")}</th>
                    <th className="py-2 px-3 font-medium text-right">{t("credits.history.amount")}</th>
                    <th className="py-2 px-3 font-medium text-right">{t("credits.history.balance")}</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx: any) => {
                    const isAdd = tx.amount > 0;
                    const opLabel = t(`cost.${tx.operationType}`) !== `cost.${tx.operationType}` ? t(`cost.${tx.operationType}`) : (tx.description || tx.operationType);
                    return (
                      <tr key={tx.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">{formatTime(tx.createdAt)}</td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            {isAdd ? <TrendingUp className="h-3.5 w-3.5 text-green-600" /> : <TrendingDown className="h-3.5 w-3.5 text-red-600" />}
                            <span>{opLabel}</span>
                          </div>
                          {tx.description && tx.description !== opLabel && (
                            <p className="text-[11px] text-muted-foreground mt-0.5 ml-5">{tx.description}</p>
                          )}
                        </td>
                        <td className={`py-2.5 px-3 text-right font-mono font-medium ${isAdd ? "text-green-600" : "text-red-600"}`}>
                          {isAdd ? "+" : ""}{tx.amount}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-muted-foreground">{tx.balanceAfter}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {transactions && transactions.length >= 100 && (
            <p className="text-xs text-muted-foreground text-center mt-3">{t("credits.history.limited")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
