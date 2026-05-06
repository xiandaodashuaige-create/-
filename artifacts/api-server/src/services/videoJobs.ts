import { randomUUID } from "node:crypto";
import { eq, and, inArray, lt, gte, sql } from "drizzle-orm";
import { db, videoJobsTable, usersTable, creditTransactionsTable, type VideoJobRow } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { SeedanceClient, type SeedanceAspect } from "./seedance.js";
import { SoraClient, type SoraSize } from "./sora.js";
import { generateVideoCreativePlan, type GenerateVideoPlanInput, type VideoCreativePlan } from "./videoPipeline.js";
import { burnSubtitles } from "./videoComposer.js";
import { ObjectStorageService } from "../lib/objectStorage.js";

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

/**
 * 单事务原子退款：抢门闩 + 加余额 + 写流水 三步在同一个 db.transaction 内。
 * 任何一步抛错 → 整个 tx 回滚（包括 credits_refunded=1 的门闩自动归零），
 * 无需手动补偿。这是积分守恒的核心保证：避免"半失败回滚门闩 → 下次 reconcile
 * 重抢 → 余额加两次"造币漏洞。
 *
 * 返回 { refunded: true } 当且仅当本次调用真正完成了退款；其它情况（门闩已被
 * 别人抢走 / chargedAmount<=0）返回 { refunded: false }。
 */
async function claimAndRefundAtomic(
  jobId: string,
  userId: number,
  reason: string,
): Promise<{ refunded: boolean; amount: number }> {
  try {
    return await db.transaction(async (tx) => {
      // 1) CAS 抢门闩
      const claimed = await tx
        .update(videoJobsTable)
        .set({ creditsRefunded: 1 })
        .where(and(eq(videoJobsTable.id, jobId), eq(videoJobsTable.creditsRefunded, 0)))
        .returning({ chargedAmount: videoJobsTable.chargedAmount, input: videoJobsTable.input });
      if (!claimed[0]) return { refunded: false, amount: 0 };
      const amount = claimed[0].chargedAmount;
      // chargedAmount<=0（dedup hit / admin / 漏扣）：门闩闭合但不退款，避免造币
      if (amount <= 0) return { refunded: false, amount: 0 };

      // 2) 加余额（同事务内）
      const upd = await tx
        .update(usersTable)
        .set({
          credits: sql`${usersTable.credits} + ${amount}`,
          totalCreditsUsed: sql`GREATEST(0, ${usersTable.totalCreditsUsed} - ${amount})`,
        })
        .where(eq(usersTable.id, userId))
        .returning({ newCredits: usersTable.credits });
      if (!upd[0]) {
        // user 不存在 → 抛错让 tx 回滚（包含门闩）
        throw new Error(`refund target user ${userId} not found`);
      }

      // 3) 写流水（同事务内）
      const curInput = claimed[0].input as unknown as VideoJob["input"];
      const opKey = curInput?.provider === "sora-pro" ? "ai-generate-video-sora" : "ai-generate-video";
      await tx.insert(creditTransactionsTable).values({
        userId,
        amount,
        balanceAfter: upd[0].newCredits,
        type: "refund",
        operationType: opKey,
        description: `失败自动退款：${reason}`.slice(0, 200),
      });

      return { refunded: true, amount };
    });
  } catch (err: any) {
    // tx 已自动回滚（门闩归零），只需记日志；下次 reconcile tick 会重试
    logger.error({ err: err?.message, jobId, userId }, "claimAndRefundAtomic tx rolled back; will retry via cron");
    return { refunded: false, amount: 0 };
  }
}

async function tryRunJob(jobId: string, userId: number): Promise<void> {
  if (inFlight.has(jobId)) return;
  inFlight.add(jobId);
  try {
    await processJob(jobId);
  } catch (err: any) {
    const msg = err?.message ?? "unknown";
    logger.error({ err: msg, jobId, userId }, "video job failed");
    // 顺序很重要：先标 failed，再退款。否则若 patchJob 失败，job 卡在中间态但已退款 →
    // stale 重抢会再跑一次（漏收入）。先 failed 后退款时：patchJob 失败 → 无退款，
    // stale 重抢可继续推进；patchJob 成功后退款失败 → reconcile cron 兜底。
    await patchJob(jobId, {
      status: "failed",
      error: String(msg).slice(0, 500),
      finishedAt: new Date(),
    });
    await claimAndRefundAtomic(jobId, userId, String(msg).slice(0, 80));
  } finally {
    inFlight.delete(jobId);
  }
}

/**
 * 退款兜底：扫 status='failed' AND charged_amount>=1 AND credits_refunded=0 的任务，补退。
 * 防止 claimAndRefundAtomic 整段事务瞬时失败（连接断/死锁）后无重试，长尾积分黑洞。
 */
export async function reconcileFailedRefunds(): Promise<{ checked: number; refunded: number; errors: number }> {
  const stuck = await db
    .select({ id: videoJobsTable.id, ownerUserId: videoJobsTable.ownerUserId })
    .from(videoJobsTable)
    .where(
      and(
        eq(videoJobsTable.status, "failed"),
        eq(videoJobsTable.creditsRefunded, 0),
        gte(videoJobsTable.chargedAmount, 1),
      ),
    )
    .limit(50);

  let refunded = 0;
  let errors = 0;
  for (const j of stuck) {
    try {
      const r = await claimAndRefundAtomic(j.id, j.ownerUserId, "reconcile_failed_refund");
      if (r.refunded) refunded++;
    } catch (e: any) {
      errors++;
      logger.error({ err: e?.message, jobId: j.id }, "reconcile loop error");
    }
  }
  if (stuck.length > 0) {
    logger.info({ checked: stuck.length, refunded, errors }, "reconcileFailedRefunds done");
  }
  return { checked: stuck.length, refunded, errors };
}

export async function runVideoJobsTick(): Promise<void> {
  // 先跑退款兜底（便宜的 SELECT，不影响并发槽位）
  try { await reconcileFailedRefunds(); }
  catch (e: any) { logger.error({ err: e?.message }, "reconcileFailedRefunds threw"); }

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

export class InsufficientCreditsError extends Error {
  constructor(public required: number, public available: number) {
    super(`insufficient_credits: required=${required} available=${available}`);
    this.name = "InsufficientCreditsError";
  }
}

export async function enqueueVideoJob(
  userId: number,
  input: GenerateVideoPlanInput & { tier?: "lite" | "pro"; burnSubtitles?: boolean; provider?: VideoProvider },
  charge?: { amount: number; opKey: string; isAdmin?: boolean },
): Promise<{ job: VideoJob; created: boolean }> {
  const id = randomUUID();

  // 把 in-flight 去重 + 扣费 + 插入 行 三步放在一个事务里，避免 dedup 命中却又扣了费 / 漏退款 等竞态
  const result = await db.transaction(async (tx) => {
    // 数据库级互斥：同一 userId 的 enqueue 串行化（事务结束自动释放）
    // 仅事务包裹不够：并发请求会同时通过 in-flight 检查 → 双扣费 + 双 job
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${userId})`);
    const inflightRows = await tx
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
      return { row: inflightRows[0], created: false as const };
    }

    let chargedAmount = 0;
    if (charge && charge.amount > 0 && !charge.isAdmin) {
      const updated = await tx
        .update(usersTable)
        .set({
          credits: sql`GREATEST(0, ${usersTable.credits} - ${charge.amount})`,
          totalCreditsUsed: sql`${usersTable.totalCreditsUsed} + ${charge.amount}`,
        })
        .where(and(eq(usersTable.id, userId), gte(usersTable.credits, charge.amount)))
        .returning({ newCredits: usersTable.credits });
      if (!updated.length) {
        const [u] = await tx.select({ credits: usersTable.credits }).from(usersTable).where(eq(usersTable.id, userId));
        throw new InsufficientCreditsError(charge.amount, u?.credits ?? 0);
      }
      await tx.insert(creditTransactionsTable).values({
        userId,
        amount: -charge.amount,
        balanceAfter: updated[0].newCredits,
        type: "deduct",
        operationType: charge.opKey,
        description: charge.opKey,
      });
      chargedAmount = charge.amount;
    }

    const [inserted] = await tx
      .insert(videoJobsTable)
      .values({
        id,
        ownerUserId: userId,
        status: "queued",
        progress: 0,
        input: input as unknown as Record<string, unknown>,
        chargedAmount,
      })
      .returning();
    return { row: inserted, created: true as const };
  });

  if (!result.created) {
    return { job: rowToJob(result.row), created: false };
  }
  const row = result.row;

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
