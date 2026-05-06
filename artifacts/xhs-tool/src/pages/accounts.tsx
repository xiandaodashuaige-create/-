import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Edit, Users, Sparkles, ArrowRight } from "lucide-react";
import { usePlatform } from "@/lib/platform-context";
import { PLATFORMS, type PlatformId } from "@/lib/platform-meta";
import { OAuthConnectPanel } from "@/components/OAuthConnectPanel";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useLocation } from "wouter";
import { getReturnToFlow, clearReturnToFlow } from "@/lib/return-to-flow";

const regionLabels: Record<string, string> = { SG: "🇸🇬 新加坡", HK: "🇭🇰 香港", MY: "🇲🇾 马来西亚", GLOBAL: "🌐 全球" };
const statusLabels: Record<string, string> = { active: "活跃", inactive: "未激活", banned: "已封禁" };

const nicknamePlaceholderByRegion: Record<string, string> = {
  SG: "如：Sarah的新加坡日记",
  HK: "如：Hong Kong Living｜阿May",
  MY: "如：吉隆坡探店女孩",
  GLOBAL: "如：Lulian Creator",
};

const notesPlaceholderByRegion: Record<string, string> = {
  SG: "业务方向，如：新加坡留学咨询、本地美食探店、亲子育儿",
  HK: "業務方向，如：香港美容護膚分享、銅鑼灣探店、移居香港攻略",
  MY: "业务方向，如：马来西亚旅游攻略、新山美食、华人社区生活",
  GLOBAL: "Niche / target audience / content style",
};

// 不同平台默认地区候选（小红书=华语区；TikTok/IG/FB=GLOBAL）
function getRegionOptions(platform: PlatformId): { val: string; label: string }[] {
  if (platform === "xhs") {
    return [
      { val: "SG", label: "🇸🇬 新加坡" },
      { val: "HK", label: "🇭🇰 香港" },
      { val: "MY", label: "🇲🇾 马来西亚" },
    ];
  }
  return [{ val: "GLOBAL", label: "🌐 全球" }];
}

export default function Accounts() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { activePlatform } = usePlatform();
  const platformMeta = PLATFORMS[activePlatform];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<any>(null);
  const defaultRegion = useMemo(
    () => getRegionOptions(activePlatform)[0]?.val ?? "GLOBAL",
    [activePlatform]
  );
  const [form, setForm] = useState<{ nickname: string; region: string; notes: string; platform: PlatformId }>(
    { nickname: "", region: defaultRegion, notes: "", platform: activePlatform }
  );

  // 平台切换时，重置表单的 platform / region 默认值
  useEffect(() => {
    setForm((f) => ({ ...f, platform: activePlatform, region: getRegionOptions(activePlatform)[0]?.val ?? "GLOBAL" }));
  }, [activePlatform]);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["accounts", activePlatform],
    queryFn: () => api.accounts.list({ platform: activePlatform }),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => api.accounts.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      toast({ title: "账号创建成功" });
      closeDialog();
    },
    onError: (e: Error) => toast({ title: "创建失败", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => api.accounts.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      toast({ title: "账号更新成功" });
      closeDialog();
    },
    onError: (e: Error) => toast({ title: "更新失败", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.accounts.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      toast({ title: "账号已删除" });
    },
    onError: (e: Error) => toast({ title: "删除失败", description: e.message, variant: "destructive" }),
  });

  function closeDialog() {
    setDialogOpen(false);
    setEditAccount(null);
    setForm({ nickname: "", region: getRegionOptions(activePlatform)[0]?.val ?? "GLOBAL", notes: "", platform: activePlatform });
  }

  function openEdit(account: any) {
    setEditAccount(account);
    setForm({
      nickname: account.nickname,
      region: account.region,
      notes: account.notes || "",
      platform: (account.platform as PlatformId) || activePlatform,
    });
    setDialogOpen(true);
  }

  function handleSubmit() {
    if (!form.nickname.trim()) {
      toast({ title: "请输入昵称", variant: "destructive" });
      return;
    }
    if (editAccount) {
      updateMutation.mutate({ id: editAccount.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  }

  const PlatformIcon = platformMeta.icon;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg ${platformMeta.bgClass} ${platformMeta.borderClass} border flex items-center justify-center`}>
            <PlatformIcon className={`h-5 w-5 ${platformMeta.textClass}`} />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{platformMeta.name} · 账号管理</h1>
            <p className="text-muted-foreground text-sm">
              {platformMeta.enabled
                ? `管理你的${platformMeta.name}账号`
                : `${platformMeta.name} 授权流程即将开放，可先建立草稿账号占位`}
            </p>
          </div>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          手动添加
        </Button>
      </div>

      {/* 「从 AI 自动驾驶被引导过来」的返回横幅
          —— 解决断流：用户授权/添加完账号后能一键回到 AI 流程，而不用自己摸路径回去 */}
      <ReturnToFlowBanner hasAccount={accounts.length > 0} />

      {/* OAuth 授权入口（非小红书平台） */}
      <OAuthConnectPanel platform={activePlatform} />

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="pt-6 h-32" />
            </Card>
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground py-12">
            <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>当前 {platformMeta.name} 下暂无账号，点击上方按钮添加</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((account: any) => {
            const accPlatform = (account.platform as PlatformId) || "xhs";
            const meta = PLATFORMS[accPlatform] ?? platformMeta;
            const AccIcon = meta.icon;
            return (
              <Card key={account.id} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                        {account.nickname.charAt(0)}
                      </div>
                      <div>
                        <h3 className="font-semibold">{account.nickname}</h3>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <Badge
                            variant="outline"
                            className={`text-xs gap-1 ${meta.bgClass} ${meta.textClass} ${meta.borderClass}`}
                          >
                            <AccIcon className="h-3 w-3" />
                            {meta.shortName}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {regionLabels[account.region] || account.region}
                          </Badge>
                          <Badge
                            variant={account.status === "active" ? "default" : "secondary"}
                            className="text-xs"
                          >
                            {statusLabels[account.status]}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(account)}>
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                      <ConfirmDialog
                        title="删除账号绑定"
                        description={<>确定删除 <strong>「{account.platformUsername || account.platform}」</strong>？此操作不可撤销，删除后该账号下的<strong>所有内容草稿、排期、追踪记录</strong>会保留但变成孤立状态。</>}
                        confirmLabel="删除账号"
                        destructive
                        onConfirm={() => deleteMutation.mutate(account.id)}
                        trigger={
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        }
                      />
                    </div>
                  </div>
                  {account.notes && (
                    <p className="text-sm text-muted-foreground mt-3">{account.notes}</p>
                  )}
                  <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
                    <span>{account.contentCount} 篇内容</span>
                    <span>
                      {account.lastActiveAt
                        ? `最后活跃: ${new Date(account.lastActiveAt).toLocaleDateString("zh-CN")}`
                        : "尚未活跃"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editAccount ? "编辑账号" : `添加 ${PLATFORMS[form.platform].name} 账号`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>平台</Label>
              <Select
                value={form.platform}
                onValueChange={(v) => {
                  const p = v as PlatformId;
                  setForm((f) => ({ ...f, platform: p, region: getRegionOptions(p)[0]?.val ?? "GLOBAL" }));
                }}
                disabled={!!editAccount}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(PLATFORMS).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {!p.enabled && <span className="ml-2 text-[10px] text-muted-foreground">(即将开放)</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!PLATFORMS[form.platform].enabled && (
                <p className="text-xs text-amber-600">
                  注：{PLATFORMS[form.platform].name} 的发布授权流程尚未开放，添加的账号目前仅作占位/规划用途。
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>昵称</Label>
              <Input
                value={form.nickname}
                onChange={(e) => setForm({ ...form, nickname: e.target.value })}
                placeholder={nicknamePlaceholderByRegion[form.region] || "请输入账号昵称"}
              />
            </div>
            <div className="space-y-2">
              <Label>地区</Label>
              <Select value={form.region} onValueChange={(v) => setForm({ ...form, region: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {getRegionOptions(form.platform).map((r) => (
                    <SelectItem key={r.val} value={r.val}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>备注</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder={notesPlaceholderByRegion[form.region] || "账号定位、目标受众、运营方向等"}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>取消</Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// 「从 AI 自动驾驶被引导过来」的返回横幅
// 触发条件：sessionStorage.oauth_return_to 有值（autopilot 在跳到这里之前会种下）
// 显示状态：1) 还没账号 → 提示"完成添加后会自动跳回"；2) 有账号了 → 大按钮"返回 AI 自动驾驶"
function ReturnToFlowBanner({ hasAccount }: { hasAccount: boolean }) {
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  useEffect(() => {
    setReturnTo(getReturnToFlow());
  }, []);
  if (!returnTo) return null;

  const goBack = () => {
    clearReturnToFlow();
    setLocation(returnTo);
  };

  return (
    <Card className={hasAccount
      ? "border-emerald-300 bg-gradient-to-r from-emerald-50 to-teal-50"
      : "border-amber-300 bg-amber-50/60"}>
      <CardContent className="pt-5 pb-5 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${hasAccount ? "bg-emerald-500" : "bg-amber-500"}`}>
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="font-semibold text-sm">
              {hasAccount ? "✓ 账号已就绪 — 可以回 AI 自动驾驶继续了" : "你正在 AI 自动驾驶流程中"}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {hasAccount
                ? "AI 已经能读到你的账号画像，点右边按钮回到刚才中断的 AI 流程。"
                : "完成下面的授权 / 手动添加后，会自动跳回 AI 自动驾驶继续生成策略。"}
            </div>
          </div>
        </div>
        {hasAccount && (
          <Button onClick={goBack} className="bg-emerald-600 hover:bg-emerald-700">
            返回 AI 自动驾驶 <ArrowRight className="h-4 w-4 ml-1.5" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
