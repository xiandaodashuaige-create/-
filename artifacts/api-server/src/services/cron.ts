import { logger } from "../lib/logger.js";
import { runDailyTrackingJob } from "./noteTracking.js";
import { runPublishDispatcher } from "./publishDispatcher.js";
import { recomputeAllCategoryProfiles } from "./categoryTraining.js";
import { runAutoSyncStaleCompetitors } from "./autoOnboarding.js";

const HOUR_MS = 60 * 60 * 1000;
const TRACKING_INTERVAL_MS = 12 * HOUR_MS;
const PUBLISH_INTERVAL_MS = 60 * 1000;
const CATEGORY_TRAINING_INTERVAL_MS = 6 * HOUR_MS;
const AUTO_SYNC_INTERVAL_MS = 24 * HOUR_MS;

let trackingTimer: NodeJS.Timeout | null = null;
let publishTimer: NodeJS.Timeout | null = null;
let categoryTrainingTimer: NodeJS.Timeout | null = null;
let autoSyncTimer: NodeJS.Timeout | null = null;
let isRunning = false;
let isCategoryTrainingRunning = false;
let isAutoSyncRunning = false;

async function safeRunAutoSync(label: string): Promise<void> {
  if (isAutoSyncRunning) {
    logger.warn({ label }, "Auto-sync already running, skip this tick");
    return;
  }
  isAutoSyncRunning = true;
  const startedAt = Date.now();
  try {
    const r = await runAutoSyncStaleCompetitors();
    logger.info({ label, ...r, durationMs: Date.now() - startedAt }, "Auto-sync stale competitors tick done");
  } catch (e: any) {
    logger.error({ err: e?.message, label }, "Auto-sync failed");
  } finally {
    isAutoSyncRunning = false;
  }
}

async function safeRunCategoryTraining(label: string): Promise<void> {
  if (isCategoryTrainingRunning) {
    logger.warn({ label }, "Category training already running, skip this tick");
    return;
  }
  isCategoryTrainingRunning = true;
  const startedAt = Date.now();
  try {
    const { refreshed } = await recomputeAllCategoryProfiles();
    logger.info({ label, refreshed, durationMs: Date.now() - startedAt }, "Category training tick done");
  } catch (e: any) {
    logger.error({ err: e?.message, label }, "Category training failed");
  } finally {
    isCategoryTrainingRunning = false;
  }
}

/**
 * 进程内单实例 cron。
 * 限制：仅适用于单实例部署。多实例时会重复抓取（应改用 DB lock 或外部调度器）。
 * 安全保护：isRunning 标志防止重叠执行。
 */
async function safeRun(label: string): Promise<void> {
  if (isRunning) {
    logger.warn({ label }, "Tracking job already running, skip this tick");
    return;
  }
  isRunning = true;
  const startedAt = Date.now();
  try {
    await runDailyTrackingJob();
  } catch (e: any) {
    logger.error({ err: e?.message, label }, "Tracking job failed");
  } finally {
    isRunning = false;
    logger.info({ label, durationMs: Date.now() - startedAt }, "Tracking job tick done");
  }
}

export function startCronJobs(): void {
  if (trackingTimer) return;

  setTimeout(() => safeRun("initial"), 30_000);
  trackingTimer = setInterval(() => safeRun("scheduled"), TRACKING_INTERVAL_MS);

  // 每分钟扫描一次到期的多平台 schedule，分流到 ayrshare / meta / tiktok
  setTimeout(() => runPublishDispatcher(), 15_000);
  publishTimer = setInterval(() => runPublishDispatcher(), PUBLISH_INTERVAL_MS);

  // 每 6 小时刷新一次「全平台多类目训练画像」（跨用户聚合，让平台越用越聪明）
  setTimeout(() => safeRunCategoryTraining("initial"), 90_000);
  categoryTrainingTimer = setInterval(() => safeRunCategoryTraining("scheduled"), CATEGORY_TRAINING_INTERVAL_MS);

  // 每 24 小时自动续航：找出陈旧的同行 profile，自动重新抓取最新作品（无需用户点击）
  setTimeout(() => safeRunAutoSync("initial"), 120_000);
  autoSyncTimer = setInterval(() => safeRunAutoSync("scheduled"), AUTO_SYNC_INTERVAL_MS);

  logger.info(
    {
      trackingHours: TRACKING_INTERVAL_MS / HOUR_MS,
      publishSeconds: PUBLISH_INTERVAL_MS / 1000,
      categoryTrainingHours: CATEGORY_TRAINING_INTERVAL_MS / HOUR_MS,
      autoSyncHours: AUTO_SYNC_INTERVAL_MS / HOUR_MS,
    },
    "Cron jobs started (single-instance)",
  );
}

export function stopCronJobs(): void {
  if (trackingTimer) { clearInterval(trackingTimer); trackingTimer = null; }
  if (publishTimer) { clearInterval(publishTimer); publishTimer = null; }
  if (categoryTrainingTimer) { clearInterval(categoryTrainingTimer); categoryTrainingTimer = null; }
  if (autoSyncTimer) { clearInterval(autoSyncTimer); autoSyncTimer = null; }
}
