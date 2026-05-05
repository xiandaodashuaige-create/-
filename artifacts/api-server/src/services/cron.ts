import { logger } from "../lib/logger.js";
import { runDailyTrackingJob } from "./noteTracking.js";

const HOUR_MS = 60 * 60 * 1000;
const TRACKING_INTERVAL_MS = 12 * HOUR_MS;

let trackingTimer: NodeJS.Timeout | null = null;
let isRunning = false;

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

  logger.info({ intervalHours: TRACKING_INTERVAL_MS / HOUR_MS }, "Cron jobs started (single-instance)");
}

export function stopCronJobs(): void {
  if (trackingTimer) {
    clearInterval(trackingTimer);
    trackingTimer = null;
  }
}
