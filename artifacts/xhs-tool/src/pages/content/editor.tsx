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
import { useToast } from "@/hooks/use-toast";
import { Save, Wand2, ShieldCheck, Hash, Type, Loader2, ArrowLeft, Sparkles, ImagePlus, Upload, X, Trash2 } from "lucide-react";
import { ObjectUploader } from "@workspace/object-storage-web";
import { usePlatform } from "@/lib/platform-context";

export default function ContentEditor() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const isNew = !params.id || params.id === "new";
  const { activePlatform } = usePlatform();

  const [form, setForm] = useState({
    accountId: 0,
    title: "",
    body: "",
    originalReference: "",
    tags: [] as string[],
    tagInput: "",
    imageUrls: [] as string[],
  });

  const [aiResult, setAiResult] = useState<any>(null);
  const [sensitivityResult, setSensitivityResult] = useState<any>(null);
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageSize, setImageSize] = useState("1024x1024");

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts", activePlatform],
    queryFn: () => api.accounts.list({ platform: activePlatform }),
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
        imageUrls: existing.imageUrls || [],
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
    mutationFn: (data: any) => api.ai.rewrite({ platform: activePlatform, ...data }),
    onSuccess: (result) => setAiResult(result),
    onError: (e: Error) => toast({ title: "AI改写失败", description: e.message, variant: "destructive" }),
  });

  const sensitivityMutation = useMutation({
    mutationFn: (data: any) => api.ai.checkSensitivity({ platform: activePlatform, ...data }),
    onSuccess: (result) => setSensitivityResult(result),
    onError: (e: Error) => toast({ title: "检测失败", description: e.message, variant: "destructive" }),
  });

  const titleMutation = useMutation({
    mutationFn: (data: any) => api.ai.generateTitle({ platform: activePlatform, ...data }),
  });

  const hashtagMutation = useMutation({
    mutationFn: (data: any) => api.ai.generateHashtags({ platform: activePlatform, ...data }),
  });

  const imageMutation = useMutation({
    mutationFn: (data: { prompt: string; style?: string; size?: string }) => api.ai.generateImage(data),
    onSuccess: (result) => {
      const url = result.storedUrl || result.imageUrl;
      setForm((prev) => ({ ...prev, imageUrls: [...prev.imageUrls, url] }));
      toast({ title: "AI配图生成成功" });
    },
    onError: (e: Error) => toast({ title: "图片生成失败", description: e.message, variant: "destructive" }),
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
      imageUrls: form.imageUrls,
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

  function handleRemoveImage(index: number) {
    setForm((prev) => ({
      ...prev,
      imageUrls: prev.imageUrls.filter((_, i) => i !== index),
    }));
  }

  async function handleGetUploadParameters(file: any) {
    const res = await fetch("/api/storage/uploads/request-url", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: file.name,
        size: file.size,
        contentType: file.type,
      }),
    });
    if (!res.ok) throw new Error("Failed to get upload URL");
    const data = await res.json();
    (file as any)._objectPath = data.objectPath;
    return {
      method: "PUT" as const,
      url: data.uploadURL,
      headers: { "Content-Type": file.type },
    };
  }

  function handleUploadComplete(result: any) {
    const files = result.successful || [];
    for (const file of files) {
      const objectPath = (file as any)._objectPath;
      if (objectPath) {
        const url = `/api/storage${objectPath}`;
        setForm((prev) => ({ ...prev, imageUrls: [...prev.imageUrls, url] }));
      }
    }
    toast({ title: "图片上传成功" });
  }

  function handleGenerateImage() {
    if (!imagePrompt.trim()) {
      toast({ title: "请输入图片描述", variant: "destructive" });
      return;
    }
    imageMutation.mutate({ prompt: imagePrompt, size: imageSize });
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

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>配图</Label>
                  <ObjectUploader
                    maxNumberOfFiles={9}
                    maxFileSize={10485760}
                    onGetUploadParameters={handleGetUploadParameters}
                    onComplete={handleUploadComplete}
                    buttonClassName="inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-md text-xs font-medium h-7 px-3 border border-input bg-background hover:bg-accent hover:text-accent-foreground"
                  >
                    <Upload className="h-3 w-3 mr-1" />
                    上传图片
                  </ObjectUploader>
                </div>

                {form.imageUrls.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {form.imageUrls.map((url, i) => (
                      <div key={i} className="relative group aspect-square rounded-lg overflow-hidden border bg-muted">
                        <img
                          src={url}
                          alt={`配图 ${i + 1}`}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = "";
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                        <button
                          onClick={() => handleRemoveImage(i)}
                          className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
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

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ImagePlus className="h-4 w-4" />
                AI生成配图
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={imagePrompt}
                onChange={(e) => setImagePrompt(e.target.value)}
                placeholder="描述你想要的配图，例如：一杯拿铁咖啡放在大理石桌面上，旁边有一本书和鲜花..."
                rows={3}
                className="text-sm"
              />
              <Select value={imageSize} onValueChange={setImageSize}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1024x1024">正方形 1:1</SelectItem>
                  <SelectItem value="1024x1792">竖版 9:16</SelectItem>
                  <SelectItem value="1792x1024">横版 16:9</SelectItem>
                </SelectContent>
              </Select>
              <Button
                className="w-full bg-red-500 hover:bg-red-600 text-white"
                disabled={imageMutation.isPending || !imagePrompt.trim()}
                onClick={handleGenerateImage}
              >
                {imageMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    生成中...
                  </>
                ) : (
                  <>
                    <ImagePlus className="h-4 w-4 mr-2" />
                    生成配图
                  </>
                )}
              </Button>
              {imageMutation.isPending && (
                <p className="text-xs text-muted-foreground text-center">
                  AI正在创作配图，通常需要10-30秒...
                </p>
              )}
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
                  <p className="text-sm text-green-600">未发现敏感词问题</p>
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
