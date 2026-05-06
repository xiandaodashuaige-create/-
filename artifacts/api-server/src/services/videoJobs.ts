import { randomUUID } from "node:crypto";
import { eq, and, inArray, lt } from "drizzle-orm";
import { db, videoJobsTable, type VideoJobRow } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { SeedanceClient, type SeedanceAspect } from "./seedance.js";
import { SoraClient, type SoraSize } from "./sora.js";
import { generateVideoCreativePlan, type GenerateVideoPlanInput, type VideoCreativePlan } from "./videoPipeline.js";
import { burnSubtitles } from "./videoComposer.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { refundCredits, CREDIT_COSTS } from "../middlewares/creditSystem.js";

export type VideoProvider = "seedance" | "sora-pro";

const objectStorageService = new ObjectStorageService();

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
 * 视频生成异步任务（DB 持久化版）。
 * - 单进程并发上限 MAX_CONCURRENT
 * - 单用户最多 1 个 in-flight（去重）
 * - 进程重启后 cron tick 会捡起 queued/* 中间态任务继续推进，避免任务丢失
 */

export type VideoJobStatus = "queued" | "planning" | "generating" | "composing" | "uploading" | "succeeded" | "failed";

export interface VideoJob {
  id: string;
  userId: number;
  status: VideoJobStatus;
  progress: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  input: GenerateVideoPlanInput & { tier?: "lite" | "pro"; burnSubtitles?: boolean; provider?: VideoProvider };
  plan: VideoCreativePlan | null;
  result: {
    videoUrl: string;
    rawVideoUrl: string;
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
const STALE_RECLAIM_MS = 15 * 60 * 1000; // 中间态超过 15 分钟视为崩溃 → 回收
const inFlight = new Set<string>();

function rowToJob(row: VideoJobRow): VideoJob {
  return {
    id: row.id,
    userId: row.ownerUserId,
    status: row.status as VideoJobStatus,
    progress: row.progress,
    createdAt: row.createdAt.getTime(),
    startedAt: row.startedAt?.getTime() ?? null,
    finishedAt: row.finishedAt?.getTime() ?? null,
    error: row.error,
    input: row.input as unknown as VideoJob["input"],
    plan: (row.plan as unknown as VideoCreativePlan | null) ?? null,
    result: (row.result as unknown as VideoJob["result"]) ?? null,
  };
}

async function patchJob(id: string, patch: Partial<VideoJobRow>): Promise<void> {
  await db.update(videoJobsTable).set(patch).where(eq(videoJobsTable.id, id));
}

async function processJob(jobId: string): Promise<void> {
  const [row0] = await db.select().from(videoJobsTable).where(eq(videoJobsTable.id, jobId));
  if (!row0) throw new Error("job_not_found");
  const input = row0.input as unknown as VideoJob["input"];
  const provider: VideoProvider = input.provider ?? "seedance";

  await patchJob(jobId, { status: "planning", progress: 10, startedAt: row0.startedAt ?? new Date() });
  const plan = await generateVideoCreativePlan(input);
  await patchJob(jobId, { plan: plan as any, progress: 30, status: "generating" });

  let videoBuf: Buffer;
  let rawVideoUrl: string;
  let providerTaskId: string;
  let providerModel: string;
  let aspect: SeedanceAspect = plan.aspectRatio;
  let durationSec: number = plan.durationSec;
  let costYuanEstimate: number;

  if (provider === "sora-pro") {
    const sora = SoraClient.fromEnv();
    if (!sora) throw new Error("OPENAI_API_KEY 未配置，无法使用 Sora 2 Pro 视频生成");
    // Sora 高清档：默认 12s 1080p；竖屏(9:16) → 1024x1792；横屏(16:9) → 1792x1024；其它 → 竖屏兜底
    const isLandscape = plan.aspectRatio === "16:9" || plan.aspectRatio === "4:3";
    const soraSize: SoraSize = isLandscape ? "1792x1024" : "1024x1792";
    const soraSeconds = 12;
    const soraRes = await sora.generate({ prompt: plan.videoPrompt, seconds: soraSeconds, size: soraSize });
    videoBuf = soraRes.videoBuffer;
    rawVideoUrl = `openai://videos/${soraRes.taskId}`;
    providerTaskId = soraRes.taskId;
    providerModel = soraRes.model;
    durationSec = soraRes.videoDurationSec;
    aspect = isLandscape ? "16:9" : "9:16";
    // Sora $0.50/s @ 1080p ≈ 3.6 RMB/s → 12s ≈ 43 元
    costYuanEstimate = +(soraRes.costUsdEstimate * 7.2).toFixed(2);
  } else {
    const seedance = SeedanceClient.fromEnv();
    if (!seedance) throw new Error("ARK_API_KEY 未配置，无法使用豆包 Seedance 视频生成");
    const refUrlAbs = absolutizePublicUrl(input.referenceVideo?.coverImageUrl ?? null);
    const seedRes = await seedance.generate({
      prompt: plan.videoPrompt,
      referenceImageUrl: refUrlAbs,
      aspect: plan.aspectRatio,
      durationSec: plan.durationSec,
      tier: input.tier ?? "lite",
      cameraFixed: plan.recommendedCameraFixed,
      watermark: false,
    });
    const rawRes = await fetch(seedRes.videoUrl);
    if (!rawRes.ok) throw new Error(`下载 Seedance 视频失败: ${rawRes.status}`);
    videoBuf = Buffer.from(new Uint8Array(await rawRes.arrayBuffer()));
    rawVideoUrl = seedRes.videoUrl;
    providerTaskId = seedRes.taskId;
    providerModel = seedRes.model;
    aspect = seedRes.aspect;
    durationSec = seedRes.videoDurationSec;
    costYuanEstimate = seedRes.costYuanEstimate;
  }
  await patchJob(jobId, { progress: 70 });

  let burned = false;
  let burnFallbackReason: string | undefined;
  // Sora 自带电影级镜头与无字幕原片，按客户偏好仍可烧字幕；默认开启
  if (input.burnSubtitles !== false && plan.subtitleSegments.length > 0) {
    await patchJob(jobId, { status: "composing", progress: 80 });
    const composed = await burnSubtitles({
      rawVideoBuffer: videoBuf,
      subtitleSegments: plan.subtitleSegments,
      aspectRatio: aspect,
    });
    videoBuf = composed.videoBuffer;
    burned = composed.burned;
    burnFallbackReason = composed.fallbackReason;
  }

  await patchJob(jobId, { status: "uploading", progress: 90 });
  const uploadURL = await objectStorageService.getObjectEntityUploadURL();
  const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
  const upRes = await fetch(uploadURL, {
    method: "PUT",
    body: videoBuf,
    headers: { "Content-Type": "video/mp4" },
  });
  if (!upRes.ok) throw new Error("视频已生成但上传到对象存储失败");
  const storedUrl = `/api/storage${objectPath}`;

  const result = {
    videoUrl: storedUrl,
    rawVideoUrl,
    objectPath,
    provider: providerModel,
    seedanceTaskId: providerTaskId,
    aspect,
    durationSec,
    burnedSubtitles: burned,
    burnFallbackReason,
    costYuanEstimate,
    plan,
  };

  await patchJob(jobId, {
    status: "succeeded",
    progress: 100,
    result: result as any,
    finishedAt: new Date(),
  });
}

async function tryRunJob(jobId: string, userId: number): Promise<void> {
  if (inFlight.has(jobId)) return;
  inFlight.add(jobId);
  try {
    await processJob(jobId);
  } catch (err: any) {
    const msg = err?.message ?? "unknown";
    logger.error({ err: msg, jobId, userId }, "video job failed");
    try {
      // 失败自动退款（幂等：credits_refunded 已置位则跳过）
      const [cur] = await db.select().from(videoJobsTable).where(eq(videoJobsTable.id, jobId));
      if (cur && cur.creditsRefunded === 0) {
        const curInput = cur.input as unknown as VideoJob["input"];
        const opKey = curInput?.provider === "sora-pro" ? "ai-generate-video-sora" : "ai-generate-video";
        const refundAmount = CREDIT_COSTS[opKey] ?? 0;
        if (refundAmount > 0) {
          await refundCredits(userId, refundAmount, opKey, String(msg).slice(0, 80));
        }
        await patchJob(jobId, { creditsRefunded: 1 });
      }
    } catch (rErr: any) {
      logger.error({ err: rErr?.message, userId, jobId }, "refund failed");
    }
    await patchJob(jobId, {
      status: "failed",
      error: String(msg).slice(0, 500),
      finishedAt: new Date(),
    });
  } finally {
    inFlight.delete(jobId);
  }
}

/**
 * Cron tick：捡起 queued + 在中间态超过 STALE_RECLAIM_MS 的任务继续推进。
 * 单实例进程内并发上限 MAX_CONCURRENT。
 */
export async function runVideoJobsTick(): Promise<void> {
  const slots = MAX_CONCURRENT - inFlight.size;
  if (slots <= 0) return;

  const staleCutoff = new Date(Date.now() - STALE_RECLAIM_MS);
  const candidates = await db
    .select()
    .from(videoJobsTable)
    .where(
      and(
        inArray(videoJobsTable.status, ["queued", "planning", "generating", "composing", "uploading"]),
      ),
    )
    .limit(slots * 4);

  let started = 0;
  for (const row of candidates) {
    if (started >= slots) break;
    if (inFlight.has(row.id)) continue;
    // 中间态需要超过 stale cutoff 才能重抢；queued 直接拿
    if (row.status !== "queued" && (!row.startedAt || row.startedAt > staleCutoff)) continue;
    started++;
    void tryRunJob(row.id, row.ownerUserId);
  }
}

export async function enqueueVideoJob(
  userId: number,
  input: GenerateVideoPlanInput & { tier?: "lite" | "pro"; burnSubtitles?: boolean; provider?: VideoProvider },
): Promise<{ job: VideoJob; created: boolean }> {
  // 单用户去重：找到 in-flight 任务直接返回
  const inflightRows = await db
    .select()
    .from(videoJobsTable)
    .where(
      and(
        eq(videoJobsTable.ownerUserId, userId),
        inArray(videoJobsTable.status, ["queued", "planning", "generating", "composing", "uploading"]),
      ),
    )
    .limit(1);
  if (inflightRows[0]) {
    return { job: rowToJob(inflightRows[0]), created: false };
  }

  const id = randomUUID();
  const [row] = await db
    .insert(videoJobsTable)
    .values({
      id,
      ownerUserId: userId,
      status: "queued",
      progress: 0,
      input: input as unknown as Record<string, unknown>,
    })
    .returning();

  setImmediate(() => { void runVideoJobsTick(); });
  return { job: rowToJob(row), created: true };
}

export async function getVideoJob(jobId: string, userId: number): Promise<VideoJob | null> {
  const [row] = await db
    .select()
    .from(videoJobsTable)
    .where(and(eq(videoJobsTable.id, jobId), eq(videoJobsTable.ownerUserId, userId)));
  return row ? rowToJob(row) : null;
}

/** 仅供测试：清理超过 N 天的终态任务，避免 video_jobs 表无限增长 */
export async function gcOldVideoJobs(olderThanDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const res = await db
    .delete(videoJobsTable)
    .where(
      and(
        inArray(videoJobsTable.status, ["succeeded", "failed"]),
        lt(videoJobsTable.updatedAt, cutoff),
      ),
    );
  return (res as any)?.rowCount ?? 0;
}
