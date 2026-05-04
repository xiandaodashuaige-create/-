import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ObjectUploader } from "@workspace/object-storage-web";
import {
  Check, ChevronRight, ChevronLeft, Users, FileText, Eye, Send,
  Wand2, ShieldCheck, Hash, Type, Loader2, Sparkles, ImagePlus,
  Upload, X, Copy, ExternalLink, Plus, Globe, CheckCircle2, AlertTriangle
} from "lucide-react";

const STEPS = [
  { id: 1, label: "选择账号", icon: Users, desc: "选择要发布的小红书账号" },
  { id: 2, label: "创作内容", icon: FileText, desc: "AI辅助创作笔记内容" },
  { id: 3, label: "预览检查", icon: Eye, desc: "预览效果并检查敏感词" },
  { id: 4, label: "发布", icon: Send, desc: "发布到小红书" },
];

const regionLabels: Record<string, string> = { SG: "新加坡", HK: "香港", MY: "马来西亚" };

export default function WorkflowWizard() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [step, setStep] = useState(1);

  const [form, setForm] = useState({
    accountId: 0,
    title: "",
    body: "",
    originalReference: "",
    tags: [] as string[],
    tagInput: "",
    imageUrls: [] as string[],
  });

  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newAccount, setNewAccount] = useState({ nickname: "", region: "SG", xhsId: "" });
  const [aiResult, setAiResult] = useState<any>(null);
  const [sensitivityResult, setSensitivityResult] = useState<any>(null);
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageSize, setImageSize] = useState("1024x1024");
  const [contentSaved, setContentSaved] = useState(false);
  const [savedContentId, setSavedContentId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [publishStep, setPublishStep] = useState<"ready" | "copied" | "opened">("ready");

  const { data: accounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.accounts.list(),
  });

  const createAccountMutation = useMutation({
    mutationFn: (data: any) => api.accounts.create(data),
    onSuccess: (result: any) => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      setForm((prev) => ({ ...prev, accountId: result.id }));
      setShowAddAccount(false);
      setNewAccount({ nickname: "", region: "SG", xhsId: "" });
      toast({ title: "账号添加成功" });
    },
  });

  const saveMutation = useMutation({
    mutationFn: (data: any) =>
      savedContentId
        ? api.content.update(savedContentId, data)
        : api.content.create(data),
    onSuccess: (result: any) => {
      qc.invalidateQueries({ queryKey: ["content"] });
      setContentSaved(true);
      if (result?.id) setSavedContentId(result.id);
      toast({ title: "内容已保存" });
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

  const imageMutation = useMutation({
    mutationFn: (data: { prompt: string; style?: string; size?: string }) => api.ai.generateImage(data),
    onSuccess: (result) => {
      const url = result.storedUrl || result.imageUrl;
      setForm((prev) => ({ ...prev, imageUrls: [...prev.imageUrls, url] }));
      toast({ title: "AI配图生成成功" });
    },
    onError: (e: Error) => toast({ title: "图片生成失败", description: e.message, variant: "destructive" }),
  });

  const publishMutation = useMutation({
    mutationFn: (id: number) => api.content.publish(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["content"] });
      toast({ title: "内容已标记为已发布" });
    },
  });

  function selectedAccount() {
    return accounts.find((a: any) => a.id === form.accountId);
  }

  function canProceed(): boolean {
    switch (step) {
      case 1: return form.accountId > 0;
      case 2: return form.title.trim().length > 0 && form.body.trim().length > 0;
      case 3: return true;
      default: return true;
    }
  }

  function handleNext() {
    if (step === 2 && !contentSaved) {
      handleSave();
    }
    if (step === 3 && !sensitivityResult) {
      sensitivityMutation.mutate({ title: form.title, body: form.body });
    }
    if (step < 4) setStep(step + 1);
  }

  function handleSave() {
    saveMutation.mutate({
      accountId: form.accountId,
      title: form.title,
      body: form.body,
      originalReference: form.originalReference || undefined,
      tags: form.tags,
      imageUrls: form.imageUrls,
    });
  }

  function handleRewrite() {
    if (!form.body.trim() && !form.originalReference.trim()) {
      toast({ title: "请输入内容或竞品参考", variant: "destructive" });
      return;
    }
    const account = selectedAccount();
    rewriteMutation.mutate({
      originalContent: form.originalReference || form.body,
      region: account?.region,
      style: "engaging",
    });
  }

  function applyAiResult() {
    if (aiResult) {
      setForm((prev) => ({
        ...prev,
        title: aiResult.rewrittenTitle || prev.title,
        body: aiResult.rewrittenBody || prev.body,
        tags: [...new Set([...prev.tags, ...(aiResult.suggestedTags || [])])],
      }));
      setAiResult(null);
      setContentSaved(false);
      toast({ title: "AI结果已应用" });
    }
  }

  function handleAddTag() {
    if (form.tagInput.trim() && !form.tags.includes(form.tagInput.trim())) {
      setForm({ ...form, tags: [...form.tags, form.tagInput.trim()], tagInput: "" });
      setContentSaved(false);
    }
  }

  async function handleGetUploadParameters(file: any) {
    const res = await fetch("/api/storage/uploads/request-url", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
    });
    if (!res.ok) throw new Error("Failed to get upload URL");
    const data = await res.json();
    (file as any)._objectPath = data.objectPath;
    return { method: "PUT" as const, url: data.uploadURL, headers: { "Content-Type": file.type } };
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
    setContentSaved(false);
    toast({ title: "图片上传成功" });
  }

  function buildPublishContent(): string {
    const tagsStr = form.tags.map((t) => `#${t}`).join(" ");
    return `${form.title}\n\n${form.body}\n\n${tagsStr}`;
  }

  async function handleCopyContent() {
    try {
      await navigator.clipboard.writeText(buildPublishContent());
      setCopied(true);
      setPublishStep("copied");
      toast({ title: "内容已复制到剪贴板" });
      setTimeout(() => setCopied(false), 3000);
    } catch {
      toast({ title: "复制失败，请手动复制", variant: "destructive" });
    }
  }

  function handleOpenXHS() {
    window.open("https://creator.xiaohongshu.com/publish/publish", "_blank");
    setPublishStep("opened");
  }

  function handleMarkPublished() {
    if (savedContentId) {
      publishMutation.mutate(savedContentId);
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">创建并发布笔记</h1>
        <p className="text-muted-foreground">跟随引导，轻松完成从内容创作到发布的全流程</p>
      </div>

      <div className="flex items-center justify-between bg-card rounded-xl border p-4">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center flex-1">
            <button
              onClick={() => s.id <= step && setStep(s.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                s.id === step
                  ? "bg-red-50 text-red-600"
                  : s.id < step
                  ? "text-green-600 cursor-pointer hover:bg-green-50"
                  : "text-muted-foreground"
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  s.id === step
                    ? "bg-red-500 text-white"
                    : s.id < step
                    ? "bg-green-500 text-white"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {s.id < step ? <Check className="h-4 w-4" /> : s.id}
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-sm font-medium">{s.label}</p>
                <p className="text-xs text-muted-foreground">{s.desc}</p>
              </div>
            </button>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-2 ${i < step - 1 ? "bg-green-300" : "bg-muted"}`} />
            )}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-red-500" />
                选择发布账号
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {accountsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : accounts.length === 0 && !showAddAccount ? (
                <div className="text-center py-8">
                  <Users className="h-12 w-12 mx-auto text-muted-foreground opacity-50 mb-3" />
                  <p className="text-muted-foreground mb-4">还没有添加小红书账号</p>
                  <Button onClick={() => setShowAddAccount(true)} className="bg-red-500 hover:bg-red-600 text-white">
                    <Plus className="h-4 w-4 mr-2" />
                    添加第一个账号
                  </Button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {accounts.map((a: any) => (
                      <button
                        key={a.id}
                        onClick={() => setForm({ ...form, accountId: a.id })}
                        className={`p-4 rounded-xl border-2 text-left transition-all ${
                          form.accountId === a.id
                            ? "border-red-500 bg-red-50 shadow-sm"
                            : "border-border hover:border-red-200 hover:bg-red-50/50"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-medium ${
                            form.accountId === a.id ? "bg-red-500" : "bg-gray-400"
                          }`}>
                            {a.nickname?.[0] || "?"}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{a.nickname}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <Globe className="h-3 w-3 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">
                                {regionLabels[a.region] || a.region}
                              </span>
                              <Badge
                                variant={a.status === "active" ? "default" : "secondary"}
                                className="text-[10px] h-4 px-1"
                              >
                                {a.status === "active" ? "活跃" : "未激活"}
                              </Badge>
                            </div>
                          </div>
                          {form.accountId === a.id && (
                            <CheckCircle2 className="h-5 w-5 text-red-500 shrink-0" />
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAddAccount(!showAddAccount)}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    添加新账号
                  </Button>
                </>
              )}

              {showAddAccount && (
                <Card className="border-dashed">
                  <CardContent className="pt-4 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">昵称</Label>
                        <Input
                          value={newAccount.nickname}
                          onChange={(e) => setNewAccount({ ...newAccount, nickname: e.target.value })}
                          placeholder="账号昵称"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">地区</Label>
                        <Select value={newAccount.region} onValueChange={(v) => setNewAccount({ ...newAccount, region: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="SG">新加坡</SelectItem>
                            <SelectItem value="HK">香港</SelectItem>
                            <SelectItem value="MY">马来西亚</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">小红书ID（可选）</Label>
                        <Input
                          value={newAccount.xhsId}
                          onChange={(e) => setNewAccount({ ...newAccount, xhsId: e.target.value })}
                          placeholder="小红书号"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={!newAccount.nickname.trim() || createAccountMutation.isPending}
                        onClick={() => createAccountMutation.mutate(newAccount)}
                        className="bg-red-500 hover:bg-red-600 text-white"
                      >
                        {createAccountMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                        确认添加
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setShowAddAccount(false)}>取消</Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {step === 2 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-red-500" />
                  编写笔记内容
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-3 rounded-lg bg-muted/50 text-sm flex items-center gap-2">
                  <span className="text-muted-foreground">发布账号：</span>
                  <Badge variant="outline">{selectedAccount()?.nickname}</Badge>
                  <Badge variant="secondary" className="text-xs">
                    {regionLabels[selectedAccount()?.region] || selectedAccount()?.region}
                  </Badge>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>标题</Label>
                    <Button
                      variant="ghost" size="sm" className="h-7 text-xs"
                      disabled={titleMutation.isPending || !form.body.trim()}
                      onClick={() => titleMutation.mutate({ body: form.body, count: 5 })}
                    >
                      {titleMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Type className="h-3 w-3 mr-1" />}
                      AI生成标题
                    </Button>
                  </div>
                  <Input
                    value={form.title}
                    onChange={(e) => { setForm({ ...form, title: e.target.value }); setContentSaved(false); }}
                    placeholder="输入吸引人的标题"
                  />
                  {titleMutation.data?.titles && (
                    <div className="flex flex-wrap gap-2 mt-1">
                      {titleMutation.data.titles.map((t: string, i: number) => (
                        <Badge
                          key={i} variant="outline"
                          className="cursor-pointer hover:bg-primary hover:text-primary-foreground"
                          onClick={() => { setForm({ ...form, title: t }); setContentSaved(false); }}
                        >{t}</Badge>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>正文内容</Label>
                  <Textarea
                    value={form.body}
                    onChange={(e) => { setForm({ ...form, body: e.target.value }); setContentSaved(false); }}
                    placeholder="输入小红书笔记正文..."
                    rows={10}
                    className="font-mono text-sm"
                  />
                  <div className="text-xs text-muted-foreground text-right">{form.body.length} 字</div>
                </div>

                <div className="space-y-2">
                  <Label>竞品参考（可选）</Label>
                  <Textarea
                    value={form.originalReference}
                    onChange={(e) => setForm({ ...form, originalReference: e.target.value })}
                    placeholder="粘贴竞品内容，AI将参考其风格进行改写..."
                    rows={3} className="text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>标签</Label>
                    <Button
                      variant="ghost" size="sm" className="h-7 text-xs"
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
                      <Badge key={tag} variant="secondary" className="cursor-pointer" onClick={() => {
                        setForm({ ...form, tags: form.tags.filter((t) => t !== tag) });
                        setContentSaved(false);
                      }}>#{tag} ×</Badge>
                    ))}
                  </div>
                  {hashtagMutation.data?.hashtags && (
                    <div className="flex flex-wrap gap-2 mt-1">
                      {hashtagMutation.data.hashtags.map((h: string, i: number) => (
                        <Badge key={i} variant="outline"
                          className="cursor-pointer hover:bg-primary hover:text-primary-foreground"
                          onClick={() => {
                            if (!form.tags.includes(h)) {
                              setForm({ ...form, tags: [...form.tags, h] });
                              setContentSaved(false);
                            }
                          }}
                        >#{h}</Badge>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>配图</Label>
                    <ObjectUploader
                      maxNumberOfFiles={9} maxFileSize={10485760}
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
                          <img src={url} alt={`配图 ${i + 1}`} className="w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                          <button
                            onClick={() => { setForm((p) => ({ ...p, imageUrls: p.imageUrls.filter((_, j) => j !== i) })); setContentSaved(false); }}
                            className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          ><X className="h-3 w-3" /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4" /> AI工具
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button variant="outline" className="w-full justify-start" disabled={rewriteMutation.isPending} onClick={handleRewrite}>
                  {rewriteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Wand2 className="h-4 w-4 mr-2" />}
                  AI智能改写
                </Button>
                <Button variant="outline" className="w-full justify-start"
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
                  <ImagePlus className="h-4 w-4" /> AI生成配图
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea value={imagePrompt} onChange={(e) => setImagePrompt(e.target.value)}
                  placeholder="描述你想要的配图..." rows={3} className="text-sm"
                />
                <Select value={imageSize} onValueChange={setImageSize}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1024x1024">正方形 1:1</SelectItem>
                    <SelectItem value="1024x1792">竖版 9:16</SelectItem>
                    <SelectItem value="1792x1024">横版 16:9</SelectItem>
                  </SelectContent>
                </Select>
                <Button className="w-full bg-red-500 hover:bg-red-600 text-white"
                  disabled={imageMutation.isPending || !imagePrompt.trim()}
                  onClick={() => imageMutation.mutate({ prompt: imagePrompt, size: imageSize })}
                >
                  {imageMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />生成中...</> : <><ImagePlus className="h-4 w-4 mr-2" />生成配图</>}
                </Button>
              </CardContent>
            </Card>

            {aiResult && (
              <Card className="border-primary/50">
                <CardHeader><CardTitle className="text-base">AI改写结果</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">标题</Label>
                    <p className="text-sm font-medium">{aiResult.rewrittenTitle}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">正文</Label>
                    <p className="text-sm whitespace-pre-wrap max-h-48 overflow-auto">{aiResult.rewrittenBody}</p>
                  </div>
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
                    <span>敏感词检测</span>
                    <Badge variant={sensitivityResult.score > 50 ? "destructive" : "default"}>
                      风险分: {sensitivityResult.score}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {sensitivityResult.issues?.length > 0 ? (
                    sensitivityResult.issues.map((issue: any, i: number) => (
                      <div key={i} className="text-sm p-2 rounded bg-muted">
                        <Badge variant={issue.severity === "high" ? "destructive" : "secondary"} className="text-xs mr-1">
                          {issue.severity === "high" ? "高" : issue.severity === "medium" ? "中" : "低"}
                        </Badge>
                        <span className="font-medium">"{issue.word}"</span>
                        {issue.suggestion && <p className="text-xs mt-1">建议: {issue.suggestion}</p>}
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-green-600">未发现敏感词问题</p>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setSensitivityResult(null)}>关闭</Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5 text-red-500" />
                笔记预览
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-white rounded-xl border shadow-sm max-w-sm mx-auto overflow-hidden">
                {form.imageUrls.length > 0 && (
                  <div className="aspect-[4/3] bg-muted overflow-hidden">
                    <img src={form.imageUrls[0]} alt="封面" className="w-full h-full object-cover" />
                  </div>
                )}
                <div className="p-4 space-y-3">
                  <h3 className="font-bold text-base leading-tight">{form.title || "未输入标题"}</h3>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap line-clamp-6">
                    {form.body || "未输入正文"}
                  </p>
                  {form.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {form.tags.map((t) => (
                        <span key={t} className="text-xs text-red-500">#{t}</span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2 pt-2 border-t">
                    <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-xs font-medium">
                      {selectedAccount()?.nickname?.[0] || "?"}
                    </div>
                    <span className="text-xs text-gray-500">{selectedAccount()?.nickname}</span>
                  </div>
                </div>
              </div>
              {form.imageUrls.length > 1 && (
                <div className="mt-4">
                  <p className="text-xs text-muted-foreground mb-2">全部配图 ({form.imageUrls.length}张)</p>
                  <div className="grid grid-cols-4 gap-2">
                    {form.imageUrls.map((url, i) => (
                      <div key={i} className="aspect-square rounded-lg overflow-hidden border bg-muted">
                        <img src={url} alt={`配图 ${i + 1}`} className="w-full h-full object-cover" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" />
                  安全检查
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {sensitivityMutation.isPending ? (
                  <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>正在检测敏感词...</span>
                  </div>
                ) : sensitivityResult ? (
                  <>
                    <div className={`p-3 rounded-lg flex items-center gap-3 ${
                      sensitivityResult.score > 50 ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"
                    }`}>
                      {sensitivityResult.score > 50 ? (
                        <AlertTriangle className="h-5 w-5" />
                      ) : (
                        <CheckCircle2 className="h-5 w-5" />
                      )}
                      <div>
                        <p className="font-medium">
                          {sensitivityResult.score > 50 ? "发现潜在风险" : "内容安全"}
                        </p>
                        <p className="text-xs">风险评分: {sensitivityResult.score}/100</p>
                      </div>
                    </div>
                    {sensitivityResult.issues?.length > 0 && (
                      <div className="space-y-2">
                        {sensitivityResult.issues.map((issue: any, i: number) => (
                          <div key={i} className="text-sm p-2 rounded bg-muted">
                            <Badge variant={issue.severity === "high" ? "destructive" : "secondary"} className="text-xs mr-1">
                              {issue.severity === "high" ? "高危" : issue.severity === "medium" ? "中危" : "低危"}
                            </Badge>
                            "{issue.word}" — {issue.reason}
                            {issue.suggestion && <p className="text-xs text-muted-foreground mt-1">建议: {issue.suggestion}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                    {sensitivityResult.suggestion && (
                      <p className="text-xs text-muted-foreground">{sensitivityResult.suggestion}</p>
                    )}
                  </>
                ) : (
                  <Button variant="outline" className="w-full"
                    onClick={() => sensitivityMutation.mutate({ title: form.title, body: form.body })}
                  >
                    <ShieldCheck className="h-4 w-4 mr-2" />
                    开始检测
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">内容统计</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="p-3 rounded-lg bg-muted">
                    <p className="text-muted-foreground text-xs">标题字数</p>
                    <p className="text-lg font-bold">{form.title.length}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted">
                    <p className="text-muted-foreground text-xs">正文字数</p>
                    <p className="text-lg font-bold">{form.body.length}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted">
                    <p className="text-muted-foreground text-xs">标签数</p>
                    <p className="text-lg font-bold">{form.tags.length}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted">
                    <p className="text-muted-foreground text-xs">配图数</p>
                    <p className="text-lg font-bold">{form.imageUrls.length}</p>
                  </div>
                </div>
                {form.title.length > 20 && (
                  <p className="text-xs text-amber-600 mt-2">提示：标题超过20字可能影响展示效果</p>
                )}
                {form.body.length < 50 && form.body.length > 0 && (
                  <p className="text-xs text-amber-600 mt-1">提示：正文建议至少50字以获得更好的推荐</p>
                )}
                {form.imageUrls.length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">提示：建议添加至少1张配图以提高互动率</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="max-w-2xl mx-auto space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="h-5 w-5 text-red-500" />
                发布到小红书
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className={`flex items-start gap-4 p-4 rounded-xl border-2 transition-colors ${
                  publishStep !== "ready" ? "border-green-200 bg-green-50" : "border-border"
                }`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                    publishStep !== "ready" ? "bg-green-500 text-white" : "bg-red-500 text-white"
                  }`}>
                    {publishStep !== "ready" ? <Check className="h-4 w-4" /> : "1"}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">复制笔记内容</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      将标题、正文和标签一键复制到剪贴板
                    </p>
                    <Button
                      className="mt-3 bg-red-500 hover:bg-red-600 text-white"
                      onClick={handleCopyContent}
                    >
                      {copied ? <><Check className="h-4 w-4 mr-2" />已复制</> : <><Copy className="h-4 w-4 mr-2" />一键复制全部内容</>}
                    </Button>
                  </div>
                </div>

                <div className={`flex items-start gap-4 p-4 rounded-xl border-2 transition-colors ${
                  publishStep === "opened" ? "border-green-200 bg-green-50" : "border-border"
                }`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                    publishStep === "opened" ? "bg-green-500 text-white" : publishStep === "copied" ? "bg-red-500 text-white" : "bg-muted text-muted-foreground"
                  }`}>
                    {publishStep === "opened" ? <Check className="h-4 w-4" /> : "2"}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">打开小红书创作中心</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      跳转到小红书网页版，将复制的内容粘贴发布
                    </p>
                    <Button
                      className="mt-3"
                      variant={publishStep === "copied" || publishStep === "opened" ? "default" : "outline"}
                      onClick={handleOpenXHS}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      打开小红书创作中心
                    </Button>
                  </div>
                </div>

                <div className={`flex items-start gap-4 p-4 rounded-xl border-2 transition-colors ${
                  publishMutation.isSuccess ? "border-green-200 bg-green-50" : "border-border"
                }`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                    publishMutation.isSuccess ? "bg-green-500 text-white" : publishStep === "opened" ? "bg-red-500 text-white" : "bg-muted text-muted-foreground"
                  }`}>
                    {publishMutation.isSuccess ? <Check className="h-4 w-4" /> : "3"}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">标记为已发布</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      在小红书发布成功后，点击此按钮更新状态
                    </p>
                    <Button
                      className="mt-3"
                      variant={publishMutation.isSuccess ? "outline" : publishStep === "opened" ? "default" : "outline"}
                      disabled={publishMutation.isPending || publishMutation.isSuccess || !savedContentId}
                      onClick={handleMarkPublished}
                    >
                      {publishMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> :
                       publishMutation.isSuccess ? <><Check className="h-4 w-4 mr-2" />已标记</> :
                       <><CheckCircle2 className="h-4 w-4 mr-2" />确认已发布</>}
                    </Button>
                  </div>
                </div>
              </div>

              {publishMutation.isSuccess && (
                <div className="p-4 rounded-xl bg-green-50 border border-green-200 text-center">
                  <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-2" />
                  <p className="font-medium text-green-800">恭喜！笔记发布流程已完成</p>
                  <div className="flex gap-3 justify-center mt-4">
                    <Button variant="outline" onClick={() => { setStep(1); setForm({ accountId: 0, title: "", body: "", originalReference: "", tags: [], tagInput: "", imageUrls: [] }); setContentSaved(false); setSavedContentId(null); setPublishStep("ready"); setSensitivityResult(null); setAiResult(null); publishMutation.reset(); }}>
                      发布下一篇
                    </Button>
                    <Button onClick={() => setLocation("/content")}>
                      查看所有内容
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">发布内容预览</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-muted rounded-lg p-4 text-sm whitespace-pre-wrap font-mono max-h-64 overflow-auto">
                {buildPublishContent()}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex items-center justify-between pt-4 border-t">
        <Button
          variant="outline"
          onClick={() => step > 1 ? setStep(step - 1) : setLocation("/dashboard")}
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          {step > 1 ? "上一步" : "返回仪表盘"}
        </Button>
        <div className="flex gap-3">
          {step === 2 && (
            <Button variant="outline" onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {contentSaved ? "已保存" : "保存草稿"}
            </Button>
          )}
          {step < 4 && (
            <Button
              onClick={handleNext}
              disabled={!canProceed()}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              下一步
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
