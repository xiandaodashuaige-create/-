import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger.js";
import { SeedanceClient, type SeedanceAspect } from "./seedance.js";
import { generateVideoCreativePlan, type GenerateVideoPlanInput, type VideoCreativePlan } from "./videoPipeline.js";
import { burnSubtitles } from "./videoComposer.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { refundCredits, CREDIT_COSTS } from "../middlewares/creditSystem.js";

const objectStorageService = new ObjectStorageService();

/** 把内部相对 URL 转成 OpenAI vision / Seedance 能从公网访问的绝对 URL */
function absolutizePublicUrl(maybeUrl: string | null | undefined): string | null {
  if (!maybeUrl) return null;
  if (/^https?:\/\//i.test(maybeUrl)) return maybeUrl;
  if (!maybeUrl.startsWith("/")) return null;
  const prodDomain = (process.env.REPLIT_DOMAINS ?? "").split(",")[0]?.trim();
  const devDomain = process.env.REPLIT_DEV_DOMAIN?.trim();
  const host = prodDomain || devDomain;
  if (!host) return null;
  return `https://${host}${maybeUrl}`;
}

/**
 * 视频生成是 1-5 分钟级的异步任务（Seedance 排队 + 模型推理 + ffmpeg 合成）。
 * 进程内队列，单用户去重，全局并发上限 2，1h TTL GC（仅清终态）。
 */

export type VideoJobStatus = "queued" | "planning" | "generating" | "composing" | "uploading" | "succeeded" | "failed";

export interface VideoJob {
  id: string;
  userId: number;
  status: VideoJobStatus;
  progress: number;       // 0-100
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  input: GenerateVideoPlanInput & { tier?: "lite" | "pro"; burnSubtitles?: boolean };
  plan: VideoCreativePlan | null;
  result: {
    videoUrl: string;          // 客户端访问的 /api/storage/... 直链
    rawVideoUrl: string;       // Seedance 原始 URL（短时效）
    objectPath: string | null;
    provider: string;
    seedanceTaskId: string;
    aspect: SeedanceAspect;
    durationSec: number;
    burnedSubtitles: boolean;
    burnFallbackReason?: string;
    costYuanEstimate: number;
    plan: VideoCreativePlan;
  } | null;
}

const MAX_CONCURRENT = 2;
const JOB_TTL_MS = 60 * 60 * 1000;
const jobs = new Map<string, VideoJob>();
const queue: string[] = [];
let runningCount = 0;

function gc(): void {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, j] of jobs) {
    if ((j.status === "succeeded" || j.status === "failed") && j.finishedAt !== null && j.finishedAt < cutoff) {
      jobs.delete(id);
    }
  }
}

async function processJob(job: VideoJob): Promise<void> {
  const seedance = SeedanceClient.fromEnv();
  if (!seedance) throw new Error("ARK_API_KEY 未配置，无法使用豆包 Seedance 视频生成");

  // step 1: 生成 brief
  job.status = "planning"; job.progress = 10;
  const plan = await generateVideoCreativePlan(job.input);
  job.plan = plan;
  job.progress = 30;

  // step 2: 调 Seedance 异步任务（i2v 引用图必须是公网可访问的绝对 URL）
  job.status = "generating";
  const refUrlAbs = absolutizePublicUrl(job.input.referenceVideo?.coverImageUrl ?? null);
  const seedRes = await seedance.generate({
    prompt: plan.videoPrompt,
    referenceImageUrl: refUrlAbs,
    aspect: plan.aspectRatio,
    durationSec: plan.durationSec,
    tier: job.input.tier ?? "lite",
    cameraFixed: plan.recommendedCameraFixed,
    watermark: false,
  });
  job.progress = 70;

  // step 3: 下载原始视频
  const rawRes = await fetch(seedRes.videoUrl);
  if (!rawRes.ok) throw new Error(`下载 Seedance 视频失败: ${rawRes.status}`);
  let videoBuf = Buffer.from(await rawRes.arrayBuffer());

  // step 4: ffmpeg 烧入字幕（可关）
  let burned = false;
  let burnFallbackReason: string | undefined;
  if (job.input.burnSubtitles !== false && plan.subtitleSegments.length > 0) {
    job.status = "composing"; job.progress = 80;
    const composed = await burnSubtitles({
      rawVideoBuffer: videoBuf,
      subtitleSegments: plan.subtitleSegments,
      aspectRatio: plan.aspectRatio,
    });
    videoBuf = composed.videoBuffer;
    burned = composed.burned;
    burnFallbackReason = composed.fallbackReason;
  }

  // step 5: 上传到 Object Storage
  job.status = "uploading"; job.progress = 90;
  const uploadURL = await objectStorageService.getObjectEntityUploadURL();
  const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
  const upRes = await fetch(uploadURL, {
    method: "PUT",
    body: videoBuf,
    headers: { "Content-Type": "video/mp4" },
  });
  if (!upRes.ok) throw new Error("视频已生成但上传到对象存储失败");
  const storedUrl = `/api/storage${objectPath}`;

  job.result = {
    videoUrl: storedUrl,
    rawVideoUrl: seedRes.videoUrl,
    objectPath,
    provider: seedRes.model,
    seedanceTaskId: seedRes.taskId,
    aspect: seedRes.aspect,
    durationSec: seedRes.videoDurationSec,
    burnedSubtitles: burned,
    burnFallbackReason,
    costYuanEstimate: seedRes.costYuanEstimate,
    plan,
  };
  job.status = "succeeded";
  job.progress = 100;
}

async function tick(): Promise<void> {
  while (runningCount < MAX_CONCURRENT && queue.length > 0) {
    const id = queue.shift()!;
    const job = jobs.get(id);
    if (!job || job.status !== "queued") continue;
    runningCount++;
    job.startedAt = Date.now();
    processJob(job)
      .catch((err: any) => {
        job.status = "failed";
        job.error = err?.message ?? "unknown";
        logger.error({ err: err?.message, jobId: id, userId: job.userId }, "video job failed");
        // 失败自动退款
        const refundAmount = CREDIT_COSTS["ai-generate-video"] ?? 0;
        if (refundAmount > 0) {
          refundCredits(job.userId, refundAmount, "ai-generate-video", (err?.message ?? "unknown").slice(0, 80))
            .catch((rErr: any) => logger.error({ err: rErr?.message, userId: job.userId }, "refund failed"));
        }
      })
      .finally(() => {
        job.finishedAt = Date.now();
        runningCount--;
        gc();
        setImmediate(() => { void tick(); });
      });
  }
}

export function enqueueVideoJob(
  userId: number,
  input: GenerateVideoPlanInput & { tier?: "lite" | "pro"; burnSubtitles?: boolean },
): { job: VideoJob; created: boolean } {
  gc();
  // 单用户最多 1 个排队/运行中 — 命中已有任务时 created=false，路由层据此判断不重复扣费
  for (const j of jobs.values()) {
    if (j.userId === userId && (j.status !== "succeeded" && j.status !== "failed")) {
      return { job: j, created: false };
    }
  }
  const id = randomUUID();
  const job: VideoJob = {
    id, userId, status: "queued", progress: 0,
    createdAt: Date.now(), startedAt: null, finishedAt: null,
    error: null, input, plan: null, result: null,
  };
  jobs.set(id, job);
  queue.push(id);
  setImmediate(() => { void tick(); });
  return { job, created: true };
}

export function getVideoJob(jobId: string, userId: number): VideoJob | null {
  const j = jobs.get(jobId);
  if (!j || j.userId !== userId) return null;
  return j;
}
