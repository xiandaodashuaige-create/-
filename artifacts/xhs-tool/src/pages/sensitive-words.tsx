import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, ShieldAlert } from "lucide-react";

const categoryOptions = ["绝对化用语", "医疗违规", "虚假宣传", "营销违规", "资质违规", "政治敏感", "其他"];
const severityLabels: Record<string, string> = { low: "低", medium: "中", high: "高" };

export default function SensitiveWords() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ word: "", category: "绝对化用语", severity: "medium" });

  const { data: words = [], isLoading } = useQuery({
    queryKey: ["sensitive-words"],
    queryFn: api.sensitiveWords.list,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => api.sensitiveWords.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sensitive-words"] });
      toast({ title: "敏感词已添加" });
      setDialogOpen(false);
      setForm({ word: "", category: "绝对化用语", severity: "medium" });
    },
    onError: (e: Error) => toast({ title: "添加失败", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.sensitiveWords.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sensitive-words"] });
      toast({ title: "敏感词已删除" });
    },
  });

  const grouped: Record<string, any[]> = (words as any[]).reduce<Record<string, any[]>>((acc, w: any) => {
    if (!acc[w.category]) acc[w.category] = [];
    acc[w.category].push(w);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">敏感词库</h1>
          <p className="text-muted-foreground">管理自定义敏感词，辅助内容合规检查</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          添加敏感词
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {Object.entries(grouped).map(([category, items]) => (
          <Card key={category}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">{category}</span>
                <Badge variant="outline" className="text-xs">{items.length}</Badge>
              </div>
              <div className="flex flex-wrap gap-1">
                {items.slice(0, 8).map((w: any) => (
                  <Badge key={w.id} variant="secondary" className="text-xs">
                    {w.word}
                  </Badge>
                ))}
                {items.length > 8 && (
                  <Badge variant="outline" className="text-xs">+{items.length - 8}</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {isLoading ? (
        <Card className="animate-pulse"><CardContent className="pt-6 h-40" /></Card>
      ) : words.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground py-12">
            <ShieldAlert className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>暂无自定义敏感词</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">敏感词列表 ({words.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>敏感词</TableHead>
                  <TableHead>分类</TableHead>
                  <TableHead>严重级别</TableHead>
                  <TableHead>添加时间</TableHead>
                  <TableHead className="w-16">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {words.map((w: any) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-medium">{w.word}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{w.category}</Badge></TableCell>
                    <TableCell>
                      <Badge
                        variant={w.severity === "high" ? "destructive" : "secondary"}
                        className="text-xs"
                      >
                        {severityLabels[w.severity] || w.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(w.createdAt).toLocaleDateString("zh-CN")}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => {
                          if (confirm("确定删除？")) deleteMutation.mutate(w.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加敏感词</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>敏感词</Label>
              <Input
                value={form.word}
                onChange={(e) => setForm({ ...form, word: e.target.value })}
                placeholder="输入敏感词"
              />
            </div>
            <div className="space-y-2">
              <Label>分类</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>严重级别</Label>
              <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">低</SelectItem>
                  <SelectItem value="medium">中</SelectItem>
                  <SelectItem value="high">高</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button
              onClick={() => {
                if (!form.word.trim()) { toast({ title: "请输入敏感词", variant: "destructive" }); return; }
                createMutation.mutate(form);
              }}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "添加中..." : "添加"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
