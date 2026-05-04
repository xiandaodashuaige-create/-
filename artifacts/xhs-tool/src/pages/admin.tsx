import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import {
  Users, Coins, TrendingUp, Shield, Plus, Minus,
  Loader2, Crown, User, ChevronDown, ChevronUp, History
} from "lucide-react";

export default function AdminPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expandedUser, setExpandedUser] = useState<number | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditDesc, setCreditDesc] = useState("");

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => api.admin.stats(),
  });

  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => api.admin.users(),
  });

  const { data: creditCosts } = useQuery({
    queryKey: ["admin-credit-costs"],
    queryFn: () => api.admin.creditCosts(),
  });

  const { data: transactions = [], refetch: refetchTransactions } = useQuery({
    queryKey: ["admin-transactions", expandedUser],
    queryFn: () => expandedUser ? api.admin.userTransactions(expandedUser) : Promise.resolve([]),
    enabled: !!expandedUser,
  });

  const creditMutation = useMutation({
    mutationFn: ({ userId, amount, description }: { userId: number; amount: number; description: string }) =>
      api.admin.adjustCredits(userId, amount, description),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      refetchTransactions();
      setCreditAmount("");
      setCreditDesc("");
      toast({ title: "积分调整成功" });
    },
    onError: (e: Error) => toast({ title: "操作失败", description: e.message, variant: "destructive" }),
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: string }) =>
      api.admin.updateUser(userId, { role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast({ title: "角色更新成功" });
    },
  });

  const planMutation = useMutation({
    mutationFn: ({ userId, plan }: { userId: number; plan: string }) =>
      api.admin.updateUser(userId, { plan }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast({ title: "套餐更新成功" });
    },
  });

  function handleRecharge(userId: number) {
    const amount = parseInt(creditAmount);
    if (!amount || amount <= 0) {
      toast({ title: "请输入正确的积分数量", variant: "destructive" });
      return;
    }
    creditMutation.mutate({ userId, amount, description: creditDesc || `管理员充值 ${amount} 积分` });
  }

  function handleDeduct(userId: number) {
    const amount = parseInt(creditAmount);
    if (!amount || amount <= 0) {
      toast({ title: "请输入正确的积分数量", variant: "destructive" });
      return;
    }
    creditMutation.mutate({ userId, amount: -amount, description: creditDesc || `管理员扣除 ${amount} 积分` });
  }

  const costLabels: Record<string, string> = {
    "ai-rewrite": "AI改写",
    "ai-competitor-research": "同行爆款分析",
    "ai-generate-title": "生成标题",
    "ai-generate-hashtags": "生成标签",
    "ai-generate-image": "生成配图",
    "ai-guide": "AI向导",
    "ai-check-sensitivity": "敏感词检测",
    "content-publish": "发布内容",
    "content-create": "创建内容",
    "asset-upload": "上传素材",
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("admin.title")}</h1>
        <p className="text-muted-foreground">{t("admin.users")} & {t("admin.stats")}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statsLoading ? (
          <div className="col-span-4 flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                    <Users className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{stats?.totalUsers || 0}</p>
                    <p className="text-xs text-muted-foreground">{t("admin.totalUsers")}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                    <User className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{stats?.freeUsers || 0}</p>
                    <p className="text-xs text-muted-foreground">{t("admin.freeUsers")}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                    <Crown className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{stats?.starterUsers || 0}</p>
                    <p className="text-xs text-muted-foreground">{t("admin.starterUsers")}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                    <Crown className="h-5 w-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{stats?.proUsers || 0}</p>
                    <p className="text-xs text-muted-foreground">{t("admin.proUsers")}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
                    <TrendingUp className="h-5 w-5 text-red-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{stats?.totalCreditsUsed || 0}</p>
                    <p className="text-xs text-muted-foreground">{t("admin.totalCreditsUsed")}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {creditCosts && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Coins className="h-4 w-4" /> 积分消耗标准
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(creditCosts).map(([key, cost]) => (
                <Badge key={key} variant="outline" className="text-xs py-1">
                  {costLabels[key] || key}: <span className="font-bold ml-1">{cost as number}</span> 积分
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" /> {t("admin.users")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {usersLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : users.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">{t("common.noData")}</p>
          ) : (
            <div className="space-y-2">
              {users.map((u: any) => (
                <div key={u.id} className="border rounded-lg overflow-hidden">
                  <button
                    className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors text-left"
                    onClick={() => setExpandedUser(expandedUser === u.id ? null : u.id)}
                  >
                    <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-sm font-medium shrink-0">
                      {(u.nickname || u.email || "U")[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{u.nickname || u.email || `User #${u.id}`}</p>
                        {u.role === "admin" && <Badge className="bg-purple-100 text-purple-700 text-[10px] h-4">{t("user.role.admin")}</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Badge variant={u.plan !== "free" ? "default" : "secondary"} className={`text-xs ${u.plan === "pro" ? "bg-purple-600" : ""}`}>
                        {u.plan === "starter" ? t("credits.starter") : u.plan === "pro" ? t("credits.pro") : t("credits.free")}
                      </Badge>
                      <div className="text-right">
                        <p className="text-sm font-bold text-amber-600">{u.credits}</p>
                        <p className="text-[10px] text-muted-foreground">{t("credits.label")}</p>
                      </div>
                      {expandedUser === u.id ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </button>

                  {expandedUser === u.id && (
                    <div className="border-t bg-muted/30 p-4 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="space-y-2">
                          <Label className="text-xs">{t("admin.setRole")}</Label>
                          <Select value={u.role} onValueChange={(v) => roleMutation.mutate({ userId: u.id, role: v })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="user">{t("user.role.user")}</SelectItem>
                              <SelectItem value="admin">{t("user.role.admin")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">{t("admin.setPlan")}</Label>
                          <Select value={u.plan} onValueChange={(v) => planMutation.mutate({ userId: u.id, plan: v })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="free">{t("credits.free")}</SelectItem>
                              <SelectItem value="starter">{t("credits.starter")}</SelectItem>
                              <SelectItem value="pro">{t("credits.pro")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">已消耗总积分</Label>
                          <p className="text-lg font-bold text-red-500">{u.totalCreditsUsed || 0}</p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs font-medium">{t("admin.recharge")} / {t("admin.deduct")}</Label>
                        <div className="flex gap-2">
                          <Input
                            type="number"
                            min="1"
                            value={creditAmount}
                            onChange={(e) => setCreditAmount(e.target.value)}
                            placeholder={t("admin.amount")}
                            className="h-8 text-sm w-24"
                          />
                          <Input
                            value={creditDesc}
                            onChange={(e) => setCreditDesc(e.target.value)}
                            placeholder={`${t("admin.description")}（选填）`}
                            className="h-8 text-sm flex-1"
                          />
                          <Button size="sm" className="h-8 bg-green-600 hover:bg-green-700" onClick={() => handleRecharge(u.id)}
                            disabled={creditMutation.isPending}>
                            <Plus className="h-3 w-3 mr-1" />{t("admin.recharge")}
                          </Button>
                          <Button size="sm" variant="destructive" className="h-8" onClick={() => handleDeduct(u.id)}
                            disabled={creditMutation.isPending}>
                            <Minus className="h-3 w-3 mr-1" />{t("admin.deduct")}
                          </Button>
                        </div>
                      </div>

                      {transactions.length > 0 && (
                        <div className="space-y-2">
                          <Label className="text-xs font-medium flex items-center gap-1">
                            <History className="h-3 w-3" /> {t("admin.creditHistory")}
                          </Label>
                          <div className="max-h-48 overflow-auto space-y-1">
                            {transactions.map((tx: any) => (
                              <div key={tx.id} className="flex items-center justify-between text-xs p-2 rounded bg-white border">
                                <div className="flex items-center gap-2">
                                  <Badge variant={tx.amount > 0 ? "default" : "secondary"} className="text-[10px] h-4">
                                    {tx.amount > 0 ? "+" : ""}{tx.amount}
                                  </Badge>
                                  <span className="text-muted-foreground">{tx.description}</span>
                                </div>
                                <span className="text-muted-foreground shrink-0">
                                  {new Date(tx.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
