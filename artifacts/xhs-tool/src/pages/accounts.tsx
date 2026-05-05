import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Edit, Users, MapPin } from "lucide-react";

const regionLabels: Record<string, string> = { SG: "🇸🇬 新加坡", HK: "🇭🇰 香港", MY: "🇲🇾 马来西亚" };
const statusLabels: Record<string, string> = { active: "活跃", inactive: "未激活", banned: "已封禁" };

const nicknamePlaceholderByRegion: Record<string, string> = {
  SG: "如：Sarah的新加坡日记",
  HK: "如：Hong Kong Living｜阿May",
  MY: "如：吉隆坡探店女孩",
};

const notesPlaceholderByRegion: Record<string, string> = {
  SG: "业务方向，如：新加坡留学咨询、本地美食探店、亲子育儿",
  HK: "業務方向，如：香港美容護膚分享、銅鑼灣探店、移居香港攻略",
  MY: "业务方向，如：马来西亚旅游攻略、新山美食、华人社区生活",
};

export default function Accounts() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState("ALL");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<any>(null);
  const [form, setForm] = useState({ nickname: "", region: "SG", notes: "" });

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["accounts", filter],
    queryFn: () => api.accounts.list({ region: filter }),
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
    setForm({ nickname: "", region: "SG", notes: "" });
  }

  function openEdit(account: any) {
    setEditAccount(account);
    setForm({ nickname: account.nickname, region: account.region, notes: account.notes || "" });
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">账号管理</h1>
          <p className="text-muted-foreground">管理多地区小红书账号</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          添加账号
        </Button>
      </div>

      <div className="flex gap-2">
        {[{ val: "ALL", label: "全部" }, { val: "SG", label: "🇸🇬 新加坡" }, { val: "HK", label: "🇭🇰 香港" }, { val: "MY", label: "🇲🇾 马来西亚" }].map((r) => (
          <Button
            key={r.val}
            variant={filter === r.val ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(r.val)}
          >
            {r.label}
          </Button>
        ))}
      </div>

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
            <p>暂无账号，点击上方按钮添加</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((account: any) => (
            <Card key={account.id} className="hover:shadow-md transition-shadow">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                      {account.nickname.charAt(0)}
                    </div>
                    <div>
                      <h3 className="font-semibold">{account.nickname}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">
                          {regionLabels[account.region]}
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
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => {
                        if (confirm("确定删除该账号？")) deleteMutation.mutate(account.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
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
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editAccount ? "编辑账号" : "添加账号"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>昵称</Label>
              <Input
                value={form.nickname}
                onChange={(e) => setForm({ ...form, nickname: e.target.value })}
                placeholder={nicknamePlaceholderByRegion[form.region] || "请输入小红书账号昵称"}
              />
            </div>
            <div className="space-y-2">
              <Label>地区</Label>
              <Select value={form.region} onValueChange={(v) => setForm({ ...form, region: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SG">🇸🇬 新加坡</SelectItem>
                  <SelectItem value="HK">🇭🇰 香港</SelectItem>
                  <SelectItem value="MY">🇲🇾 马来西亚</SelectItem>
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
