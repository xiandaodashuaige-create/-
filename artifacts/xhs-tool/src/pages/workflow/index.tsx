import { useState, useEffect, useCallback } from "react";
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
  Check, ChevronRight, ChevronLeft, Users, FileText, Send,
  Wand2, ShieldCheck, Hash, Type, Loader2, Sparkles, ImagePlus,
  Upload, X, Copy, ExternalLink, Plus, Globe, CheckCircle2, AlertTriangle,
  Search, Target, Lightbulb, ArrowRight, RotateCcw, Zap, TrendingUp,
  Video, Eye, Download, Clock, Image as ImageIcon, RefreshCw
} from "lucide-react";

const STEPS = [
  { id: 1, label: "分析爆款", icon: Search, desc: "选择账号、分析同行验证的爆款文案/配图/时间点" },
  { id: 2, label: "生成内容", icon: FileText, desc: "AI参考爆款模式生成原创内容、伪原创配图、上传团队视频" },
  { id: 3, label: "发布", icon: Send, desc: "按AI推荐时间，下载素材+复制内容，发布到小红书" },
];

const regionLabels: Record<string, string> = { SG: "新加坡", HK: "香港", MY: "马来西亚" };

interface AiProgressStep {
  label: string;
  status: "pending" | "running" | "done";
}

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
    videoUrl: "",
  });

  const [researchInput, setResearchInput] = useState({
    businessDescription: "",
    competitorLink: "",
    niche: "",
  });
  const [researchResult, setResearchResult] = useState<any>(null);
  const [selectedSuggestion, setSelectedSuggestion] = useState<number | null>(null);

  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newAccount, setNewAccount] = useState({ nickname: "", region: "SG", xhsId: "" });
  const [aiResult, setAiResult] = useState<any>(null);
  const [sensitivityResult, setSensitivityResult] = useState<any>(null);
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageSize, setImageSize] = useState("1024x1536");
  const [referenceImageUrl, setReferenceImageUrl] = useState("");
  const [imageMode, setImageMode] = useState<"generate" | "reference">("generate");
  const [contentSaved, setContentSaved] = useState(false);
  const [savedContentId, setSavedContentId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [publishStep, setPublishStep] = useState<"ready" | "copied" | "opened">("ready");

  const [aiProgress, setAiProgress] = useState<{ active: boolean; steps: AiProgressStep[] }>({
    active: false,
    steps: [],
  });

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

  const researchMutation = useMutation({
    mutationFn: (data: any) => api.ai.competitorResearch(data),
    onSuccess: (result) => {
      setResearchResult(result);
      setSelectedSuggestion(null);
      toast({ title: "同行爆款分析完成！已生成3套验证方案" });
    },
    onError: (e: Error) => toast({ title: "分析失败", description: e.message, variant: "destructive" }),
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

  const titleMutation = useMutation({ mutationFn: (data: any) => api.ai.generateTitle(data) });
  const hashtagMutation = useMutation({ mutationFn: (data: any) => api.ai.generateHashtags(data) });

  const imageMutation = useMutation({
    mutationFn: (data: { prompt: string; style?: string; size?: string }) => api.ai.generateImage(data),
    onSuccess: (result) => {
      const url = result.storedUrl || result.imageUrl;
      setForm((prev) => ({ ...prev, imageUrls: [...prev.imageUrls, url] }));
      toast({ title: "AI配图生成成功" });
    },
    onError: (e: Error) => toast({ title: "图片生成失败", description: e.message, variant: "destructive" }),
  });

  const editImageMutation = useMutation({
    mutationFn: (data: { prompt: string; referenceImageUrl: string; size?: string }) => api.ai.editImage(data),
    onSuccess: (result) => {
      const url = result.storedUrl || result.imageUrl;
      setForm((prev) => ({ ...prev, imageUrls: [...prev.imageUrls, url] }));
      toast({ title: "参考图伪原创成功！" });
    },
    onError: (e: Error) => toast({ title: "图片编辑失败", description: e.message, variant: "destructive" }),
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
      default: return true;
    }
  }

  function handleNext() {
    if (step === 2 && !contentSaved) {
      handleSave();
    }
    if (step < 3) setStep(step + 1);
  }

  function handleSave() {
    saveMutation.mutate({
      accountId: form.accountId,
      title: form.title,
      body: form.body,
      originalReference: form.originalReference || undefined,
      tags: form.tags,
      imageUrls: form.imageUrls,
      videoUrl: form.videoUrl || undefined,
    });
  }

  function handleResearch() {
    const { businessDescription, competitorLink, niche } = researchInput;
    if (!businessDescription.trim() && !competitorLink.trim() && !niche.trim()) {
      toast({ title: "请至少填写一项信息", variant: "destructive" });
      return;
    }
    const account = selectedAccount();
    researchMutation.mutate({
      businessDescription: businessDescription || undefined,
      competitorLink: competitorLink || undefined,
      niche: niche || undefined,
      region: account?.region,
    });
  }

  const runAiProgressSequence = useCallback(async (suggestion: any) => {
    const steps: AiProgressStep[] = [
      { label: "正在应用内容方案...", status: "running" },
      { label: "正在进行敏感词检测...", status: "pending" },
      { label: "准备AI配图建议...", status: "pending" },
    ];
    setAiProgress({ active: true, steps: [...steps] });

    await new Promise(r => setTimeout(r, 600));
    steps[0].status = "done";
    steps[1].status = "running";
    setAiProgress({ active: true, steps: [...steps] });

    setForm((prev) => ({
      ...prev,
      title: suggestion.title,
      body: suggestion.body,
      tags: suggestion.tags || [],
    }));

    try {
      const sensitivityRes = await api.ai.checkSensitivity({ title: suggestion.title, body: suggestion.body });
      setSensitivityResult(sensitivityRes);
    } catch {}

    steps[1].status = "done";
    steps[2].status = "running";
    setAiProgress({ active: true, steps: [...steps] });

    if (suggestion.imagePrompt) {
      setImagePrompt(suggestion.imagePrompt);
    }

    await new Promise(r => setTimeout(r, 400));
    steps[2].status = "done";
    setAiProgress({ active: true, steps: [...steps] });

    await new Promise(r => setTimeout(r, 500));
    setAiProgress({ active: false, steps: [] });
    setContentSaved(false);
    setStep(2);
  }, []);

  function handleAdoptSuggestion(index: number) {
    const suggestion = researchResult?.suggestions?.[index];
    if (!suggestion) return;
    setSelectedSuggestion(index);
    runAiProgressSequence(suggestion);
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

  function handleImageUploadComplete(result: any) {
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

  function handleRefImageUploadComplete(result: any) {
    const files = result.successful || [];
    for (const file of files) {
      const objectPath = (file as any)._objectPath;
      if (objectPath) {
        setReferenceImageUrl(`/api/storage${objectPath}`);
        toast({ title: "参考图片已上传" });
      }
    }
  }

  function handleVideoUploadComplete(result: any) {
    const files = result.successful || [];
    for (const file of files) {
      const objectPath = (file as any)._objectPath;
      if (objectPath) {
        const url = `/api/storage${objectPath}`;
        setForm((prev) => ({ ...prev, videoUrl: url }));
      }
    }
    setContentSaved(false);
    toast({ title: "视频上传成功" });
  }

  function buildPublishContent(): string {
    const tagsStr = form.tags.map((t) => `#${t}`).join(" ");
    return `${form.title}\n\n${form.body}\n\n${tagsStr}`;
  }

  const handleCopyContent = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(buildPublishContent());
      setCopied(true);
      setPublishStep("copied");
      toast({ title: "内容已复制到剪贴板" });
      setTimeout(() => setCopied(false), 3000);
    } catch {
      toast({ title: "复制失败，请手动复制", variant: "destructive" });
    }
  }, [form, toast]);

  async function handleDownloadImage(url: string, index: number) {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `xiaohongshu_image_${index + 1}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(url, "_blank");
    }
  }

  async function handleDownloadAllImages() {
    for (let i = 0; i < form.imageUrls.length; i++) {
      await handleDownloadImage(form.imageUrls[i], i);
      await new Promise(r => setTimeout(r, 500));
    }
    toast({ title: `已下载 ${form.imageUrls.length} 张配图` });
  }

  async function handleDownloadVideo() {
    if (!form.videoUrl) return;
    try {
      const response = await fetch(form.videoUrl);
      const blob = await response.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "xiaohongshu_video.mp4";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(form.videoUrl, "_blank");
    }
  }

  useEffect(() => {
    if (step === 3 && publishStep === "ready") {
      handleCopyContent();
    }
  }, [step]);

  function handleOpenXHS() {
    window.open("https://creator.xiaohongshu.com/publish/publish", "_blank");
    setPublishStep("opened");
  }

  function handleMarkPublished() {
    if (savedContentId) {
      publishMutation.mutate(savedContentId);
    }
  }

  function handleReset() {
    setStep(1);
    setForm({ accountId: 0, title: "", body: "", originalReference: "", tags: [], tagInput: "", imageUrls: [], videoUrl: "" });
    setResearchInput({ businessDescription: "", competitorLink: "", niche: "" });
    setResearchResult(null);
    setSelectedSuggestion(null);
    setContentSaved(false);
    setSavedContentId(null);
    setPublishStep("ready");
    setSensitivityResult(null);
    setAiResult(null);
    setImagePrompt("");
    setReferenceImageUrl("");
    setImageMode("generate");
    publishMutation.reset();
  }

  function handleGenerateOrEditImage() {
    if (imageMode === "reference" && referenceImageUrl) {
      editImageMutation.mutate({ prompt: imagePrompt, referenceImageUrl, size: imageSize });
    } else {
      imageMutation.mutate({ prompt: imagePrompt, size: imageSize });
    }
  }

  const hasResearchInput = researchInput.businessDescription.trim() || researchInput.competitorLink.trim() || researchInput.niche.trim();
  const isImageGenerating = imageMutation.isPending || editImageMutation.isPending;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">创建并发布笔记</h1>
        <p className="text-muted-foreground">分析同行爆款 → AI生成同款原创 → 轻松发布</p>
      </div>

      <div data-workflow-step={step} className="flex items-center justify-between bg-card rounded-xl border p-3 overflow-x-auto">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center flex-1 min-w-0">
            <button
              onClick={() => s.id <= step && setStep(s.id)}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-colors shrink-0 ${
                s.id === step
                  ? "bg-red-50 text-red-600"
                  : s.id < step
                  ? "text-green-600 cursor-pointer hover:bg-green-50"
                  : "text-muted-foreground"
              }`}
            >
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0 ${
                s.id === step
                  ? "bg-red-500 text-white"
                  : s.id < step
                  ? "bg-green-500 text-white"
                  : "bg-muted text-muted-foreground"
              }`}>
                {s.id < step ? <Check className="h-3.5 w-3.5" /> : s.id}
              </div>
              <div className="hidden md:block text-left">
                <p className="text-xs font-medium leading-tight">{s.label}</p>
                <p className="text-[10px] text-muted-foreground hidden lg:block">{s.desc}</p>
              </div>
            </button>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 min-w-4 ${i < step - 1 ? "bg-green-300" : "bg-muted"}`} />
            )}
          </div>
        ))}
      </div>

      {/* AI Progress Overlay */}
      {aiProgress.active && (
        <Card className="border-red-200 bg-gradient-to-r from-red-50 to-pink-50">
          <CardContent className="py-8">
            <div className="flex flex-col items-center gap-6">
              <div className="relative">
                <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
                  <Sparkles className="h-8 w-8 text-red-500 animate-pulse" />
                </div>
                <div className="absolute inset-0 w-16 h-16 rounded-full border-2 border-red-300 animate-ping opacity-30" />
              </div>
              <div className="text-center">
                <h3 className="text-lg font-bold text-red-800 mb-1">AI正在为你准备内容</h3>
                <p className="text-sm text-red-600">请稍候，马上就好...</p>
              </div>
              <div className="w-full max-w-sm space-y-3">
                {aiProgress.steps.map((s, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all ${
                      s.status === "done" ? "bg-green-500 text-white" :
                      s.status === "running" ? "bg-red-500 text-white" :
                      "bg-gray-200 text-gray-400"
                    }`}>
                      {s.status === "done" ? <Check className="h-3.5 w-3.5" /> :
                       s.status === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
                       <span className="text-xs">{i + 1}</span>}
                    </div>
                    <span className={`text-sm ${
                      s.status === "done" ? "text-green-700" :
                      s.status === "running" ? "text-red-700 font-medium" :
                      "text-gray-400"
                    }`}>{s.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 1: Research + Account Selection */}
      {step === 1 && !aiProgress.active && (
        <div className="space-y-6">
          {/* Quick Account Selector */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-red-500" />
                选择发布账号
                <span className="text-xs text-muted-foreground font-normal">（用于定制不同地区的内容策略）</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {accountsLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : accounts.length === 0 && !showAddAccount ? (
                <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-lg border border-amber-200">
                  <Lightbulb className="h-5 w-5 text-amber-500 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-amber-800">还没有添加小红书账号</p>
                    <p className="text-xs text-amber-600">添加账号后，AI会根据地区定制内容策略</p>
                  </div>
                  <Button size="sm" onClick={() => setShowAddAccount(true)} className="bg-red-500 hover:bg-red-600 text-white shrink-0">
                    <Plus className="h-3.5 w-3.5 mr-1" />添加账号
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {accounts.map((a: any) => (
                    <button
                      key={a.id}
                      onClick={() => setForm({ ...form, accountId: a.id })}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-all text-sm ${
                        form.accountId === a.id
                          ? "border-red-500 bg-red-50"
                          : "border-border hover:border-red-200"
                      }`}
                    >
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-medium ${
                        form.accountId === a.id ? "bg-red-500" : "bg-gray-400"
                      }`}>
                        {a.nickname?.[0] || "?"}
                      </div>
                      <span className="font-medium">{a.nickname}</span>
                      <Badge variant="secondary" className="text-[10px] h-4 px-1.5" data-account-region={a.region}>
                        {regionLabels[a.region] || a.region}
                      </Badge>
                      {form.accountId === a.id && <CheckCircle2 className="h-4 w-4 text-red-500" />}
                    </button>
                  ))}
                  <button
                    onClick={() => setShowAddAccount(!showAddAccount)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border-2 border-dashed border-gray-300 text-gray-500 hover:border-red-300 hover:text-red-500 text-sm transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />添加
                  </button>
                </div>
              )}

              {showAddAccount && (
                <div className="p-3 border rounded-lg border-dashed space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">昵称</Label>
                      <Input value={newAccount.nickname} onChange={(e) => setNewAccount({ ...newAccount, nickname: e.target.value })} placeholder="账号昵称" />
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
                      <Input value={newAccount.xhsId} onChange={(e) => setNewAccount({ ...newAccount, xhsId: e.target.value })} placeholder="小红书号" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={!newAccount.nickname.trim() || createAccountMutation.isPending} onClick={() => createAccountMutation.mutate(newAccount)} className="bg-red-500 hover:bg-red-600 text-white">
                      {createAccountMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                      确认添加
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowAddAccount(false)}>取消</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Research Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5 text-red-500" />
                同行爆款分析 — 站在巨人肩膀上创作
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200">
                <div className="flex items-start gap-3">
                  <Lightbulb className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-amber-800">分析同行已验证的爆款文案、配图风格和最佳发布时间</p>
                    <p className="text-amber-600 mt-1">填写以下任意一项，AI就能找到同行跑通的爆款模式，为你生成3套经过验证的内容方案。不用自己从零摸索！</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5">
                      <Target className="h-3.5 w-3.5 text-red-500" />
                      你的业务/品牌描述
                    </Label>
                    <Textarea
                      value={researchInput.businessDescription}
                      onChange={(e) => setResearchInput({ ...researchInput, businessDescription: e.target.value })}
                      placeholder="例如：我是做新加坡留学咨询的，主要帮助中国学生申请新加坡本科和研究生..."
                      rows={3}
                      className="text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5">
                      <Globe className="h-3.5 w-3.5 text-blue-500" />
                      对标同行链接/账号（可选）
                    </Label>
                    <Input
                      value={researchInput.competitorLink}
                      onChange={(e) => setResearchInput({ ...researchInput, competitorLink: e.target.value })}
                      placeholder="小红书主页链接、账号名或竞品品牌名"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5">
                      <TrendingUp className="h-3.5 w-3.5 text-green-500" />
                      行业/赛道关键词（可选）
                    </Label>
                    <Input
                      value={researchInput.niche}
                      onChange={(e) => setResearchInput({ ...researchInput, niche: e.target.value })}
                      placeholder="例如：美妆护肤、留学咨询、母婴育儿、餐饮探店"
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="p-3 rounded-lg bg-muted/50 text-sm">
                    <p className="font-medium mb-2 text-muted-foreground">AI帮你分析同行已验证的爆款：</p>
                    <div className="space-y-2 text-muted-foreground text-xs">
                      <div className="flex items-start gap-2">
                        <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-0.5"><span className="text-red-500 text-[10px] font-bold">1</span></div>
                        <span>🔥 爆款文案：同行哪些文案已经跑通？提炼成功要素</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-0.5"><span className="text-red-500 text-[10px] font-bold">2</span></div>
                        <span>🎨 爆款素材：分析热门配图风格，指导伪原创方向</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-0.5"><span className="text-red-500 text-[10px] font-bold">3</span></div>
                        <span>⏰ 爆款时间点：推荐同行验证的最佳发布时间段</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-0.5"><span className="text-red-500 text-[10px] font-bold">4</span></div>
                        <span>📝 3套方案：基于爆款模式，生成可直接采用的原创方案</span>
                      </div>
                    </div>
                  </div>

                  {form.accountId > 0 && (
                    <div className="p-3 rounded-lg bg-muted/50 text-sm flex items-center gap-2">
                      <span className="text-muted-foreground">发布账号：</span>
                      <Badge variant="outline">{selectedAccount()?.nickname}</Badge>
                      <Badge variant="secondary" className="text-xs" data-account-region={selectedAccount()?.region}>
                        {regionLabels[selectedAccount()?.region] || selectedAccount()?.region}
                      </Badge>
                    </div>
                  )}
                </div>
              </div>

              <Button
                onClick={handleResearch}
                disabled={researchMutation.isPending || !hasResearchInput}
                className="w-full bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 text-white h-12 text-base"
              >
                {researchMutation.isPending ? (
                  <><Loader2 className="h-5 w-5 animate-spin mr-2" />AI正在分析同行爆款模式，请稍候（约10-20秒）...</>
                ) : (
                  <><Zap className="h-5 w-5 mr-2" />开始分析同行爆款</>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Research Results */}
          {researchResult && (
            <>
              <Card className="border-blue-200 bg-blue-50/30">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Target className="h-4 w-4 text-blue-500" />
                    同行爆款分析报告
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div className="p-3 rounded-lg bg-white border">
                      <p className="text-xs text-muted-foreground font-medium mb-1">行业概况</p>
                      <p>{researchResult.analysis?.industry}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-white border">
                      <p className="text-xs text-muted-foreground font-medium mb-1">目标受众</p>
                      <p>{researchResult.analysis?.targetAudience}</p>
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-white border text-sm">
                    <p className="text-xs text-muted-foreground font-medium mb-1">同行爆款洞察</p>
                    <p>{researchResult.analysis?.competitorInsights}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-white border text-sm">
                    <p className="text-xs text-muted-foreground font-medium mb-1">推荐内容策略</p>
                    <p>{researchResult.analysis?.contentStrategy}</p>
                  </div>
                  {researchResult.analysis?.popularAngles?.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      <span className="text-xs text-muted-foreground">热门切入角度：</span>
                      {researchResult.analysis.popularAngles.map((a: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-xs">{a}</Badge>
                      ))}
                    </div>
                  )}

                  {/* Posting Time Recommendations */}
                  {researchResult.analysis?.bestPostingTimes?.length > 0 && (
                    <div className="p-3 rounded-lg bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200">
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="h-4 w-4 text-purple-500" />
                        <p className="text-sm font-medium text-purple-800">推荐发布时间</p>
                      </div>
                      <div className="flex flex-wrap gap-2 mb-2">
                        {researchResult.analysis.bestPostingTimes.map((time: string, i: number) => (
                          <Badge key={i} className="bg-purple-100 text-purple-700 text-xs">{time}</Badge>
                        ))}
                      </div>
                      {researchResult.analysis?.postingTimeReason && (
                        <p className="text-xs text-purple-600">{researchResult.analysis.postingTimeReason}</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <div>
                <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-red-500" />
                  选择经过验证的爆款方案
                </h3>
                <p className="text-sm text-muted-foreground mb-4">以下方案基于同行已验证的爆款模式生成。点击"采用此方案"，AI自动填充内容并检测敏感词。</p>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {researchResult.suggestions?.map((suggestion: any, index: number) => (
                    <Card
                      key={index}
                      className={`transition-all hover:shadow-md ${
                        selectedSuggestion === index ? "border-red-500 ring-2 ring-red-200" : "border-border"
                      }`}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <Badge className="bg-red-100 text-red-700 text-xs">方案 {index + 1}</Badge>
                          <Badge variant="outline" className="text-[10px]">{suggestion.style}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{suggestion.angle}</p>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div>
                          <p className="font-bold text-sm leading-tight">{suggestion.title}</p>
                        </div>
                        <div className="text-xs text-gray-600 whitespace-pre-wrap line-clamp-6 leading-relaxed bg-muted/50 rounded-lg p-2.5">
                          {suggestion.body}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {suggestion.tags?.slice(0, 4).map((t: string, ti: number) => (
                            <span key={ti} className="text-[10px] text-red-500">#{t}</span>
                          ))}
                          {suggestion.tags?.length > 4 && (
                            <span className="text-[10px] text-muted-foreground">+{suggestion.tags.length - 4}</span>
                          )}
                        </div>
                        <p className="text-[11px] text-green-600 bg-green-50 rounded px-2 py-1">
                          {suggestion.whyThisWorks}
                        </p>
                        <Button
                          className="w-full bg-red-500 hover:bg-red-600 text-white"
                          size="sm"
                          onClick={() => handleAdoptSuggestion(index)}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                          采用此方案
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>

              <div className="flex justify-center gap-3">
                <Button variant="outline" onClick={handleResearch} disabled={researchMutation.isPending}>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  重新生成方案
                </Button>
                <Button variant="ghost" onClick={() => { setStep(2); toast({ title: "已跳过，直接开始创作" }); }}>
                  跳过，直接创作
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </>
          )}

          {!researchResult && !researchMutation.isPending && (
            <div className="text-center py-2">
              <Button variant="ghost" className="text-muted-foreground" onClick={() => { setStep(2); toast({ title: "已跳过爆款分析" }); }}>
                我已有内容思路，跳过此步
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Create Content + Preview (Merged) */}
      {step === 2 && !aiProgress.active && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {selectedSuggestion !== null && researchResult?.suggestions?.[selectedSuggestion] && (
              <div className="p-3 rounded-xl bg-green-50 border border-green-200 flex items-center gap-3 text-sm">
                <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                <div className="flex-1">
                  <span className="font-medium text-green-800">已采用方案 {selectedSuggestion + 1}：</span>
                  <span className="text-green-700">{researchResult.suggestions[selectedSuggestion].angle}</span>
                </div>
                <Button size="sm" variant="ghost" className="text-xs" onClick={() => setStep(1)}>
                  重新选择
                </Button>
              </div>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-red-500" />
                  编写笔记内容
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {form.accountId > 0 && (
                  <div className="p-3 rounded-lg bg-muted/50 text-sm flex items-center gap-2">
                    <span className="text-muted-foreground">发布账号：</span>
                    <Badge variant="outline">{selectedAccount()?.nickname}</Badge>
                    <Badge variant="secondary" className="text-xs" data-account-region={selectedAccount()?.region}>
                      {regionLabels[selectedAccount()?.region] || selectedAccount()?.region}
                    </Badge>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>标题</Label>
                    <Button variant="ghost" size="sm" className="h-7 text-xs"
                      disabled={titleMutation.isPending || !form.body.trim()}
                      onClick={() => titleMutation.mutate({ body: form.body, count: 5 })}
                    >
                      {titleMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Type className="h-3 w-3 mr-1" />}
                      AI生成标题
                    </Button>
                  </div>
                  <Input value={form.title} onChange={(e) => { setForm({ ...form, title: e.target.value }); setContentSaved(false); }} placeholder="输入吸引人的标题" />
                  {titleMutation.data?.titles && (
                    <div className="flex flex-wrap gap-2 mt-1">
                      {titleMutation.data.titles.map((t: string, i: number) => (
                        <Badge key={i} variant="outline" className="cursor-pointer hover:bg-primary hover:text-primary-foreground"
                          onClick={() => { setForm({ ...form, title: t }); setContentSaved(false); }}>{t}</Badge>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>正文内容</Label>
                  <Textarea value={form.body} onChange={(e) => { setForm({ ...form, body: e.target.value }); setContentSaved(false); }}
                    placeholder="输入小红书笔记正文..." rows={10} className="font-mono text-sm" />
                  <div className="text-xs text-muted-foreground text-right">{form.body.length} 字</div>
                </div>

                <div className="space-y-2">
                  <Label>竞品参考（可选）</Label>
                  <Textarea value={form.originalReference} onChange={(e) => setForm({ ...form, originalReference: e.target.value })}
                    placeholder="粘贴竞品内容，AI将参考其风格进行改写..." rows={3} className="text-sm" />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>标签</Label>
                    <Button variant="ghost" size="sm" className="h-7 text-xs"
                      disabled={hashtagMutation.isPending || !form.body.trim()}
                      onClick={() => hashtagMutation.mutate({ title: form.title, body: form.body, count: 10 })}
                    >
                      {hashtagMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Hash className="h-3 w-3 mr-1" />}
                      AI生成标签
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Input value={form.tagInput} onChange={(e) => setForm({ ...form, tagInput: e.target.value })}
                      placeholder="输入标签后回车" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddTag())} />
                    <Button variant="outline" onClick={handleAddTag}>添加</Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {form.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="cursor-pointer" onClick={() => {
                        setForm({ ...form, tags: form.tags.filter((t) => t !== tag) }); setContentSaved(false);
                      }}>#{tag} ×</Badge>
                    ))}
                  </div>
                  {hashtagMutation.data?.hashtags && (
                    <div className="flex flex-wrap gap-2 mt-1">
                      {hashtagMutation.data.hashtags.map((h: string, i: number) => (
                        <Badge key={i} variant="outline" className="cursor-pointer hover:bg-primary hover:text-primary-foreground"
                          onClick={() => { if (!form.tags.includes(h)) { setForm({ ...form, tags: [...form.tags, h] }); setContentSaved(false); } }}>#{h}</Badge>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>配图</Label>
                    <ObjectUploader maxNumberOfFiles={9} maxFileSize={10485760}
                      allowedFileTypes={["image/*"]}
                      onGetUploadParameters={handleGetUploadParameters} onComplete={handleImageUploadComplete}
                      buttonClassName="inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-md text-xs font-medium h-7 px-3 border border-input bg-background hover:bg-accent hover:text-accent-foreground">
                      <Upload className="h-3 w-3 mr-1" />上传图片
                    </ObjectUploader>
                  </div>
                  {form.imageUrls.length > 0 && (
                    <div className="grid grid-cols-3 gap-2">
                      {form.imageUrls.map((url, i) => (
                        <div key={i} className="relative group aspect-square rounded-lg overflow-hidden border bg-muted">
                          <img src={url} alt={`配图 ${i + 1}`} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                          <button onClick={() => { setForm((p) => ({ ...p, imageUrls: p.imageUrls.filter((_, j) => j !== i) })); setContentSaved(false); }}
                            className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"><X className="h-3 w-3" /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5">
                      <Video className="h-3.5 w-3.5 text-blue-500" />
                      团队视频素材
                      <span className="text-[10px] text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded">鹿联团队每周提供</span>
                    </Label>
                    {!form.videoUrl && (
                      <ObjectUploader maxNumberOfFiles={1} maxFileSize={104857600}
                        allowedFileTypes={["video/*"]}
                        onGetUploadParameters={handleGetUploadParameters} onComplete={handleVideoUploadComplete}
                        buttonClassName="inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-md text-xs font-medium h-7 px-3 border border-input bg-background hover:bg-accent hover:text-accent-foreground">
                        <Video className="h-3 w-3 mr-1" />上传视频
                      </ObjectUploader>
                    )}
                  </div>
                  {form.videoUrl && (
                    <div className="relative group rounded-lg overflow-hidden border bg-muted">
                      <video src={form.videoUrl} controls className="w-full max-h-48 object-contain" />
                      <button onClick={() => { setForm((p) => ({ ...p, videoUrl: "" })); setContentSaved(false); }}
                        className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"><X className="h-3 w-3" /></button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            {/* Live Preview Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Eye className="h-4 w-4 text-red-500" /> 笔记预览</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
                  {form.imageUrls.length > 0 && (
                    <div className="aspect-[4/3] bg-muted overflow-hidden">
                      <img src={form.imageUrls[0]} alt="封面" className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="p-3 space-y-2">
                    <h3 className="font-bold text-sm leading-tight">{form.title || "未输入标题"}</h3>
                    <p className="text-xs text-gray-700 whitespace-pre-wrap line-clamp-4">{form.body || "未输入正文"}</p>
                    {form.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {form.tags.slice(0, 5).map((t) => (<span key={t} className="text-[10px] text-red-500">#{t}</span>))}
                      </div>
                    )}
                    <div className="flex items-center gap-2 pt-2 border-t">
                      <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-[10px] font-medium">
                        {selectedAccount()?.nickname?.[0] || "?"}
                      </div>
                      <span className="text-[10px] text-gray-500">{selectedAccount()?.nickname || "未选择账号"}</span>
                    </div>
                  </div>
                </div>
                {form.imageUrls.length > 1 && (
                  <div className="mt-3">
                    <p className="text-[10px] text-muted-foreground mb-1">全部配图 ({form.imageUrls.length}张)</p>
                    <div className="grid grid-cols-4 gap-1">
                      {form.imageUrls.map((url, i) => (
                        <div key={i} className="aspect-square rounded overflow-hidden border bg-muted">
                          <img src={url} alt={`配图 ${i + 1}`} className="w-full h-full object-cover" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Content Stats */}
            <Card>
              <CardContent className="pt-4">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="p-2 rounded-lg bg-muted"><p className="text-muted-foreground text-[10px]">标题</p><p className="text-base font-bold">{form.title.length}字</p></div>
                  <div className="p-2 rounded-lg bg-muted"><p className="text-muted-foreground text-[10px]">正文</p><p className="text-base font-bold">{form.body.length}字</p></div>
                  <div className="p-2 rounded-lg bg-muted"><p className="text-muted-foreground text-[10px]">标签</p><p className="text-base font-bold">{form.tags.length}个</p></div>
                  <div className="p-2 rounded-lg bg-muted"><p className="text-muted-foreground text-[10px]">配图</p><p className="text-base font-bold">{form.imageUrls.length}张</p></div>
                </div>
                {form.title.length > 20 && <p className="text-[10px] text-amber-600 mt-2">提示：标题超过20字可能影响展示效果</p>}
                {form.body.length < 50 && form.body.length > 0 && <p className="text-[10px] text-amber-600 mt-1">提示：正文建议至少50字</p>}
                {form.imageUrls.length === 0 && <p className="text-[10px] text-amber-600 mt-1">提示：建议添加至少1张配图</p>}
              </CardContent>
            </Card>

            {/* AI Tools */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4" /> AI工具</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button variant="outline" className="w-full justify-start" disabled={rewriteMutation.isPending} onClick={handleRewrite}>
                  {rewriteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Wand2 className="h-4 w-4 mr-2" />}
                  AI智能改写
                </Button>
                <Button variant="outline" className="w-full justify-start"
                  disabled={sensitivityMutation.isPending || !form.body.trim()}
                  onClick={() => sensitivityMutation.mutate({ title: form.title, body: form.body })}>
                  {sensitivityMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                  敏感词检测
                </Button>
              </CardContent>
            </Card>

            {/* AI Image Generation - Enhanced with Reference Mode */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><ImagePlus className="h-4 w-4" /> AI配图</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-1 bg-muted rounded-lg p-1">
                  <button
                    onClick={() => setImageMode("generate")}
                    className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${imageMode === "generate" ? "bg-white shadow-sm font-medium" : "text-muted-foreground"}`}
                  >
                    文字生成配图
                  </button>
                  <button
                    onClick={() => setImageMode("reference")}
                    className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${imageMode === "reference" ? "bg-white shadow-sm font-medium" : "text-muted-foreground"}`}
                  >
                    参考图伪原创
                  </button>
                </div>

                {imageMode === "reference" && (
                  <div className="space-y-2">
                    <div className="p-2.5 rounded-lg bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200">
                      <div className="flex items-start gap-2">
                        <RefreshCw className="h-4 w-4 text-purple-500 mt-0.5 shrink-0" />
                        <p className="text-xs text-purple-700">上传竞品/爆款图片作为参考，AI将模仿其风格创作全新配图，既保持爆款视觉效果，又确保原创性。</p>
                      </div>
                    </div>
                    {referenceImageUrl ? (
                      <div className="relative group">
                        <img src={referenceImageUrl} alt="参考图" className="w-full h-32 object-cover rounded-lg border" />
                        <button onClick={() => setReferenceImageUrl("")}
                          className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <X className="h-3 w-3" />
                        </button>
                        <div className="absolute bottom-1 left-1">
                          <Badge className="bg-purple-500 text-white text-[10px]">参考图</Badge>
                        </div>
                      </div>
                    ) : (
                      <ObjectUploader maxNumberOfFiles={1} maxFileSize={10485760}
                        allowedFileTypes={["image/*"]}
                        onGetUploadParameters={handleGetUploadParameters} onComplete={handleRefImageUploadComplete}
                        buttonClassName="w-full inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-lg text-xs font-medium h-20 px-3 border-2 border-dashed border-purple-300 bg-purple-50/50 text-purple-600 hover:bg-purple-100 hover:border-purple-400 transition-colors">
                        <Upload className="h-4 w-4 mr-1" />上传参考图片（爆款/竞品截图）
                      </ObjectUploader>
                    )}
                  </div>
                )}

                <Textarea value={imagePrompt} onChange={(e) => setImagePrompt(e.target.value)}
                  placeholder={imageMode === "reference" ? "描述你想要的变化方向，如：换成粉色系配色、加上美食元素..." : "描述你想要的配图..."}
                  rows={3} className="text-sm" />
                <Select value={imageSize} onValueChange={setImageSize}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1024x1536">竖版 9:16（推荐）</SelectItem>
                    <SelectItem value="1024x1024">正方形 1:1</SelectItem>
                    <SelectItem value="1536x1024">横版 16:9</SelectItem>
                  </SelectContent>
                </Select>
                <Button className="w-full bg-red-500 hover:bg-red-600 text-white"
                  disabled={isImageGenerating || !imagePrompt.trim() || (imageMode === "reference" && !referenceImageUrl)}
                  onClick={handleGenerateOrEditImage}>
                  {isImageGenerating ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" />生成中...</>
                  ) : imageMode === "reference" ? (
                    <><RefreshCw className="h-4 w-4 mr-2" />参考图伪原创</>
                  ) : (
                    <><ImagePlus className="h-4 w-4 mr-2" />生成配图</>
                  )}
                </Button>
              </CardContent>
            </Card>

            {aiResult && (
              <Card className="border-primary/50">
                <CardHeader><CardTitle className="text-base">AI改写结果</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div><Label className="text-xs text-muted-foreground">标题</Label><p className="text-sm font-medium">{aiResult.rewrittenTitle}</p></div>
                  <div><Label className="text-xs text-muted-foreground">正文</Label><p className="text-sm whitespace-pre-wrap max-h-48 overflow-auto">{aiResult.rewrittenBody}</p></div>
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
                    <span className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4" /> 安全检查
                    </span>
                    <Badge variant={sensitivityResult.score > 50 ? "destructive" : "default"}>风险分: {sensitivityResult.score}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className={`p-2 rounded-lg flex items-center gap-2 text-sm ${sensitivityResult.score > 50 ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
                    {sensitivityResult.score > 50 ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                    <span className="font-medium">{sensitivityResult.score > 50 ? "发现潜在风险" : "内容安全"}</span>
                  </div>
                  {sensitivityResult.issues?.length > 0 && (
                    <div className="space-y-1.5">
                      {sensitivityResult.issues.map((issue: any, i: number) => (
                        <div key={i} className="text-xs p-2 rounded bg-muted">
                          <Badge variant={issue.severity === "high" ? "destructive" : "secondary"} className="text-[10px] mr-1">
                            {issue.severity === "high" ? "高" : issue.severity === "medium" ? "中" : "低"}</Badge>
                          <span className="font-medium">"{issue.word}"</span>
                          {issue.suggestion && <p className="text-[10px] mt-1 text-muted-foreground">建议: {issue.suggestion}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                  {sensitivityResult.issues?.length === 0 && <p className="text-xs text-green-600">未发现敏感词问题</p>}
                  {sensitivityResult.suggestion && <p className="text-[10px] text-muted-foreground">{sensitivityResult.suggestion}</p>}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* Step 3: Publish */}
      {step === 3 && (
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Posting Time Recommendation */}
          {researchResult?.analysis?.bestPostingTimes?.length > 0 && (
            <Card className="border-purple-200 bg-gradient-to-r from-purple-50 to-blue-50">
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
                    <Clock className="h-5 w-5 text-purple-500" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-purple-800 mb-1">AI推荐发布时间</p>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {researchResult.analysis.bestPostingTimes.map((time: string, i: number) => (
                        <Badge key={i} className="bg-purple-100 text-purple-700 border border-purple-200">{time}</Badge>
                      ))}
                    </div>
                    {researchResult.analysis?.postingTimeReason && (
                      <p className="text-xs text-purple-600">{researchResult.analysis.postingTimeReason}</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Image & Video Download Section */}
          {(form.imageUrls.length > 0 || form.videoUrl) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Download className="h-5 w-5 text-blue-500" />
                    下载素材
                  </span>
                  {form.imageUrls.length > 1 && (
                    <Button size="sm" variant="outline" onClick={handleDownloadAllImages}>
                      <Download className="h-3.5 w-3.5 mr-1.5" />
                      下载全部图片 ({form.imageUrls.length})
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                  <div className="flex items-start gap-2">
                    <Lightbulb className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-700">
                      小红书创作中心不支持直接粘贴图片/视频，请先下载素材到手机/电脑，然后在创作中心手动上传。
                    </p>
                  </div>
                </div>

                {form.imageUrls.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
                      <ImageIcon className="h-4 w-4 text-green-500" />
                      配图素材 ({form.imageUrls.length}张)
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                      {form.imageUrls.map((url, i) => (
                        <div key={i} className="relative group">
                          <div className="aspect-square rounded-lg overflow-hidden border bg-muted">
                            <img src={url} alt={`配图 ${i + 1}`} className="w-full h-full object-cover" />
                          </div>
                          <button
                            onClick={() => handleDownloadImage(url, i)}
                            className="absolute inset-0 bg-black/40 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <div className="bg-white rounded-full p-2 shadow-lg">
                              <Download className="h-4 w-4 text-gray-700" />
                            </div>
                          </button>
                          <div className="absolute top-1 left-1">
                            <Badge className="bg-black/60 text-white text-[10px] h-5">{i + 1}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {form.videoUrl && (
                  <div>
                    <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
                      <Video className="h-4 w-4 text-blue-500" />
                      视频素材
                    </p>
                    <div className="rounded-lg overflow-hidden border bg-muted">
                      <video src={form.videoUrl} controls className="w-full max-h-48 object-contain" />
                    </div>
                    <Button size="sm" variant="outline" className="mt-2 w-full" onClick={handleDownloadVideo}>
                      <Download className="h-3.5 w-3.5 mr-1.5" />下载视频
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Publish Steps */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Send className="h-5 w-5 text-red-500" />发布到小红书</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className={`flex items-start gap-4 p-4 rounded-xl border-2 transition-colors ${publishStep !== "ready" ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${publishStep !== "ready" ? "bg-green-500 text-white" : "bg-red-500 text-white"}`}>
                    {publishStep !== "ready" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{publishStep !== "ready" ? "文字内容已复制到剪贴板 ✓" : "正在复制内容..."}</p>
                    <p className="text-sm text-muted-foreground mt-1">标题、正文和标签已自动复制，在创作中心直接粘贴即可</p>
                    {publishStep === "ready" && (
                      <Button className="mt-3 bg-red-500 hover:bg-red-600 text-white" size="sm" onClick={handleCopyContent}>
                        <Copy className="h-4 w-4 mr-2" />手动复制
                      </Button>
                    )}
                  </div>
                </div>

                {(form.imageUrls.length > 0 || form.videoUrl) && (
                  <div className="flex items-start gap-4 p-4 rounded-xl border-2 border-blue-200 bg-blue-50">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-blue-500 text-white">
                      <Download className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-blue-800">下载图片/视频素材</p>
                      <p className="text-sm text-blue-600 mt-1">
                        请先用上方的下载按钮保存{form.imageUrls.length > 0 ? ` ${form.imageUrls.length}张图片` : ""}
                        {form.videoUrl ? (form.imageUrls.length > 0 ? "和视频" : "视频") : ""}
                        到本地，然后在创作中心手动上传
                      </p>
                    </div>
                  </div>
                )}

                <div className={`flex items-start gap-4 p-4 rounded-xl border-2 transition-colors ${publishStep === "opened" ? "border-green-200 bg-green-50" : "border-border"}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${publishStep === "opened" ? "bg-green-500 text-white" : publishStep === "copied" ? "bg-red-500 text-white" : "bg-muted text-muted-foreground"}`}>
                    {publishStep === "opened" ? <Check className="h-4 w-4" /> : <ExternalLink className="h-4 w-4" />}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">打开小红书创作中心</p>
                    <p className="text-sm text-muted-foreground mt-1">在创作中心粘贴文字 → 上传图片/视频 → 发布</p>
                    <Button className="mt-3 bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 text-white" onClick={handleOpenXHS}>
                      <ExternalLink className="h-4 w-4 mr-2" />打开小红书创作中心
                    </Button>
                  </div>
                </div>

                <div className={`flex items-start gap-4 p-4 rounded-xl border-2 transition-colors ${publishMutation.isSuccess ? "border-green-200 bg-green-50" : "border-border"}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${publishMutation.isSuccess ? "bg-green-500 text-white" : publishStep === "opened" ? "bg-red-500 text-white" : "bg-muted text-muted-foreground"}`}>
                    {publishMutation.isSuccess ? <Check className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">标记为已发布</p>
                    <p className="text-sm text-muted-foreground mt-1">在小红书发布成功后，点击更新状态</p>
                    <Button className="mt-3" variant={publishMutation.isSuccess ? "outline" : publishStep === "opened" ? "default" : "outline"}
                      disabled={publishMutation.isPending || publishMutation.isSuccess || !savedContentId} onClick={handleMarkPublished}>
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
                    <Button variant="outline" onClick={handleReset}>发布下一篇</Button>
                    <Button onClick={() => setLocation("/content")}>查看所有内容</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">发布内容预览</CardTitle></CardHeader>
            <CardContent>
              <div className="bg-muted rounded-lg p-4 text-sm whitespace-pre-wrap font-mono max-h-64 overflow-auto">
                {buildPublishContent()}
              </div>
              <Button variant="outline" size="sm" className="mt-3" onClick={handleCopyContent}>
                <Copy className="h-3.5 w-3.5 mr-1.5" />
                {copied ? "已复制 ✓" : "重新复制"}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Navigation Footer */}
      <div className="flex items-center justify-between pt-4 border-t">
        <Button variant="outline" onClick={() => step > 1 ? setStep(step - 1) : setLocation("/dashboard")}>
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
          {step === 1 && (
            <Button onClick={() => { setStep(2); }} variant="outline" className="text-muted-foreground">
              跳过，直接创作<ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          )}
          {step < 3 && step !== 1 && (
            <Button onClick={handleNext} disabled={!canProceed()} className="bg-red-500 hover:bg-red-600 text-white">
              {step === 2 ? "去发布" : "下一步"}<ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
