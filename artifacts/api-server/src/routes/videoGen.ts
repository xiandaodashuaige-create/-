import { Router, type IRouter } from "express";
import { ensureUser } from "../middlewares/creditSystem.js";
import { requireCredits, deductCredits } from "../middlewares/creditSystem.js";
import { enqueueVideoJob, getVideoJob } from "../services/videoJobs.js";
import { generateVideoCreativePlan } from "../services/videoPipeline.js";
import type { SeedanceAspect } from "../services/seedance.js";

const router: IRouter = Router();

type Platform = "tiktok" | "xhs" | "instagram" | "facebook";
const isPlatform = (x: unknown): x is Platform => x === "tiktok" || x === "xhs" || x === "instagram" || x === "facebook";
const isAspect = (x: unknown): x is SeedanceAspect => x === "9:16" || x === "16:9" || x === "1:1" || x === "4:3" || x === "3:4";

// ── POST /api/ai/generate-video-plan ────────────────────────────────────
// 只生成 brief（同步、便宜、无 Seedance 调用），客户在编辑器里先看效果再决定要不要真出片
router.post("/ai/generate-video-plan", requireCredits("ai-generate-video-plan"), async (req, res): Promise<void> => {
  const user = await ensureUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const b = req.body ?? {};
  if (!b.newTopic || typeof b.newTopic !== "string") { res.status(400).json({ error: "newTopic is required" }); return; }
  const platform: Platform = isPlatform(b.platform) ? b.platform : "tiktok";

  try {
    const plan = await generateVideoCreativePlan({
      userId: user.id,
      platform,
      newTopic: b.newTopic,
      newTitle: typeof b.newTitle === "string" ? b.newTitle : undefined,
      newKeyPoints: Array.isArray(b.newKeyPoints) ? b.newKeyPoints.filter((x: any) => typeof x === "string") : undefined,
      niche: typeof b.niche === "string" ? b.niche : null,
      region: typeof b.region === "string" ? b.region : null,
      mimicStrength: b.mimicStrength === "full" || b.mimicStrength === "minimal" ? b.mimicStrength : "partial",
      referenceVideo: b.referenceVideo && typeof b.referenceVideo === "object" ? b.referenceVideo : null,
      customSubtitles: Array.isArray(b.customSubtitles) ? b.customSubtitles : null,
      customEmojis: Array.isArray(b.customEmojis) ? b.customEmojis.filter((x: any) => typeof x === "string") : null,
      customBgmMood: typeof b.customBgmMood === "string" ? b.customBgmMood : null,
      preferredAspect: isAspect(b.aspect) ? b.aspect : null,
      preferredDurationSec: b.durationSec === 5 || b.durationSec === 10 ? b.durationSec : null,
      extraInstructions: typeof b.extraInstructions === "string" ? b.extraInstructions : null,
    });
    await deductCredits(req, "ai-generate-video-plan");
    res.json(plan);
  } catch (err: any) {
    req.log.error(err, "video plan failed");
    res.status(500).json({ error: "视频创意生成失败，请重试", message: err?.message });
  }
});

// ── POST /api/ai/generate-video ─────────────────────────────────────────
// 异步生成完整视频（Seedance 出原片 + ffmpeg 烧字幕 + 上传）。立即返回 jobId。
router.post("/ai/generate-video", requireCredits("ai-generate-video"), async (req, res): Promise<void> => {
  const user = await ensureUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const b = req.body ?? {};
  if (!b.newTopic || typeof b.newTopic !== "string") { res.status(400).json({ error: "newTopic is required" }); return; }
  const platform: Platform = isPlatform(b.platform) ? b.platform : "tiktok";

  const { job, created } = await enqueueVideoJob(user.id, {
    userId: user.id,
    platform,
    newTopic: b.newTopic,
    newTitle: typeof b.newTitle === "string" ? b.newTitle : undefined,
    newKeyPoints: Array.isArray(b.newKeyPoints) ? b.newKeyPoints.filter((x: any) => typeof x === "string") : undefined,
    niche: typeof b.niche === "string" ? b.niche : null,
    region: typeof b.region === "string" ? b.region : null,
    mimicStrength: b.mimicStrength === "full" || b.mimicStrength === "minimal" ? b.mimicStrength : "partial",
    referenceVideo: b.referenceVideo && typeof b.referenceVideo === "object" ? b.referenceVideo : null,
    customSubtitles: Array.isArray(b.customSubtitles) ? b.customSubtitles : null,
    customEmojis: Array.isArray(b.customEmojis) ? b.customEmojis.filter((x: any) => typeof x === "string") : null,
    customBgmMood: typeof b.customBgmMood === "string" ? b.customBgmMood : null,
    preferredAspect: isAspect(b.aspect) ? b.aspect : null,
    preferredDurationSec: b.durationSec === 5 || b.durationSec === 10 ? b.durationSec : null,
    extraInstructions: typeof b.extraInstructions === "string" ? b.extraInstructions : null,
    tier: b.tier === "pro" ? "pro" : "lite",
    burnSubtitles: b.burnSubtitles !== false,
  });

  // 仅新建任务时扣费；命中已有去重任务直接返回，不重复扣
  if (created) {
    await deductCredits(req, "ai-generate-video");
  }

  res.status(202).json({
    jobId: job.id,
    status: job.status,
    deduplicated: !created,
    message: created
      ? `视频生成任务已入队，请轮询 /api/ai/video-job?jobId=${job.id}（一般 1-3 分钟）`
      : `已有进行中的视频任务（jobId=${job.id}），未重复扣费`,
  });
});

// ── POST /api/ai/generate-video-sora ────────────────────────────────────
// 高清电影级（OpenAI Sora 2 Pro · 1080p · 12s）—— 仅 pro 用户可用，250 积分
router.post("/ai/generate-video-sora", requireCredits("ai-generate-video-sora"), async (req, res): Promise<void> => {
  const user = await ensureUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (user.plan !== "pro") {
    res.status(403).json({ error: "pro_only", message: "Sora 高清电影级视频仅对 Pro 套餐用户开放，请先升级套餐。" });
    return;
  }
  const b = req.body ?? {};
  if (!b.newTopic || typeof b.newTopic !== "string") { res.status(400).json({ error: "newTopic is required" }); return; }
  const platform: Platform = isPlatform(b.platform) ? b.platform : "tiktok";

  const { job, created } = await enqueueVideoJob(user.id, {
    userId: user.id,
    platform,
    newTopic: b.newTopic,
    newTitle: typeof b.newTitle === "string" ? b.newTitle : undefined,
    newKeyPoints: Array.isArray(b.newKeyPoints) ? b.newKeyPoints.filter((x: any) => typeof x === "string") : undefined,
    niche: typeof b.niche === "string" ? b.niche : null,
    region: typeof b.region === "string" ? b.region : null,
    mimicStrength: b.mimicStrength === "full" || b.mimicStrength === "minimal" ? b.mimicStrength : "partial",
    referenceVideo: b.referenceVideo && typeof b.referenceVideo === "object" ? b.referenceVideo : null,
    customSubtitles: Array.isArray(b.customSubtitles) ? b.customSubtitles : null,
    customEmojis: Array.isArray(b.customEmojis) ? b.customEmojis.filter((x: any) => typeof x === "string") : null,
    customBgmMood: typeof b.customBgmMood === "string" ? b.customBgmMood : null,
    preferredAspect: isAspect(b.aspect) ? b.aspect : null,
    preferredDurationSec: b.durationSec === 5 || b.durationSec === 10 ? b.durationSec : null,
    extraInstructions: typeof b.extraInstructions === "string" ? b.extraInstructions : null,
    provider: "sora-pro",
    burnSubtitles: b.burnSubtitles === true, // Sora 默认不烧字幕，保留电影感
  });

  if (created) {
    await deductCredits(req, "ai-generate-video-sora");
  }

  res.status(202).json({
    jobId: job.id,
    status: job.status,
    deduplicated: !created,
    message: created
      ? `Sora 高清视频任务已入队，请轮询 /api/ai/video-job?jobId=${job.id}（一般 2-5 分钟）`
      : `已有进行中的视频任务（jobId=${job.id}），未重复扣费`,
  });
});

// ── GET /api/ai/video-job?jobId=xxx ─────────────────────────────────────
router.get("/ai/video-job", async (req, res): Promise<void> => {
  const user = await ensureUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const jobId = String(req.query.jobId ?? "");
  if (!jobId) { res.status(400).json({ error: "missing_jobId" }); return; }
  const job = await getVideoJob(jobId, user.id);
  if (!job) { res.status(404).json({ error: "job_not_found" }); return; }
  res.json({
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    plan: job.plan,
    result: job.result,
    error: job.error,
  });
});

export default router;
