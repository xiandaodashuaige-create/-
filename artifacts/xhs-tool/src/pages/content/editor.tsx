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
import { Save, Wand2, ShieldCheck, Hash, Type, Loader2, ArrowLeft, Sparkles, ImagePlus, Upload, X, Trash2, Send, Calendar, Clock } from "lucide-react";
import { ObjectUploader } from "@workspace/object-storage-web";
import { usePlatform } from "@/lib/platform-context";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PLATFORMS } from "@/lib/platform-meta";

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
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // 默认建议时间：当前 + 1 小时（取整到下一刻钟，本地时区）
  const defaultScheduleAt = (() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  })();
  const [scheduleAt, setScheduleAt] = useState(defaultScheduleAt);

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

  // 保存 + 立即发布（手动平台 = XHS 时仅标记，自动平台 = TT/IG/FB 调度器立刻投递）
  const publishMutation = useMutation({
    mutationFn: async (data: any) => {
      const saved = isNew
        ? await api.content.create(data)
        : await api.content.update(Number(params.id), data);
      const id = saved?.id ?? Number(params.id);
      const result = await api.content.publish(id);
      return { ...result, _id: id };
    },
    onSuccess: (result: any) => {
      qc.invalidateQueries({ queryKey: ["content"] });
      qc.invalidateQueries({ queryKey: ["schedules"] });
      const meta = PLATFORMS[activePlatform];
      toast({
        title: meta.publishMode === "manual" ? "已标记为已发布" : "发布请求已提交",
        description: meta.publishMode === "manual"
          ? `${meta.name} 需手动复制内容/素材后到 App 端发布`
          : `已交给 ${meta.name} 平台投递（结果在「发布计划」查看）`,
      });
      if (isNew && result?._id) setLocation(`/content/${result._id}`);
    },
    onError: (e: Error) => toast({ title: "发布失败", description: e.message, variant: "destructive" }),
  });

  // 保存 + 定时发布
  const scheduleMutation = useMutation({
    mutationFn: async (data: { form: any; scheduledAt: string }) => {
      const saved = isNew
        ? await api.content.create(data.form)
        : await api.content.update(Number(params.id), data.form);
      const id = saved?.id ?? Number(params.id);
      const result = await api.content.schedule(id, data.scheduledAt);
      return { ...result, _id: id };
    },
    onSuccess: (result: any) => {
      qc.invalidateQueries({ queryKey: ["content"] });
      qc.invalidateQueries({ queryKey: ["schedules"] });
      setScheduleOpen(false);
      toast({
        title: "定时发布已建立",
        description: `到时系统会自动投递 · ${new Date(scheduleAt).toLocaleString("zh-CN")}`,
      });
      if (isNew && result?._id) setLocation(`/content/${result._id}`);
    },
    onError: (e: Error) => toast({ title: "定时失败", description: e.message, variant: "destructive" }),
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

  function buildPayload() {
    return {
      accountId: form.accountId,
      title: form.title,
      body: form.body,
      originalReference: form.originalReference || undefined,
      tags: form.tags,
      imageUrls: form.imageUrls,
    };
  }

  function preflight(): boolean {
    if (!form.accountId) {
      toast({ title: "请选择账号", variant: "destructive" });
      return false;
    }
    if (!form.title.trim()) {
      toast({ title: "请输入标题", variant: "destructive" });
      return false;
    }
    return true;
  }

  function handleSave() {
    if (!preflight()) return;
    saveMutation.mutate(buildPayload());
  }

  function handlePublishNow() {
    if (!preflight()) return;
    const meta = PLATFORMS[activePlatform];
    if (meta.publishMode !== "manual" && form.imageUrls.length === 0) {
      if (!confirm(`${meta.name} 自动发布需要至少 1 张图片或视频，仍要继续？`)) return;
    }
    publishMutation.mutate(buildPayload());
  }

  function handleConfirmSchedule() {
    if (!preflight()) return;
    const t = new Date(scheduleAt).getTime();
    if (isNaN(t) || t < Date.now()) {
      toast({ title: "时间无效", description: "请选择未来的时间点", variant: "destructive" });
      return;
    }
    const meta = PLATFORMS[activePlatform];
    if (meta.publishMode !== "manual" && form.imageUrls.length === 0) {
      if (!confirm(`${meta.name} 自动发布需要至少 1 张图片或视频，到时投递会失败。仍要建立定时计划吗？`)) return;
    }
    scheduleMutation.mutate({
      form: buildPayload(),
      scheduledAt: new Date(scheduleAt).toISOString(),
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

          <div className="flex flex-wrap gap-3 items-center">
            <Button variant="outline" onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              保存草稿
            </Button>

            <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
              <DialogTrigger asChild>
                <Button variant="default" className="bg-amber-500 hover:bg-amber-600 text-white">
                  <Calendar className="h-4 w-4 mr-2" />
                  定时发布
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    设置定时发布
                  </DialogTitle>
                  <DialogDescription>
                    {PLATFORMS[activePlatform].publishMode === "manual"
                      ? `${PLATFORMS[activePlatform].name} 是手动平台，到时会在「发布计划」中提醒你手动发布。`
                      : `${PLATFORMS[activePlatform].name} 到点后系统会自动调用 API 投递（每分钟扫描一次）。`}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-2">
                  <div className="space-y-2">
                    <Label>发布时间</Label>
                    <Input
                      type="datetime-local"
                      value={scheduleAt}
                      onChange={(e) => setScheduleAt(e.target.value)}
                      min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: "1 小时后", min: 60 },
                      { label: "3 小时后", min: 180 },
                      { label: "今晚 20:00", min: -1 },
                      { label: "明早 9:00", min: -2 },
                    ].map((p) => (
                      <Badge
                        key={p.label}
                        variant="outline"
                        className="cursor-pointer hover:bg-primary hover:text-primary-foreground"
                        onClick={() => {
                          const d = new Date();
                          if (p.min === -1) {
                            d.setHours(20, 0, 0, 0);
                            if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
                          } else if (p.min === -2) {
                            d.setDate(d.getDate() + 1);
                            d.setHours(9, 0, 0, 0);
                          } else {
                            d.setTime(Date.now() + p.min * 60 * 1000);
                          }
                          // Convert to local-tz datetime-local string
                          const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
                            .toISOString()
                            .slice(0, 16);
                          setScheduleAt(local);
                        }}
                      >
                        {p.label}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    选定后会先保存内容，再创建发布计划。可在「发布计划」页随时取消。
                  </p>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setScheduleOpen(false)}>取消</Button>
                  <Button onClick={handleConfirmSchedule} disabled={scheduleMutation.isPending}>
                    {scheduleMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Calendar className="h-4 w-4 mr-2" />
                    )}
                    确认定时
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Button
              className="bg-red-500 hover:bg-red-600 text-white"
              onClick={handlePublishNow}
              disabled={publishMutation.isPending}
            >
              {publishMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              立即发布
            </Button>

            <Button variant="ghost" onClick={() => setLocation("/content")}>取消</Button>
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
