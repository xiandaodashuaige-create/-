import { useState, useEffect, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ObjectUploader } from "@workspace/object-storage-web";
import InsufficientCreditsDialog from "@/components/InsufficientCreditsDialog";
import { AssistantChat } from "@/components/AssistantChat";
import {
  Check, ChevronRight, ChevronLeft, FileText, Send,
  Wand2, ShieldCheck, Hash, Type, Loader2, Sparkles, ImagePlus,
  Upload, X, Copy, ExternalLink, Globe, CheckCircle2, AlertTriangle,
  Search, Target, Lightbulb, RotateCcw, Zap, TrendingUp,
  Video, Eye, Download, Clock, Image as ImageIcon, RefreshCw
} from "lucide-react";
import { PLATFORM_LIST } from "@/lib/platform-meta";

const STEPS = [
  { id: 1, label: "内容策略", icon: Search, desc: "选择地区、AI分析同行内容策略和发布时间" },
  { id: 2, label: "生成内容", icon: FileText, desc: "AI生成原创内容、配图、自动安全检查" },
  { id: 3, label: "发布", icon: Send, desc: "按AI推荐时间，下载素材+复制内容，发布到小红书" },
];

const regionLabels: Record<string, string> = { SG: "🇸🇬 新加坡", HK: "🇭🇰 香港", MY: "🇲🇾 马来西亚" };

function proxyXhsImage(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (url.includes("/api/xhs/image-proxy")) return url;
  if (url.includes("xhscdn.com") || url.includes("xiaohongshu.com") || url.includes("sns-webpic") || url.includes("sns-img") || url.includes("sns-na-")) {
    const base = import.meta.env.BASE_URL || "/";
    const normalizedUrl = url.startsWith("//") ? `https:${url}` : url;
    return `${base}api/xhs/image-proxy?url=${encodeURIComponent(normalizedUrl)}`;
  }
  return url;
}

interface AiProgressStep {
  label: string;
  status: "pending" | "running" | "done";
}

export default function WorkflowWizard() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [step, setStep] = useState(1);

  const [selectedRegion, setSelectedRegion] = useState<string>("");
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
  const [showProfilePeek, setShowProfilePeek] = useState(false);
  const [profileData, setProfileData] = useState<any>(null);

  useEffect(() => {
    if (showProfilePeek && !profileData) {
      api.ai.myContentProfile().then(setProfileData).catch(() => setProfileData({ sampleSize: 0 }));
    }
  }, [showProfilePeek, profileData]);

  
  const [aiResult, setAiResult] = useState<any>(null);
  const [sensitivityResult, setSensitivityResult] = useState<any>(null);
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageSize, setImageSize] = useState("1024x1536");
  const [referenceImageUrl, setReferenceImageUrl] = useState("");
  const [imageMode, setImageMode] = useState<"generate" | "reference">("generate");
  const [layoutMode, setLayoutMode] = useState<"single" | "dual-vertical" | "dual-horizontal" | "grid-2x2" | "left-big-right-small">("single");
  const [mimicStrength, setMimicStrength] = useState<"full" | "partial" | "minimal">("partial");
  const [lastPipelineResult, setLastPipelineResult] = useState<{
    imageUrl: string;
    referenceId: number | null;
    promptUsed: string;
    textOverlays: Array<{ text: string; position: string; style?: string }>;
    emojis: string[];
  } | null>(null);
  const [customTextOverlays, setCustomTextOverlays] = useState<Array<{ text: string; position: string; style?: string }> | null>(null);
  const [customEmojis, setCustomEmojis] = useState<string[] | null>(null);
  const [extraInstructions, setExtraInstructions] = useState<string>("");
  const [contentSaved, setContentSaved] = useState(false);
  const [savedContentId, setSavedContentId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [publishStep, setPublishStep] = useState<"ready" | "copied" | "opened">("ready");
  const [publishedNoteUrl, setPublishedNoteUrl] = useState("");
  const [autoTrackingId, setAutoTrackingId] = useState<number | null>(null);
  const [autoTrackingError, setAutoTrackingError] = useState<string>("");
  const [editMode, setEditMode] = useState(false);

  const [aiProgress, setAiProgress] = useState<{ active: boolean; steps: AiProgressStep[] }>({
    active: false,
    steps: [],
  });

  const [creditDialog, setCreditDialog] = useState<{ open: boolean; current?: number; required?: number }>({ open: false });

  function handleCreditError(e: any) {
    if (e?.status === 403 && (e?.current !== undefined || e?.required !== undefined)) {
      setCreditDialog({ open: true, current: e.current, required: e.required });
    } else {
      toast({ title: e.message || "操作失败", variant: "destructive" });
    }
  }

  const researchMutation = useMutation({
    mutationFn: (data: any) => api.ai.competitorResearch(data),
    onSuccess: (result) => {
      setResearchResult(result);
      setSelectedSuggestion(null);
      toast({ title: "内容策略分析完成！已生成3套原创方案" });
    },
    onError: (e: any) => handleCreditError(e),
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
    onError: (e: any) => handleCreditError(e),
  });

  const sensitivityMutation = useMutation({
    mutationFn: (data: any) => api.ai.checkSensitivity(data),
    onSuccess: (result) => setSensitivityResult(result),
    onError: (e: any) => handleCreditError(e),
  });

  const titleMutation = useMutation({ mutationFn: (data: any) => api.ai.generateTitle(data), onError: (e: any) => handleCreditError(e) });
  const hashtagMutation = useMutation({ mutationFn: (data: any) => api.ai.generateHashtags(data), onError: (e: any) => handleCreditError(e) });

  const imageMutation = useMutation({
    mutationFn: (data: { prompt: string; style?: string; size?: string }) => api.ai.generateImage(data),
    onSuccess: (result) => {
      const url = result.storedUrl || result.imageUrl;
      setForm((prev) => ({ ...prev, imageUrls: [...prev.imageUrls, url] }));
      toast({ title: "AI配图生成成功" });
    },
    onError: (e: any) => handleCreditError(e),
  });

  const editImageMutation = useMutation({
    mutationFn: (data: { prompt: string; referenceImageUrl: string; size?: string }) => api.ai.editImage(data),
    onSuccess: (result) => {
      const url = result.storedUrl || result.imageUrl;
      setForm((prev) => ({ ...prev, imageUrls: [...prev.imageUrls, url] }));
      toast({ title: "参考图伪原创成功！" });
    },
    onError: (e: any) => handleCreditError(e),
  });

  const pipelineImageMutation = useMutation({
    mutationFn: (data: Parameters<typeof api.ai.generateImagePipeline>[0]) => api.ai.generateImagePipeline(data),
    onSuccess: (result) => {
      const url = result.storedUrl || result.imageUrl;
      setForm((prev) => ({ ...prev, imageUrls: [...prev.imageUrls, url] }));
      setLastPipelineResult({
        imageUrl: url,
        referenceId: result.referenceId ?? null,
        promptUsed: result.promptUsed,
        textOverlays: result.textOverlays || [],
        emojis: result.emojis || [],
      });
      toast({
        title: "爆款封面生成成功！",
        description: `引擎: ${result.provider}${result.styleProfileUsed ? "（已应用你的历史风格档案）" : ""}`,
      });
    },
    onError: (e: any) => handleCreditError(e),
  });

  const feedbackMutation = useMutation({
    mutationFn: (data: { referenceId: number; accepted: boolean }) => api.ai.imageFeedback(data),
    onSuccess: (_, vars) => {
      toast({
        title: vars.accepted ? "已采用，谢谢反馈！" : "已记录",
        description: vars.accepted ? "系统会从这张图学习你的风格偏好，下次出图更懂你 ✨" : "下次会更努力",
      });
    },
  });

  const publishMutation = useMutation({
    mutationFn: (id: number) => api.content.publish(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["content"] });
      toast({ title: "内容已标记为已发布" });
      // 只有发布成功后才尝试追踪（用户粘了链接才触发；失败静默不阻塞流程）
      const url = publishedNoteUrl.trim();
      if (url && /xhslink\.com|xiaohongshu\.com/.test(url)) {
        autoTrackMutation.mutate({ xhsUrl: url });
      }
    },
  });

  // 自动追踪：发布成功 + 用户粘了链接，就静默后台创建追踪记录
  const autoTrackMutation = useMutation({
    mutationFn: (data: { xhsUrl: string }) => {
      const kws = [
        researchInput.niche,
        ...(form.tags || []),
        ...((researchResult?.analysis?.popularAngles as string[] | undefined) || []),
      ]
        .map((k) => String(k || "").trim())
        .filter(Boolean)
        .slice(0, 5);
      return api.tracking.create({
        xhsUrl: data.xhsUrl,
        title: form.title,
        targetKeywords: kws,
        contentId: savedContentId ?? undefined,
        accountId: form.accountId ?? undefined,
      });
    },
    onSuccess: (row: any) => {
      setAutoTrackingId(row?.id ?? null);
      setAutoTrackingError("");
      qc.invalidateQueries({ queryKey: ["tracking"] });
    },
    onError: (e: any) => {
      setAutoTrackingError(e?.message || "无法解析这个链接");
    },
  });

  // 灵感 step1：根据 niche+region 自动拉热点话题（debounce）
  const niche = researchInput.niche.trim();
  const { data: hotTopicsData } = useQuery({
    queryKey: ["hot-topics-inline", niche, selectedRegion],
    queryFn: () =>
      api.tracking.hotTopics({
        niche,
        region: selectedRegion || undefined,
      }),
    enabled: niche.length >= 2 && !!selectedRegion,
    staleTime: 30 * 60 * 1000,
  });
  const hotTopics: string[] = (hotTopicsData?.topics || []).slice(0, 8);

  function canProceed(): boolean {
    switch (step) {
      case 1: return !!selectedRegion;
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
    if (!selectedRegion) {
      toast({ title: "请先选择目标地区", description: "AI需要根据地区定制内容策略和爆款分析", variant: "destructive" });
      return;
    }
    if (!businessDescription.trim() && !competitorLink.trim() && !niche.trim()) {
      toast({ title: "请至少填写一项信息", variant: "destructive" });
      return;
    }
    researchMutation.mutate({
      businessDescription: businessDescription || undefined,
      competitorLink: competitorLink || undefined,
      niche: niche || undefined,
      region: selectedRegion,
    });
  }

  const runAiProgressSequence = useCallback(async (suggestion: any) => {
    const steps: AiProgressStep[] = [
      { label: "正在应用内容方案...", status: "running" },
      { label: "AI正在优化文案...", status: "pending" },
      { label: "安全检查与自动修复...", status: "pending" },
      { label: "AI正在生成爆款配图...", status: "pending" },
    ];
    setAiProgress({ active: true, steps: [...steps] });

    await new Promise(r => setTimeout(r, 600));
    steps[0].status = "done";
    steps[1].status = "running";
    setAiProgress({ active: true, steps: [...steps] });

    let currentTitle = suggestion.title;
    let currentBody = suggestion.body;
    let currentTags = suggestion.tags || [];

    setForm((prev) => ({
      ...prev,
      title: currentTitle,
      body: currentBody,
      tags: currentTags,
    }));

    await new Promise(r => setTimeout(r, 400));
    steps[1].status = "done";
    steps[2].status = "running";
    setAiProgress({ active: true, steps: [...steps] });

    try {
      const sensitivityRes = await api.ai.checkSensitivity({ title: currentTitle, body: currentBody });
      const hasIssues = sensitivityRes.issues && sensitivityRes.issues.length > 0;
      if (hasIssues) {
        const issueList = sensitivityRes.issues.map((i: any) => `"${i.word}" → ${i.suggestion || "删除"}`).join("；");
        try {
          const fixResult = await api.ai.rewrite({
            originalContent: `标题：${currentTitle}\n\n${currentBody}`,
            region: selectedRegion || undefined,
            style: "creative",
            additionalInstructions: `必须修复以下敏感词问题，替换或删除所有违规表达：${issueList}。保持内容核心信息不变，只修复问题部分。`,
          });
          if (fixResult.rewrittenTitle) currentTitle = fixResult.rewrittenTitle;
          if (fixResult.rewrittenBody) currentBody = fixResult.rewrittenBody;
          if (fixResult.suggestedTags?.length) currentTags = [...new Set([...currentTags, ...fixResult.suggestedTags])];
          setForm((prev) => ({ ...prev, title: currentTitle, body: currentBody, tags: currentTags }));
        } catch {}
        const recheck = await api.ai.checkSensitivity({ title: currentTitle, body: currentBody });
        setSensitivityResult(recheck);
      } else {
        setSensitivityResult(sensitivityRes);
      }
    } catch (err: any) {
      if (err?.status === 403) { handleCreditError(err); }
    }

    steps[2].status = "done";
    steps[3].status = "running";
    setAiProgress({ active: true, steps: [...steps] });

    const competitorCovers = (researchResult?.competitorNotes || [])
      .filter((n: any) => n.cover_url)
      .sort((a: any, b: any) => (b.liked_count || 0) - (a.liked_count || 0));

    if (competitorCovers.length > 0) {
      setReferenceImageUrl(proxyXhsImage(competitorCovers[0].cover_url) || "");
    }

    if (suggestion.imagePrompt) {
      const topNotes = competitorCovers.slice(0, 3);
      const topCover = topNotes[0];

      try {
        if (topCover?.cover_url) {
          // 真·参考爆款封面：用 pipeline 让 AI 先视觉分析爆款封面，再生成同风格原创图
          const proxiedRef = proxyXhsImage(topCover.cover_url);
          if (proxiedRef) {
            setImagePrompt(`参考爆款《${topCover.title}》的封面视觉风格 → ${suggestion.imagePrompt}`);
            const pipelineRes = await api.ai.generateImagePipeline({
              referenceImageUrl: proxiedRef,
              newTopic: suggestion.title || form.title || "小红书内容",
              newTitle: suggestion.title,
              mimicStrength: "partial",
              extraInstructions: suggestion.imagePrompt,
              size: "1024x1536",
            });
            const url = pipelineRes.storedUrl || pipelineRes.imageUrl;
            if (url) {
              setForm((prev) => ({ ...prev, imageUrls: [...prev.imageUrls, url] }));
            }
          }
        } else {
          // 没拿到封面就退回纯文字 prompt
          const styleHints = topNotes.map((n: any) => n.title).filter(Boolean).join("、");
          const enhancedPrompt = styleHints
            ? `${suggestion.imagePrompt}。参考同行爆款笔记的封面风格特点（${styleHints}），生成类似风格但全新原创的配图。要求：小红书爆款封面风格，精美、高级感、吸引眼球、适合社交媒体展示。`
            : suggestion.imagePrompt;
          setImagePrompt(enhancedPrompt);
          const imageRes = await api.ai.generateImage({ prompt: enhancedPrompt, size: "1024x1536" });
          const url = imageRes.storedUrl || imageRes.imageUrl;
          if (url) {
            setForm((prev) => ({ ...prev, imageUrls: [...prev.imageUrls, url] }));
          }
        }
      } catch (err: any) {
        if (err?.status === 403) { handleCreditError(err); }
        else { toast({ title: "配图生成暂时不可用，可在编辑页手动重新生成", variant: "destructive" }); }
      }
    }

    steps[3].status = "done";
    setAiProgress({ active: true, steps: [...steps] });

    await new Promise(r => setTimeout(r, 500));
    setAiProgress({ active: false, steps: [] });
    setContentSaved(false);
    setStep(2);
  }, [selectedRegion, researchResult]);

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
    rewriteMutation.mutate({
      originalContent: form.originalReference || form.body,
      region: selectedRegion || undefined,
      style: "creative",
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
    setForm({ accountId: 0, title: "", body: "", originalReference: "", tags: [] as string[], tagInput: "", imageUrls: [] as string[], videoUrl: "" });
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

  function handleGenerateOrEditImage(overrides?: {
    layoutMode?: typeof layoutMode;
    mimicStrength?: typeof mimicStrength;
    customTextOverlays?: Array<{ text: string; position: string; style?: string }> | null;
    customEmojis?: string[] | null;
    extraInstructions?: string;
  }) {
    if (referenceImageUrl) {
      const finalLayout = overrides?.layoutMode ?? layoutMode;
      const finalStrength = overrides?.mimicStrength ?? mimicStrength;
      const finalOverlays = overrides?.customTextOverlays !== undefined ? overrides.customTextOverlays : customTextOverlays;
      const finalEmojis = overrides?.customEmojis !== undefined ? overrides.customEmojis : customEmojis;
      const finalExtra = overrides?.extraInstructions ?? extraInstructions;
      pipelineImageMutation.mutate({
        referenceImageUrl,
        newTopic: imagePrompt || form.title || "小红书内容",
        newTitle: form.title || undefined,
        newKeyPoints: form.tags?.length ? form.tags : undefined,
        mimicStrength: finalStrength,
        size: imageSize,
        layoutMode: finalLayout,
        customTextOverlays: finalOverlays || undefined,
        customEmojis: finalEmojis || undefined,
        extraInstructions: finalExtra || undefined,
      } as any);
    } else {
      imageMutation.mutate({ prompt: imagePrompt, size: imageSize });
    }
  }

  function handleAssistantApply(changes: {
    layout?: typeof layoutMode;
    mimicStrength?: typeof mimicStrength;
    textOverlays?: Array<{ text: string; position: string; style?: string }>;
    emojis?: string[];
    extraInstructions?: string;
    triggerRegenerate: boolean;
  }) {
    // Update state for UI consistency
    if (changes.layout) setLayoutMode(changes.layout);
    if (changes.mimicStrength) setMimicStrength(changes.mimicStrength);
    if (changes.textOverlays) setCustomTextOverlays(changes.textOverlays);
    if (changes.emojis) setCustomEmojis(changes.emojis);
    if (changes.extraInstructions) setExtraInstructions(changes.extraInstructions);
    // Regenerate using EXPLICIT merged config (avoid stale-state race)
    if (changes.triggerRegenerate && referenceImageUrl) {
      handleGenerateOrEditImage({
        layoutMode: changes.layout,
        mimicStrength: changes.mimicStrength,
        customTextOverlays: changes.textOverlays,
        customEmojis: changes.emojis,
        extraInstructions: changes.extraInstructions,
      });
      // Clear one-shot extraInstructions after firing
      if (changes.extraInstructions) setTimeout(() => setExtraInstructions(""), 200);
    }
  }

  function handleAssistantFeedback(accepted: boolean) {
    if (!lastPipelineResult?.referenceId) return;
    feedbackMutation.mutate({ referenceId: lastPipelineResult.referenceId, accepted });
  }

  const hasResearchInput = researchInput.businessDescription.trim() || researchInput.competitorLink.trim() || researchInput.niche.trim();
  const isImageGenerating = imageMutation.isPending || editImageMutation.isPending || pipelineImageMutation.isPending;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">创建并发布笔记</h1>
        <p className="text-muted-foreground">AI内容策略 → 生成原创内容 → 轻松发布</p>
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
          {/* Region Selector */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Globe className="h-4 w-4 text-red-500" />
                选择目标地区
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">AI将根据目标地区定制内容风格和发布策略</p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { code: "SG", flag: "🇸🇬", name: "新加坡", desc: "东南亚华人市场" },
                  { code: "HK", flag: "🇭🇰", name: "香港", desc: "繁體中文·港式表达" },
                  { code: "MY", flag: "🇲🇾", name: "马来西亚", desc: "多元文化市场" },
                ].map((r) => (
                  <button
                    key={r.code}
                    onClick={() => {
                      setSelectedRegion(r.code);
                      
                    }}
                    className={`relative flex flex-col items-center gap-1.5 p-4 rounded-xl border-2 transition-all ${
                      selectedRegion === r.code
                        ? "border-red-500 bg-red-50 shadow-sm"
                        : "border-border hover:border-red-200 hover:bg-red-50/30"
                    }`}
                  >
                    <span className="text-2xl">{r.flag}</span>
                    <span className="font-semibold text-sm">{r.name}</span>
                    <span className="text-[10px] text-muted-foreground">{r.desc}</span>
                    {selectedRegion === r.code && (
                      <div className="absolute top-2 right-2">
                        <CheckCircle2 className="h-4 w-4 text-red-500" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Research Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5 text-red-500" />
                AI内容策略分析
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200">
                <div className="flex items-start gap-3">
                  <Lightbulb className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-amber-800">AI智能分析同行内容策略、热门风格和最佳发布时间</p>
                    <p className="text-amber-600 mt-1">填写以下任意一项，AI将基于行业知识分析同行的内容策略，为你生成3套原创内容方案。</p>
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
                    {hotTopics.length > 0 && (
                      <div className="mt-2 p-3 rounded-lg bg-gradient-to-r from-orange-50 to-rose-50 border border-orange-200">
                        <p className="text-xs font-medium text-orange-700 mb-2 flex items-center gap-1.5">
                          <Sparkles className="h-3.5 w-3.5" />
                          {regionLabels[selectedRegion] || selectedRegion} · {researchInput.niche} 当下热点话题（点击加入业务描述）
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {hotTopics.map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setResearchInput((prev) => ({
                                ...prev,
                                businessDescription: prev.businessDescription
                                  ? `${prev.businessDescription}，关注热点 #${t}`
                                  : `关注热点 #${t}`,
                              }))}
                              className="text-xs px-2 py-1 rounded-full bg-white border border-orange-200 text-orange-700 hover:bg-orange-100 transition-colors"
                            >
                              #{t}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="p-3 rounded-lg bg-muted/50 text-sm">
                    <p className="font-medium mb-2 text-muted-foreground">AI帮你做什么：</p>
                    <div className="space-y-2 text-muted-foreground text-xs">
                      <div className="flex items-start gap-2">
                        <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-0.5"><span className="text-red-500 text-[10px] font-bold">1</span></div>
                        <span>📊 策略分析：分析行业热门内容方向和受众画像</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-0.5"><span className="text-red-500 text-[10px] font-bold">2</span></div>
                        <span>🎨 内容生成：生成小红书风格的原创文案+配图建议</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-0.5"><span className="text-red-500 text-[10px] font-bold">3</span></div>
                        <span>⏰ 发布建议：推荐该地区行业最佳发布时间段</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-0.5"><span className="text-red-500 text-[10px] font-bold">4</span></div>
                        <span>🔒 安全保障：自动检测并修复敏感词，确保内容合规</span>
                      </div>
                    </div>
                  </div>

                  {selectedRegion && (
                    <div className="p-3 rounded-lg bg-muted/50 text-sm flex items-center gap-2" data-selected-account-region={selectedRegion}>
                      <span className="text-muted-foreground">目标地区：</span>
                      <Badge variant="secondary" className="text-xs" data-account-region={selectedRegion}>
                        {regionLabels[selectedRegion] || selectedRegion}
                      </Badge>
                    </div>
                  )}
                </div>
              </div>

              <Button
                onClick={handleResearch}
                disabled={researchMutation.isPending || !hasResearchInput || !selectedRegion}
                className="w-full bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 text-white h-12 text-base"
              >
                {researchMutation.isPending ? (
                  <><Loader2 className="h-5 w-5 animate-spin mr-2" />AI正在分析同行内容策略，请稍候（约10-20秒）...</>
                ) : !selectedRegion ? (
                  <><AlertTriangle className="h-5 w-5 mr-2" />请先选择目标地区</>
                ) : !hasResearchInput ? (
                  <><AlertTriangle className="h-5 w-5 mr-2" />请填写业务描述或行业关键词</>
                ) : (
                  <><Zap className="h-5 w-5 mr-2" />AI分析{regionLabels[selectedRegion]}的同行爆款</>
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
                    AI策略分析报告
                    {researchResult.dataSource === "real-data" ? (
                      <Badge className="bg-green-100 text-green-700 text-[10px] ml-auto">📊 含真实数据</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] ml-auto">AI智能分析</Badge>
                    )}
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
                    <p className="text-xs text-muted-foreground font-medium mb-1">竞品爆款深度分析</p>
                    <p>{researchResult.analysis?.competitorInsights}</p>
                  </div>
                  {researchResult.analysis?.viralPatterns && (
                    <div className="p-3 rounded-lg bg-gradient-to-r from-red-50 to-orange-50 border border-red-200 text-sm">
                      <p className="text-xs text-red-600 font-medium mb-2">爆款模式总结</p>
                      {typeof researchResult.analysis.viralPatterns === "string" ? (
                        <p className="text-red-800 whitespace-pre-wrap">{researchResult.analysis.viralPatterns}</p>
                      ) : Array.isArray(researchResult.analysis.viralPatterns) ? (
                        <ul className="space-y-1.5 text-red-800">
                          {researchResult.analysis.viralPatterns.map((item: any, i: number) => (
                            <li key={i} className="flex gap-2">
                              <span className="text-red-500 font-bold">{i + 1}.</span>
                              <span>{typeof item === "string" ? item : JSON.stringify(item)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : typeof researchResult.analysis.viralPatterns === "object" ? (
                        <div className="space-y-2">
                          {Object.entries(researchResult.analysis.viralPatterns).map(([key, val]: [string, any]) => (
                            <div key={key} className="border-l-2 border-red-300 pl-2.5">
                              <p className="text-red-700 font-semibold text-xs mb-0.5">{key}</p>
                              <div className="text-red-800 text-xs">
                                {typeof val === "string" ? val : Array.isArray(val) ? val.join("；") : Object.entries(val as object).map(([k, v]: [string, any]) => (
                                  <div key={k}><span className="text-red-600">{k}:</span> {typeof v === "string" ? v : JSON.stringify(v)}</div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )}
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

              {/* Personal Profile Applied Banner - 成长能力可视化 */}
              {researchResult.personalProfileApplied && (
                <div className="rounded-xl border border-violet-200 bg-gradient-to-r from-violet-50 to-fuchsia-50 px-4 py-3 flex items-center gap-3">
                  <div className="shrink-0 h-9 w-9 rounded-full bg-violet-100 flex items-center justify-center text-lg">🧬</div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-violet-900">
                      AI 已结合你过往 {researchResult.personalProfileSampleSize} 篇笔记的个人风格生成本次方案
                    </p>
                    <p className="text-xs text-violet-700/80 mt-0.5">
                      标签、开头、字数、emoji 已自动向你的历史偏好靠拢 — 你发的越多，AI 越懂你
                    </p>
                  </div>
                  <button
                    onClick={() => setShowProfilePeek(true)}
                    className="text-xs text-violet-700 underline underline-offset-4 hover:text-violet-900 shrink-0"
                  >
                    查看我的画像
                  </button>
                </div>
              )}
              {!researchResult.personalProfileApplied && researchResult.personalProfileSampleSize !== undefined && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                  💡 你目前已积累 {researchResult.personalProfileSampleSize} 篇笔记，再发布 {Math.max(3 - researchResult.personalProfileSampleSize, 0)} 篇 AI 就会开始学习你的个人风格，下次方案会更贴合你。
                </div>
              )}

              {/* Experience Summary - 经验总结 */}
              {Array.isArray(researchResult.analysis?.experienceSummary) && researchResult.analysis.experienceSummary.length > 0 && (
                <Card className="border-amber-200 bg-amber-50/30">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-amber-600" />
                      AI 提炼的可执行经验
                      <Badge className="bg-amber-100 text-amber-700 text-[10px] ml-auto">
                        共 {researchResult.analysis.experienceSummary.length} 条
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {researchResult.analysis.experienceSummary.map((tip: string, i: number) => (
                        <li key={i} className="flex gap-2 text-sm text-amber-900">
                          <span className="shrink-0 w-5 h-5 rounded-full bg-amber-200 text-amber-900 text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
                          <span className="leading-relaxed">{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Real Competitor Notes Gallery */}
              {researchResult.competitorNotes?.length > 0 && (
                <Card className="border-red-200 bg-red-50/20">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-red-500" />
                      同行爆款笔记（真实数据）
                      <Badge className="bg-red-100 text-red-700 text-[10px] ml-auto">
                        精选Top5 · 共分析{researchResult.competitorNotes.length}篇 · {researchResult.dataSource === "real-data" ? "实时数据" : "AI分析"}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                      {researchResult.competitorNotes
                        .sort((a: any, b: any) => (b.liked_count || 0) - (a.liked_count || 0))
                        .slice(0, 5)
                        .map((note: any, i: number) => (
                        <a
                          key={note.id || i}
                          href={note.note_url || (note.id ? `https://www.xiaohongshu.com/explore/${note.id}` : "#")}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group rounded-xl border bg-white overflow-hidden hover:shadow-md hover:border-red-300 transition-all cursor-pointer block"
                          title="点击在新标签打开小红书原笔记"
                        >
                          {note.cover_url ? (
                            <div className="aspect-[3/4] bg-muted overflow-hidden relative">
                              <img
                                src={proxyXhsImage(note.cover_url)}
                                alt={note.title}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                onError={(e) => {
                                  const el = e.target as HTMLImageElement;
                                  el.style.display = "none";
                                  el.parentElement!.innerHTML = '<div class="w-full h-full flex items-center justify-center text-muted-foreground text-xs">图片加载失败</div>';
                                }}
                              />
                              <div className="absolute top-1.5 right-1.5">
                                <Badge className="bg-black/60 text-white text-[9px] border-0">
                                  ❤️ {note.liked_count >= 10000 ? `${(note.liked_count / 10000).toFixed(1)}万` : note.liked_count}
                                </Badge>
                              </div>
                            </div>
                          ) : (
                            <div className="aspect-[3/4] bg-gradient-to-br from-red-50 to-pink-50 flex items-center justify-center">
                              <ImageIcon className="h-8 w-8 text-red-200" />
                            </div>
                          )}
                          <div className="p-2.5 space-y-1.5">
                            <p className="text-xs font-medium leading-tight line-clamp-2">{note.title || "无标题"}</p>
                            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                              <span className="truncate max-w-[60%]">@{note.author || "匿名"}</span>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span>⭐{note.collected_count || 0}</span>
                                <span>💬{note.comment_count || 0}</span>
                              </div>
                            </div>
                            {note.tags?.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {note.tags.slice(0, 3).map((t: string, ti: number) => (
                                  <span key={ti} className="text-[9px] text-red-400">#{t}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </a>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-3 text-center">
                      以上为该领域点赞最高的精选笔记。AI已深度分析全部{researchResult.competitorNotes.length}篇爆款，提炼爆款模式后为你生成伪原创方案。
                    </p>
                  </CardContent>
                </Card>
              )}

              <div>
                <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-red-500" />
                  选择内容方案
                </h3>
                <p className="text-sm text-muted-foreground mb-4">以下方案由AI基于{researchResult.competitorNotes?.length > 0 ? `${researchResult.competitorNotes.length}篇真实同行爆款` : "行业分析"}生成。点击"采用此方案"，AI自动填充内容、检测并修复敏感词。</p>

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
                        {suggestion.mimicSource && (
                          <div className="text-[11px] text-orange-700 bg-orange-50 rounded px-2 py-1.5 border border-orange-200">
                            <span className="font-medium text-orange-800">伪原创自：</span>{suggestion.mimicSource}
                          </div>
                        )}
                        <div className="text-[11px] text-green-700 bg-green-50 rounded px-2 py-1.5 border border-green-200">
                          <span className="font-medium text-green-800">爆款公式：</span>{suggestion.whyThisWorks}
                        </div>
                        <Button
                          className="w-full bg-red-500 hover:bg-red-600 text-white"
                          size="sm"
                          disabled={aiProgress.active}
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

              <div className="flex justify-center items-center gap-4">
                <Button variant="outline" onClick={handleResearch} disabled={researchMutation.isPending}>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  重新生成方案
                </Button>
                <button className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors underline underline-offset-4" onClick={() => { setStep(2); }}>
                  不用方案，直接编辑
                </button>
              </div>
              <p className="text-center text-xs text-muted-foreground mt-2">
                选择方案后，AI将自动生成完整内容（文案+标签+配图）
              </p>
            </>
          )}

          {!researchResult && !researchMutation.isPending && (
            <div className="text-center py-2">
              <button className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors underline underline-offset-4" onClick={() => { setStep(2); }}>
                我已有现成内容，跳过分析直接编辑
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Review AI Result (preview first, edit if needed) */}
      {step === 2 && !aiProgress.active && (
        <div className="space-y-6">
          {selectedSuggestion !== null && researchResult?.suggestions?.[selectedSuggestion] && (
            <div className="p-3 rounded-xl bg-green-50 border border-green-200 flex items-center gap-3 text-sm">
              <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
              <div className="flex-1">
                <span className="font-medium text-green-800">AI已自动生成完整内容（方案 {selectedSuggestion + 1}）</span>
                <span className="text-green-600 ml-1">— 文案、标签、配图全部就绪</span>
              </div>
            </div>
          )}

          {/* 一稿多发占位（A/B 项目搬入后启用）：让用户提前看到这是全平台爆款矩阵 */}
          <Card className="border-dashed border-orange-200 bg-gradient-to-r from-orange-50/50 to-rose-50/50">
            <CardContent className="py-3">
              <div className="flex items-start gap-3">
                <Sparkles className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-orange-800">
                    同时为以下平台生成
                    <Badge variant="outline" className="ml-2 text-[10px] border-orange-300 text-orange-600">即将开放</Badge>
                  </p>
                  <p className="text-xs text-orange-700/70 mt-0.5">
                    一篇灵感 · 自动适配 4 个平台的格式 / 标题 / Tag 风格 · 全平台数据回流
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {PLATFORM_LIST.map((p) => {
                      const Icon = p.icon;
                      return (
                        <label
                          key={p.id}
                          className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${
                            p.id === "xhs"
                              ? `${p.bgClass} ${p.textClass} ${p.borderClass}`
                              : "bg-white border-dashed text-muted-foreground/60"
                          }`}
                        >
                          <input
                            type="checkbox"
                            disabled
                            checked={p.id === "xhs"}
                            className="h-3 w-3 accent-current"
                          />
                          <Icon className="h-3 w-3" />
                          {p.shortName}
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Large Preview - Primary */}
            <Card className="border-2 border-red-100">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2"><Eye className="h-4 w-4 text-red-500" /> 笔记预览</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
                  {form.imageUrls.length > 0 && (
                    <div className="aspect-[4/3] bg-muted overflow-hidden">
                      <img src={form.imageUrls[0]} alt="封面" className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="p-4 space-y-2.5">
                    <h3 className="font-bold text-base leading-tight">{form.title || "未输入标题"}</h3>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{form.body || "未输入正文"}</p>
                    {form.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {form.tags.map((t) => (<span key={t} className="text-xs text-red-500">#{t}</span>))}
                      </div>
                    )}
                    <div className="flex items-center gap-2 pt-2 border-t">
                      <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-[10px] font-medium">
                        {selectedRegion?.[0] || "?"}
                      </div>
                      <span className="text-[10px] text-gray-500">{selectedRegion ? regionLabels[selectedRegion] : "未选择地区"}</span>
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

            {/* Right side: Stats + Actions + Reference */}
            <div className="space-y-4">
              <Card>
                <CardContent className="pt-4">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="p-2 rounded-lg bg-muted"><p className="text-muted-foreground text-[10px]">标题</p><p className="text-base font-bold">{form.title.length}字</p></div>
                    <div className="p-2 rounded-lg bg-muted"><p className="text-muted-foreground text-[10px]">正文</p><p className="text-base font-bold">{form.body.length}字</p></div>
                    <div className="p-2 rounded-lg bg-muted"><p className="text-muted-foreground text-[10px]">标签</p><p className="text-base font-bold">{form.tags.length}个</p></div>
                    <div className="p-2 rounded-lg bg-muted"><p className="text-muted-foreground text-[10px]">配图</p><p className="text-base font-bold">{form.imageUrls.length}张</p></div>
                  </div>
                  {sensitivityResult && (
                    <div className={`mt-3 p-2 rounded-lg flex items-center gap-2 text-xs ${sensitivityResult.score > 50 ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
                      {sensitivityResult.score > 50 ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      <span>{sensitivityResult.score > 50 ? `发现${sensitivityResult.issues?.length || 0}个风险项` : "内容安全检查通过"}</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {referenceImageUrl && (
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                      <TrendingUp className="h-3.5 w-3.5 text-red-500" />
                      参考的同行爆款封面
                    </p>
                    <img src={proxyXhsImage(referenceImageUrl) || referenceImageUrl} alt="参考图" className="w-full h-32 object-cover rounded-lg border" />
                  </CardContent>
                </Card>
              )}

              <div className="flex flex-col gap-2">
                <Button className="w-full h-12 bg-red-500 hover:bg-red-600 text-white text-base" onClick={() => { handleSave(); setStep(3); }}>
                  <CheckCircle2 className="h-5 w-5 mr-2" />
                  满意，去发布
                </Button>
                <Button variant="outline" className="w-full" onClick={() => { setEditMode(!editMode); }}>
                  <Wand2 className="h-4 w-4 mr-2" />
                  {editMode ? "收起编辑" : "需要修改"}
                </Button>
                <Button variant="ghost" className="w-full text-xs text-muted-foreground" onClick={() => setStep(1)}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  返回重新选方案
                </Button>
              </div>
            </div>
          </div>

          {/* Expandable Edit Section */}
          {editMode && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-2 border-t">
              <div className="lg:col-span-2 space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="h-5 w-5 text-red-500" />
                      编辑内容
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
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

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2"><ImagePlus className="h-4 w-4" /> 重新生成配图</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {researchResult?.competitorNotes?.filter((n: any) => n.cover_url).length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium flex items-center gap-1.5">
                          <TrendingUp className="h-3.5 w-3.5 text-red-500" />
                          选择同行封面作为参考
                        </p>
                        <div className="grid grid-cols-3 gap-1.5">
                          {researchResult.competitorNotes
                            .filter((n: any) => n.cover_url)
                            .slice(0, 6)
                            .map((note: any, i: number) => (
                              <button
                                key={note.id || i}
                                onClick={() => setReferenceImageUrl(proxyXhsImage(note.cover_url) || "")}
                                className={`relative group rounded-lg overflow-hidden border-2 transition-all aspect-[3/4] ${
                                  referenceImageUrl === proxyXhsImage(note.cover_url)
                                    ? "border-red-500 ring-2 ring-red-200"
                                    : "border-transparent hover:border-red-300"
                                }`}
                              >
                                <img src={proxyXhsImage(note.cover_url)} alt={note.title} className="w-full h-full object-cover"
                                  onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = "none"; }} />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                <div className="absolute bottom-0 left-0 right-0 p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <p className="text-[8px] text-white leading-tight line-clamp-1">{note.title}</p>
                                  <p className="text-[7px] text-white/80">❤️{note.liked_count}</p>
                                </div>
                                {referenceImageUrl === proxyXhsImage(note.cover_url) && (
                                  <div className="absolute top-0.5 right-0.5 bg-red-500 text-white rounded-full p-0.5">
                                    <Check className="h-2.5 w-2.5" />
                                  </div>
                                )}
                              </button>
                            ))}
                        </div>
                      </div>
                    )}

                    {!referenceImageUrl && (
                      <ObjectUploader maxNumberOfFiles={1} maxFileSize={10485760}
                        allowedFileTypes={["image/*"]}
                        onGetUploadParameters={handleGetUploadParameters} onComplete={handleRefImageUploadComplete}
                        buttonClassName="w-full inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-lg text-xs font-medium h-10 px-3 border border-dashed border-purple-300 bg-purple-50/30 text-purple-600 hover:bg-purple-100 hover:border-purple-400 transition-colors">
                        <Upload className="h-3.5 w-3.5 mr-1" />上传自己的参考图
                      </ObjectUploader>
                    )}

                    <Textarea value={imagePrompt} onChange={(e) => setImagePrompt(e.target.value)}
                      placeholder="描述配图风格..."
                      rows={2} className="text-sm" />
                    <Select value={imageSize} onValueChange={setImageSize}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1024x1536">竖版 3:4（小红书推荐）</SelectItem>
                        <SelectItem value="1024x1024">正方形 1:1</SelectItem>
                        <SelectItem value="1536x1024">横版 4:3</SelectItem>
                      </SelectContent>
                    </Select>

                    {referenceImageUrl && (
                      <>
                        <div>
                          <p className="text-xs font-medium mb-1.5 text-gray-700">📐 封面布局模式</p>
                          <Select value={layoutMode} onValueChange={(v) => setLayoutMode(v as any)}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="single">单图模式（一张完整大图）</SelectItem>
                              <SelectItem value="dual-vertical">上下双图拼接</SelectItem>
                              <SelectItem value="dual-horizontal">左右双图拼接</SelectItem>
                              <SelectItem value="grid-2x2">四格拼图（2×2 网格）</SelectItem>
                              <SelectItem value="left-big-right-small">左大右双小</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-[10px] text-gray-500 mt-1">拼图模式会生成多张子图后用模板拼接，适合"前后对比"、"多产品"、"步骤展示"类爆款</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium mb-1.5 text-gray-700">🎯 复刻强度</p>
                          <Select value={mimicStrength} onValueChange={(v) => setMimicStrength(v as any)}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="full">完全复刻（布局/配色/风格全部模仿）</SelectItem>
                              <SelectItem value="partial">部分借鉴（只学风格，内容自由）</SelectItem>
                              <SelectItem value="minimal">仅参考氛围（最大原创度）</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </>
                    )}
                    <Button className="w-full bg-red-500 hover:bg-red-600 text-white"
                      disabled={isImageGenerating || !imagePrompt.trim()}
                      onClick={() => handleGenerateOrEditImage()}>
                      {isImageGenerating ? (
                        <><Loader2 className="h-4 w-4 animate-spin mr-2" />生成中...</>
                      ) : referenceImageUrl ? (
                        <><RefreshCw className="h-4 w-4 mr-2" />🔥 复刻爆款封面（含中文文字+布局）</>
                      ) : (
                        <><ImagePlus className="h-4 w-4 mr-2" />生成配图</>
                      )}
                    </Button>

                    {/* AI 助手聊天 — 任何时候都能用，生成后能直接下指令改图 */}
                    {referenceImageUrl && (
                      <AssistantChat
                        context={{
                          referenceImageUrl,
                          generatedImageUrl: lastPipelineResult?.imageUrl ?? null,
                          topic: imagePrompt || form.title,
                          title: form.title,
                          layout: layoutMode,
                          mimicStrength,
                          textOverlays: customTextOverlays || lastPipelineResult?.textOverlays || [],
                          emojis: customEmojis || lastPipelineResult?.emojis || [],
                          imagePromptUsed: lastPipelineResult?.promptUsed,
                          referenceId: lastPipelineResult?.referenceId ?? null,
                        }}
                        isBusy={isImageGenerating}
                        onApplyChanges={handleAssistantApply}
                        onFeedback={handleAssistantFeedback}
                      />
                    )}

                    <ObjectUploader maxNumberOfFiles={9} maxFileSize={10485760}
                      allowedFileTypes={["image/*"]}
                      onGetUploadParameters={handleGetUploadParameters} onComplete={handleImageUploadComplete}
                      buttonClassName="w-full inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-md text-xs font-medium h-8 px-3 border border-input bg-background hover:bg-accent hover:text-accent-foreground">
                      <Upload className="h-3 w-3 mr-1" />上传自有素材
                    </ObjectUploader>
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

                {sensitivityResult && sensitivityResult.issues?.length > 0 && (
                  <Card className="border-destructive/50">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center justify-between">
                        <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> 安全检查</span>
                        <Badge variant="destructive">风险分: {sensitivityResult.score}</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1.5">
                      {sensitivityResult.issues.map((issue: any, i: number) => (
                        <div key={i} className="text-xs p-2 rounded bg-muted">
                          <Badge variant={issue.severity === "high" ? "destructive" : "secondary"} className="text-[10px] mr-1">
                            {issue.severity === "high" ? "高" : issue.severity === "medium" ? "中" : "低"}</Badge>
                          <span className="font-medium">"{issue.word}"</span>
                          {issue.suggestion && <p className="text-[10px] mt-1 text-muted-foreground">建议: {issue.suggestion}</p>}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          )}
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
                    <p className="font-medium">标记为已发布 <span className="text-xs font-normal text-muted-foreground">（自动开启数据追踪）</span></p>
                    <p className="text-sm text-muted-foreground mt-1">
                      在小红书发布后复制笔记链接粘贴到下面，系统会每天自动追踪点赞/收藏/评论 + SEO关键词排名
                    </p>
                    <div className="mt-3 flex flex-col sm:flex-row gap-2">
                      <Input
                        value={publishedNoteUrl}
                        onChange={(e) => setPublishedNoteUrl(e.target.value)}
                        placeholder="粘贴小红书笔记链接（xhslink.com/... 或 xiaohongshu.com/explore/...）"
                        disabled={publishMutation.isSuccess}
                        className="flex-1 text-sm"
                      />
                      <Button
                        variant={publishMutation.isSuccess ? "outline" : publishStep === "opened" ? "default" : "outline"}
                        disabled={publishMutation.isPending || publishMutation.isSuccess || !savedContentId}
                        onClick={handleMarkPublished}
                      >
                        {publishMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> :
                         publishMutation.isSuccess ? <><Check className="h-4 w-4 mr-2" />已标记</> :
                         <><CheckCircle2 className="h-4 w-4 mr-2" />确认已发布</>}
                      </Button>
                    </div>
                    {publishMutation.isSuccess && autoTrackingId && (
                      <div className="mt-3 flex items-center gap-2 text-sm text-green-700 bg-green-100/60 rounded-lg px-3 py-2">
                        <TrendingUp className="h-4 w-4" />
                        <span>已自动加入追踪 · 第一份数据将在 30 秒内出现</span>
                        <Button size="sm" variant="ghost" className="h-7 ml-auto text-green-700 hover:text-green-800"
                          onClick={() => setLocation(`/tracking/${autoTrackingId}`)}>
                          查看 →
                        </Button>
                      </div>
                    )}
                    {publishMutation.isSuccess && !autoTrackingId && publishedNoteUrl.trim() && autoTrackingError && (
                      <div className="mt-3 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                        <AlertTriangle className="h-4 w-4" />
                        <span>自动追踪未启用：{autoTrackingError}</span>
                      </div>
                    )}
                    {publishMutation.isSuccess && !publishedNoteUrl.trim() && (
                      <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
                        <AlertTriangle className="h-4 w-4" />
                        <span>未粘贴链接，本篇不会自动追踪。可稍后到"笔记追踪"补加。</span>
                      </div>
                    )}
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
          {step === 1 && !researchResult && (
            <button className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors underline underline-offset-4" onClick={() => { setStep(2); }}>
              跳过分析
            </button>
          )}
          {step < 3 && step !== 1 && (
            <Button onClick={handleNext} disabled={!canProceed()} className="bg-red-500 hover:bg-red-600 text-white">
              {step === 2 ? "去发布" : "下一步"}<ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </div>
      <InsufficientCreditsDialog
        open={creditDialog.open}
        onOpenChange={(open) => setCreditDialog({ ...creditDialog, open })}
        currentCredits={creditDialog.current}
        requiredCredits={creditDialog.required}
      />

      <Dialog open={showProfilePeek} onOpenChange={setShowProfilePeek}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">🧬 我的内容风格画像</DialogTitle>
            <DialogDescription>
              AI 自动从你过往的笔记中学习出的偏好。每次保存或发布笔记后会自动更新。
            </DialogDescription>
          </DialogHeader>
          {!profileData ? (
            <div className="py-8 text-center text-sm text-muted-foreground">加载中…</div>
          ) : profileData.sampleSize === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              暂无样本。请先保存或发布几篇笔记，AI 才能开始学习你的风格。
            </div>
          ) : (
            <div className="space-y-3 text-sm max-h-[60vh] overflow-y-auto">
              <div className="flex items-center justify-between text-xs text-muted-foreground border-b pb-2">
                <span>已学习样本：<span className="font-semibold text-foreground">{profileData.sampleSize} 篇</span></span>
                <span>平均字数：{profileData.avgBodyLength} · 平均标签：{profileData.avgTagCount}</span>
              </div>

              {profileData.preferredTitlePatterns?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">惯用标题公式</p>
                  <div className="flex flex-wrap gap-1.5">
                    {profileData.preferredTitlePatterns.map((p: any, i: number) => (
                      <Badge key={i} variant="outline" className="text-xs">{p.value} ×{p.count}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {profileData.favoriteTags?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">高频标签 Top 10</p>
                  <div className="flex flex-wrap gap-1">
                    {profileData.favoriteTags.slice(0, 10).map((t: any, i: number) => (
                      <span key={i} className="text-xs text-red-500">#{t.value}<span className="text-muted-foreground/70">·{t.count}</span></span>
                    ))}
                  </div>
                </div>
              )}

              {profileData.preferredOpenings?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">常用开头风格</p>
                  <ul className="space-y-1">
                    {profileData.preferredOpenings.slice(0, 5).map((o: any, i: number) => (
                      <li key={i} className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">"{o.value}…" <span className="text-[10px] opacity-60">×{o.count}</span></li>
                    ))}
                  </ul>
                </div>
              )}

              {profileData.preferredEmojis?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">偏爱 emoji</p>
                  <div className="text-lg tracking-wide">
                    {profileData.preferredEmojis.slice(0, 10).map((e: any) => e.value).join(" ")}
                  </div>
                </div>
              )}

              <p className="text-[10px] text-muted-foreground pt-2 border-t">
                最后更新：{profileData.lastUpdated ? new Date(profileData.lastUpdated).toLocaleString("zh-CN") : "—"}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
