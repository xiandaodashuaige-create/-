import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ObjectUploader } from "@workspace/object-storage-web";
import { PLATFORMS, ENABLED_PLATFORMS, type PlatformId } from "@/lib/platform-meta";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Upload, Image as ImageIcon, Video, Sparkles, Calendar as CalendarIcon, CheckCircle2,
  ArrowLeft, ArrowRight, Loader2, Send, X, AlertCircle, Clock, Wand2,
} from "lucide-react";

type MediaItem = { url: string; type: "image" | "video"; name: string };

function pad(n: number) { return n.toString().padStart(2, "0"); }
function toLocalInputValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function inOneHour(): string { const d = new Date(); d.setHours(d.getHours() + 1); return toLocalInputValue(d); }
function tonightAt(h: number): string {
  const d = new Date(); d.setHours(h, 0, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  return toLocalInputValue(d);
}
function tomorrowAt(h: number): string {
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(h, 0, 0, 0);
  return toLocalInputValue(d);
}

export default function QuickPublishPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();

  // 只支持有 API 自动发布能力的平台
  const supportedPlatforms = useMemo(
    () => ENABLED_PLATFORMS.filter((p) => p.publishMode === "api"),
    [],
  );

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [platform, setPlatform] = useState<PlatformId>(supportedPlatforms[0]?.id ?? "tiktok");
  const [accountId, setAccountId] = useState<number | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [scheduledAt, setScheduledAt] = useState<string>(inOneHour());
  const [createdContentId, setCreatedContentId] = useState<number | null>(null);

  const accountsQ = useQuery({
    queryKey: ["quick-publish-accounts", platform],
    queryFn: () => api.accounts.list({ platform }),
  });
  const accounts = (accountsQ.data ?? []).filter((a: any) => a.status === "connected" || a.status === "active" || !a.status);

  const platformMeta = PLATFORMS[platform];
  const isVideoPlatform = platform === "tiktok";

  // ── 上传 ──
  async function handleGetUploadParameters(file: any) {
    const res = await fetch("/api/storage/uploads/request-url", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
    });
    if (!res.ok) throw new Error("获取上传地址失败");
    const data = await res.json();
    (file as any)._objectPath = data.objectPath;
    return { method: "PUT" as const, url: data.uploadURL, headers: { "Content-Type": file.type } };
  }
  function handleUploadComplete(result: any) {
    const files = result.successful || [];
    const next: MediaItem[] = [];
    let rejectedImage = 0;
    for (const file of files) {
      const objectPath = (file as any)._objectPath;
      if (!objectPath) continue;
      const isVideo = file.type?.startsWith("video/");
      // TikTok 必须视频，过滤掉图片
      if (isVideoPlatform && !isVideo) { rejectedImage++; continue; }
      next.push({ url: `/api/storage${objectPath}`, type: isVideo ? "video" : "image", name: file.name });
    }
    setMedia((prev) => [...prev, ...next]);
    if (next.length) toast({ title: `已上传 ${next.length} 个文件` });
    if (rejectedImage > 0) {
      toast({
        title: `已忽略 ${rejectedImage} 张图片`,
        description: "TikTok 必须发视频，请上传 .mp4 / .mov 等视频文件",
        variant: "destructive",
      });
    }
  }
  function removeMedia(idx: number) {
    setMedia((prev) => prev.filter((_, i) => i !== idx));
  }

  // ── AI 一键优化 ──
  const aiMut = useMutation({
    mutationFn: () => api.ai.rewrite({ originalContent: body || title, platform, tone: "engaging" }),
    onSuccess: (r: any) => {
      if (r?.rewrittenTitle) setTitle(r.rewrittenTitle);
      if (r?.rewrittenBody) setBody(r.rewrittenBody);
      if (Array.isArray(r?.suggestedTags)) {
        setTags((prev) => Array.from(new Set([...prev, ...r.suggestedTags])).slice(0, 12));
      }
      toast({ title: "AI 已为你优化文案", description: "已套用平台调性 + 推荐标签" });
    },
    onError: (e: any) => toast({ title: "AI 优化失败", description: e?.message, variant: "destructive" }),
  });

  // ── 标签 ──
  function addTag() {
    const t = tagInput.trim().replace(/^#/, "");
    if (!t) return;
    if (tags.includes(t)) return;
    setTags((prev) => [...prev, t].slice(0, 12));
    setTagInput("");
  }

  // ── 提交：create content + schedule ──
  const submitMut = useMutation({
    mutationFn: async () => {
      if (!accountId) throw new Error("请选择发布账号");
      if (media.length === 0) throw new Error("请上传至少 1 个媒体文件");
      if (!body.trim()) throw new Error("请输入正文");
      if (isVideoPlatform && !media.some((m) => m.type === "video")) {
        throw new Error("TikTok 必须包含视频文件");
      }
      if (new Date(scheduledAt).getTime() <= Date.now() - 60_000) {
        throw new Error("发布时间必须是将来时间");
      }

      const videoUrl = media.find((m) => m.type === "video")?.url || null;
      const imageUrls = media.filter((m) => m.type === "image").map((m) => m.url);

      const created = await api.content.create({
        accountId,
        platform,
        mediaType: videoUrl ? "video" : "image",
        title: title.trim() || body.trim().slice(0, 30),
        body: body.trim(),
        tags,
        imageUrls,
        videoUrl,
      });
      const cid = created.id;
      const scheduled = await api.content.schedule(cid, new Date(scheduledAt).toISOString());
      return { contentId: cid, scheduled };
    },
    onSuccess: ({ contentId }) => {
      setCreatedContentId(contentId);
      setStep(4);
      qc.invalidateQueries({ queryKey: ["content"] });
      qc.invalidateQueries({ queryKey: ["schedules"] });
      toast({ title: "已加入定时发布", description: `时间到了系统会自动发到 ${platformMeta.name}` });
    },
    onError: (e: any) => toast({ title: "保存失败", description: e?.message ?? "未知错误", variant: "destructive" }),
  });

  // ── 步骤校验 ──
  const canNext1 = !!accountId && media.length > 0;
  const canNext2 = body.trim().length > 0;
  const futureValid = !!scheduledAt && new Date(scheduledAt).getTime() > Date.now() - 60_000;

  function reset() {
    setStep(1); setMedia([]); setTitle(""); setBody(""); setTags([]); setTagInput(""); setScheduledAt(inOneHour()); setCreatedContentId(null);
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-500 to-pink-500 flex items-center justify-center">
          <Send className="h-6 w-6 text-white" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">上传定时发布</h1>
          <p className="text-sm text-muted-foreground">
            上传你自己的图/视频 → 写文案（可一键 AI 优化）→ 选时间 → 系统按时自动发到 FB / IG / TikTok
          </p>
        </div>
      </div>

      {/* 进度 */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-2">
          {[
            { n: 1, label: "选账号 + 上传", icon: Upload },
            { n: 2, label: "写文案", icon: Wand2 },
            { n: 3, label: "选时间", icon: CalendarIcon },
            { n: 4, label: "完成", icon: CheckCircle2 },
          ].map((s, i, arr) => {
            const Icon = s.icon;
            const done = step > s.n;
            const active = step === s.n;
            return (
              <div key={s.n} className="flex items-center flex-1">
                <div className={`flex flex-col items-center gap-1 ${active ? "text-primary" : done ? "text-emerald-600" : "text-muted-foreground/50"}`}>
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition ${active ? "border-primary bg-primary/10" : done ? "border-emerald-500 bg-emerald-50" : "border-muted-foreground/20"}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="text-xs font-medium">{s.label}</span>
                </div>
                {i < arr.length - 1 && <ArrowRight className="h-3 w-3 mx-2 text-muted-foreground/40 flex-shrink-0" />}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Step 1 */}
      {step === 1 && (
        <Card className="p-6 space-y-5">
          <div>
            <label className="text-sm font-medium mb-2 block">发布到哪个平台</label>
            <div className="grid grid-cols-3 gap-2">
              {supportedPlatforms.map((p) => {
                const Icon = p.icon;
                const selected = platform === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { setPlatform(p.id); setAccountId(null); }}
                    className={`flex items-center gap-2 p-3 rounded-lg border-2 transition ${selected ? "border-primary bg-primary/5" : "border-muted hover:border-muted-foreground/30"}`}
                  >
                    <div className={`w-8 h-8 rounded-md flex items-center justify-center ${p.bgClass}`}>
                      <Icon className={`h-4 w-4 ${p.textClass}`} />
                    </div>
                    <span className="font-medium text-sm">{p.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">用哪个账号发</label>
            {accountsQ.isLoading ? (
              <div className="text-sm text-muted-foreground"><Loader2 className="h-3.5 w-3.5 inline animate-spin mr-1" />加载账号…</div>
            ) : accounts.length === 0 ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-800 p-3 text-sm flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  还没有 {platformMeta.name} 账号。
                  <Link href="/accounts" className="underline font-medium ml-1">去添加 / 授权 →</Link>
                </div>
              </div>
            ) : (
              <Select value={accountId ? String(accountId) : ""} onValueChange={(v) => setAccountId(Number(v))}>
                <SelectTrigger><SelectValue placeholder="选择账号" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a: any) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.nickname || a.handle || `账号 #${a.id}`} {a.region ? `· ${a.region}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">
              上传你的{isVideoPlatform ? "视频" : "图片或视频"}
              {isVideoPlatform && <span className="text-xs text-muted-foreground ml-2">TikTok 推荐 9:16 竖屏视频</span>}
            </label>

            {media.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-3">
                {media.map((m, i) => (
                  <div key={i} className="relative rounded-lg overflow-hidden bg-muted aspect-square group border">
                    {m.type === "video" ? (
                      <video src={m.url} className="w-full h-full object-cover" muted />
                    ) : (
                      <img src={m.url} alt="" className="w-full h-full object-cover" />
                    )}
                    <div className="absolute top-1 left-1 bg-black/60 text-white text-[10px] rounded px-1.5 py-0.5 flex items-center gap-1">
                      {m.type === "video" ? <Video className="h-2.5 w-2.5" /> : <ImageIcon className="h-2.5 w-2.5" />}
                      {m.type}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeMedia(i)}
                      className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <ObjectUploader
              maxNumberOfFiles={isVideoPlatform ? 1 : 9}
              maxFileSize={104857600}
              onGetUploadParameters={handleGetUploadParameters}
              onComplete={handleUploadComplete}
              buttonClassName="w-full inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors bg-muted hover:bg-muted/70 border border-dashed border-muted-foreground/40 h-20"
            >
              <Upload className="h-5 w-5 mr-2" />
              {media.length > 0 ? "继续添加" : "点击或拖拽上传"}
            </ObjectUploader>
          </div>

          <div className="flex gap-2 pt-2 border-t">
            <Link href="/dashboard"><Button variant="outline">返回</Button></Link>
            <Button className="flex-1" disabled={!canNext1} onClick={() => setStep(2)}>
              下一步：写文案 <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </Card>
      )}

      {/* Step 2 */}
      {step === 2 && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              发到 <strong className="text-foreground">{platformMeta.name}</strong>
              {accounts.find((a: any) => a.id === accountId)?.nickname && (
                <> · @{accounts.find((a: any) => a.id === accountId)?.nickname}</>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-primary/40 text-primary hover:bg-primary/5"
              disabled={aiMut.isPending || (!body.trim() && !title.trim())}
              onClick={() => aiMut.mutate()}
            >
              {aiMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
              一键 AI 优化（按 {platformMeta.name} 调性）
            </Button>
          </div>

          <div>
            <label className="text-xs font-medium mb-1 block text-muted-foreground">标题（可选）</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="一句话吸睛标题" />
          </div>

          <div>
            <label className="text-xs font-medium mb-1 block text-muted-foreground">正文 *</label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={7}
              placeholder={`描述一下这条要发的内容…\nAI 会根据 ${platformMeta.name} 的调性帮你润色`}
            />
            <div className="text-xs text-muted-foreground text-right mt-1">{body.length} 字</div>
          </div>

          <div>
            <label className="text-xs font-medium mb-1 block text-muted-foreground">标签（可选，回车添加，最多 12 个）</label>
            <div className="flex flex-wrap gap-1.5 mb-2 min-h-[24px]">
              {tags.map((t) => (
                <Badge key={t} variant="secondary" className="cursor-pointer" onClick={() => setTags(tags.filter((x) => x !== t))}>
                  #{t} <X className="h-2.5 w-2.5 ml-1" />
                </Badge>
              ))}
            </div>
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
              placeholder="如：美食 / fyp / tutorial"
            />
          </div>

          <div className="flex gap-2 pt-3 border-t">
            <Button variant="outline" onClick={() => setStep(1)}><ArrowLeft className="h-4 w-4 mr-1" />上一步</Button>
            <Button className="flex-1" disabled={!canNext2} onClick={() => setStep(3)}>
              下一步：选时间 <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </Card>
      )}

      {/* Step 3 */}
      {step === 3 && (
        <Card className="p-6 space-y-5">
          <div>
            <label className="text-sm font-medium mb-2 block flex items-center gap-1.5">
              <Clock className="h-4 w-4" /> 什么时候发？
            </label>
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              min={toLocalInputValue(new Date())}
              className="text-base"
            />
            {!futureValid && (
              <div className="text-xs text-red-600 mt-1">请选择将来的时间</div>
            )}
          </div>

          <div>
            <div className="text-xs text-muted-foreground mb-2">快捷预设：</div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setScheduledAt(inOneHour())}>1 小时后</Button>
              <Button size="sm" variant="outline" onClick={() => setScheduledAt(tonightAt(20))}>今晚 20:00</Button>
              <Button size="sm" variant="outline" onClick={() => setScheduledAt(tonightAt(21))}>今晚 21:00</Button>
              <Button size="sm" variant="outline" onClick={() => setScheduledAt(tomorrowAt(9))}>明早 09:00</Button>
              <Button size="sm" variant="outline" onClick={() => setScheduledAt(tomorrowAt(12))}>明天 12:00</Button>
              <Button size="sm" variant="outline" onClick={() => setScheduledAt(tomorrowAt(19))}>明天 19:00</Button>
            </div>
          </div>

          {/* 预览卡 */}
          <div className="rounded-lg border bg-muted/20 p-4 space-y-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">即将定时发布</div>
            <div className="flex gap-3">
              {media[0] && (
                <div className="w-16 h-16 rounded overflow-hidden bg-muted flex-shrink-0 border">
                  {media[0].type === "video" ? (
                    <video src={media[0].url} className="w-full h-full object-cover" muted />
                  ) : (
                    <img src={media[0].url} alt="" className="w-full h-full object-cover" />
                  )}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{title || body.slice(0, 30)}</div>
                <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{body}</div>
                <div className="text-xs mt-1.5 text-primary">
                  → {platformMeta.name} · {new Date(scheduledAt).toLocaleString("zh-CN", { hour12: false })}
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-3 border-t">
            <Button variant="outline" onClick={() => setStep(2)}><ArrowLeft className="h-4 w-4 mr-1" />上一步</Button>
            <Button
              className="flex-1 bg-gradient-to-r from-orange-500 to-pink-500 hover:opacity-90"
              disabled={!futureValid || submitMut.isPending}
              onClick={() => submitMut.mutate()}
            >
              {submitMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              确认并加入定时发布
            </Button>
          </div>
        </Card>
      )}

      {/* Step 4 */}
      {step === 4 && createdContentId && (
        <Card className="p-8 text-center space-y-4">
          <CheckCircle2 className="h-16 w-16 text-emerald-500 mx-auto" />
          <div>
            <div className="text-xl font-bold">已加入定时发布 ✨</div>
            <div className="text-sm text-muted-foreground mt-1">
              时间到了系统会自动发到 <strong>{platformMeta.name}</strong>
              <br />
              发送时间：<strong>{new Date(scheduledAt).toLocaleString("zh-CN", { hour12: false })}</strong>
            </div>
          </div>
          <div className="flex gap-2 justify-center flex-wrap">
            <Link href="/schedules"><Button size="lg"><CalendarIcon className="h-4 w-4 mr-2" />查看排期</Button></Link>
            <Link href={`/content/${createdContentId}`}>
              <Button size="lg" variant="outline">查看草稿</Button>
            </Link>
            <Button variant="ghost" onClick={reset}>再发一条</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
