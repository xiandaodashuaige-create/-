import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger.js";
import { runAutoOnboarding, type AutoOnboardingInput, type AutoOnboardingResult } from "./autoOnboarding.js";

/**
 * 进程内异步任务队列：避免 /run HTTP 同步等待 2-5 分钟。
 * - 客户调 POST /run 立即拿到 jobId
 * - 后台 worker 串行 runAutoOnboarding
 * - GET /status?jobId 拿进度/结果
 * - 全局并发上限 = 2，避免压垮 TikHub / XHS 数据源
 *
 * 限制：单实例内存。多实例部署需改 Redis/DB。
 */
export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface AutoOnboardingJob {
  id: string;
  userId: number;
  status: JobStatus;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  result: AutoOnboardingResult | null;
  error: string | null;
  input: Omit<AutoOnboardingInput, "userId">;
}

const MAX_CONCURRENT = 2;
const JOB_TTL_MS = 60 * 60 * 1000;

const jobs = new Map<string, AutoOnboardingJob>();
const queue: string[] = [];
let runningCount = 0;

function gc(): void {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, j] of jobs) {
    // 仅清理已终态（succeeded/failed）且超过 TTL 的任务，
    // 绝不删除 queued/running，避免长任务/堆积任务被 /status 查不到。
    if ((j.status === "succeeded" || j.status === "failed") && j.finishedAt !== null && j.finishedAt < cutoff) {
      jobs.delete(id);
    }
  }
}

async function tick(): Promise<void> {
  while (runningCount < MAX_CONCURRENT && queue.length > 0) {
    const id = queue.shift()!;
    const job = jobs.get(id);
    if (!job || job.status !== "queued") continue;
    runningCount++;
    job.status = "running";
    job.startedAt = Date.now();
    runAutoOnboarding({ userId: job.userId, ...job.input })
      .then((result) => {
        job.result = result;
        job.status = "succeeded";
      })
      .catch((err: any) => {
        job.error = err?.message ?? "unknown error";
        job.status = "failed";
        logger.error({ err: err?.message, jobId: id, userId: job.userId }, "auto-onboarding job failed");
      })
      .finally(() => {
        job.finishedAt = Date.now();
        runningCount--;
        gc();
        // schedule next
        setImmediate(() => { void tick(); });
      });
  }
}

export function enqueueAutoOnboarding(userId: number, input: Omit<AutoOnboardingInput, "userId">): AutoOnboardingJob {
  gc();
  // 限制单用户同时只能有一个排队/运行中的任务，避免重复触发
  for (const j of jobs.values()) {
    if (j.userId === userId && (j.status === "queued" || j.status === "running")) {
      return j;
    }
  }
  const id = randomUUID();
  const job: AutoOnboardingJob = {
    id, userId, status: "queued",
    createdAt: Date.now(), startedAt: null, finishedAt: null,
    result: null, error: null, input,
  };
  jobs.set(id, job);
  queue.push(id);
  setImmediate(() => { void tick(); });
  return job;
}

export function getAutoOnboardingJob(jobId: string, userId: number): AutoOnboardingJob | null {
  const j = jobs.get(jobId);
  if (!j) return null;
  if (j.userId !== userId) return null; // 越权保护
  return j;
}
