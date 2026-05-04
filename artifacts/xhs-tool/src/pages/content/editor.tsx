import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Save, Wand2, ShieldCheck, Hash, Type, Loader2, ArrowLeft, Sparkles } from "lucide-react";

export default function ContentEditor() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const isNew = !params.id || params.id === "new";

  const [form, setForm] = useState({
    accountId: 0,
    title: "",
    body: "",
    originalReference: "",
    tags: [] as string[],
    tagInput: "",
  });

  const [aiResult, setAiResult] = useState<any>(null);
  const [sensitivityResult, setSensitivityResult] = useState<any>(null);

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.accounts.list(),
  });

  const { data: existing } = useQuery({
    queryKey: ["content", params.id],
    queryFn: () => api.content.get(Number(params.id)),
    enabled: !isNew && !!params.id,
  });

  useEffect(() => {
    if (existing) {
      setForm({
        accountId: existing.accountId,
        title: existing.title,
        body: existing.body,
        originalReference: existing.originalReference || "",
        tags: existing.tags || [],
        tagInput: "",
      });
    }
  }, [existing]);

  const saveMutation = useMutation({
    mutationFn: (data: any) =>
      isNew ? api.content.create(data) : api.content.update(Number(params.id), data),
    onSuccess: (result: any) => {
      qc.invalidateQueries({ queryKey: ["content"] });
      toast({ title: isNew ? "内容已创建" : "内容已保存" });
      if (isNew && result?.id) setLocation(`/content/${result.id}`);
    },
    onError: (e: Error) => toast({ title: "保存失败", description: e.message, variant: "destructive" }),
  });

  const rewriteMutation = useMutation({
    mutationFn: (data: any) => api.ai.rewrite(data),
    onSuccess: (result) => setAiResult(result),
    onError: (e: Error) => toast({ title: "AI改写失败", description: e.message, variant: "destructive" }),
  });

  const sensitivityMutation = useMutation({
    mutationFn: (data: any) => api.ai.checkSensitivity(data),
    onSuccess: (result) => setSensitivityResult(result),
    onError: (e: Error) => toast({ title: "检测失败", description: e.message, variant: "destructive" }),
  });

  const titleMutation = useMutation({
    mutationFn: (data: any) => api.ai.generateTitle(data),
  });

  const hashtagMutation = useMutation({
    mutationFn: (data: any) => api.ai.generateHashtags(data),
  });

  function handleSave() {
    if (!form.accountId) {
      toast({ title: "请选择账号", variant: "destructive" });
      return;
    }
    if (!form.title.trim()) {
      toast({ title: "请输入标题", variant: "destructive" });
      return;
    }
    saveMutation.mutate({
      accountId: form.accountId,
      title: form.title,
      body: form.body,
      originalReference: form.originalReference || undefined,
      tags: form.tags,
    });
  }

  function handleAddTag() {
    if (form.tagInput.trim() && !form.tags.includes(form.tagInput.trim())) {
      setForm({ ...form, tags: [...form.tags, form.tagInput.trim()], tagInput: "" });
    }
  }

  function handleRemoveTag(tag: string) {
    setForm({ ...form, tags: form.tags.filter((t) => t !== tag) });
  }

  function handleRewrite() {
    if (!form.body.trim() && !form.originalReference.trim()) {
      toast({ title: "请输入内容或竞品参考", variant: "destructive" });
      return;
    }
    const account = accounts.find((a: any) => a.id === form.accountId);
    rewriteMutation.mutate({
      originalContent: form.originalReference || form.body,
      region: account?.region,
      style: "engaging",
    });
  }

  function applyAiResult() {
    if (aiResult) {
      setForm({
        ...form,
        title: aiResult.rewrittenTitle || form.title,
        body: aiResult.rewrittenBody || form.body,
        tags: [...new Set([...form.tags, ...(aiResult.suggestedTags || [])])],
      });
      setAiResult(null);
      toast({ title: "AI结果已应用" });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/content")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{isNew ? "创建内容" : "编辑内容"}</h1>
          <p className="text-muted-foreground">使用AI辅助创建小红书内容</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="space-y-2">
                <Label>发布账号</Label>
                <Select
                  value={form.accountId ? String(form.accountId) : ""}
                  onValueChange={(v) => setForm({ ...form, accountId: Number(v) })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择发布账号" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a: any) => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {a.nickname} ({a.region})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>标题</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={titleMutation.isPending || !form.body.trim()}
                    onClick={() => titleMutation.mutate({ body: form.body, count: 5 })}
                  >
                    {titleMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Type className="h-3 w-3 mr-1" />}
                    AI生成标题
                  </Button>
                </div>
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="输入吸引人的标题"
                />
                {titleMutation.data?.titles && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {titleMutation.data.titles.map((t: string, i: number) => (
                      <Badge
                        key={i}
                        variant="outline"
                        className="cursor-pointer hover:bg-primary hover:text-primary-foreground"
                        onClick={() => setForm({ ...form, title: t })}
                      >
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>正文内容</Label>
                <Textarea
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                  placeholder="输入小红书笔记正文..."
                  rows={10}
                  className="font-mono text-sm"
                />
                <div className="text-xs text-muted-foreground text-right">
                  {form.body.length} 字
                </div>
              </div>

              <div className="space-y-2">
                <Label>竞品参考（可选）</Label>
                <Textarea
                  value={form.originalReference}
                  onChange={(e) => setForm({ ...form, originalReference: e.target.value })}
                  placeholder="粘贴竞品内容，AI将参考其风格进行改写..."
                  rows={4}
                  className="text-sm"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>标签</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={hashtagMutation.isPending || !form.body.trim()}
                    onClick={() => hashtagMutation.mutate({ title: form.title, body: form.body, count: 10 })}
                  >
                    {hashtagMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Hash className="h-3 w-3 mr-1" />}
                    AI生成标签
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={form.tagInput}
                    onChange={(e) => setForm({ ...form, tagInput: e.target.value })}
                    placeholder="输入标签后回车"
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddTag())}
                  />
                  <Button variant="outline" onClick={handleAddTag}>添加</Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {form.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="cursor-pointer" onClick={() => handleRemoveTag(tag)}>
                      #{tag} ×
                    </Badge>
                  ))}
                </div>
                {hashtagMutation.data?.hashtags && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {hashtagMutation.data.hashtags.map((h: string, i: number) => (
                      <Badge
                        key={i}
                        variant="outline"
                        className="cursor-pointer hover:bg-primary hover:text-primary-foreground"
                        onClick={() => {
                          if (!form.tags.includes(h)) setForm({ ...form, tags: [...form.tags, h] });
                        }}
                      >
                        #{h}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              保存
            </Button>
            <Button variant="outline" onClick={() => setLocation("/content")}>取消</Button>
          </div>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                AI工具
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                variant="outline"
                className="w-full justify-start"
                disabled={rewriteMutation.isPending}
                onClick={handleRewrite}
              >
                {rewriteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Wand2 className="h-4 w-4 mr-2" />}
                AI智能改写
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start"
                disabled={sensitivityMutation.isPending || !form.body.trim()}
                onClick={() => sensitivityMutation.mutate({ title: form.title, body: form.body })}
              >
                {sensitivityMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                敏感词检测
              </Button>
            </CardContent>
          </Card>

          {aiResult && (
            <Card className="border-primary/50">
              <CardHeader>
                <CardTitle className="text-base">AI改写结果</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground">标题</Label>
                  <p className="text-sm font-medium">{aiResult.rewrittenTitle}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">正文</Label>
                  <p className="text-sm whitespace-pre-wrap max-h-48 overflow-auto">
                    {aiResult.rewrittenBody}
                  </p>
                </div>
                {aiResult.suggestedTags?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {aiResult.suggestedTags.map((t: string) => (
                      <Badge key={t} variant="outline" className="text-xs">#{t}</Badge>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button size="sm" onClick={applyAiResult}>应用结果</Button>
                  <Button size="sm" variant="outline" onClick={() => setAiResult(null)}>关闭</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {sensitivityResult && (
            <Card className={sensitivityResult.score > 50 ? "border-destructive/50" : "border-green-500/50"}>
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  <span>敏感词检测结果</span>
                  <Badge variant={sensitivityResult.score > 50 ? "destructive" : "default"}>
                    风险分: {sensitivityResult.score}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {sensitivityResult.issues?.length > 0 ? (
                  <div className="space-y-2">
                    {sensitivityResult.issues.map((issue: any, i: number) => (
                      <div key={i} className="text-sm p-2 rounded bg-muted">
                        <div className="flex items-center gap-2">
                          <Badge variant={issue.severity === "high" ? "destructive" : "secondary"} className="text-xs">
                            {issue.severity === "high" ? "高" : issue.severity === "medium" ? "中" : "低"}
                          </Badge>
                          <span className="font-medium">"{issue.word}"</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{issue.reason}</p>
                        {issue.suggestion && (
                          <p className="text-xs mt-1">建议: {issue.suggestion}</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-green-600">未发现敏感词问题 ✓</p>
                )}
                <p className="text-xs text-muted-foreground">{sensitivityResult.suggestion}</p>
                <Button size="sm" variant="outline" onClick={() => setSensitivityResult(null)}>关闭</Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
