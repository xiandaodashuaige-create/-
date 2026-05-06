import { logger } from "../lib/logger.js";
import { fetchWithRetry } from "../lib/retry.js";

/**
 * OpenAI Sora 2 Pro 视频生成 — 高级电影级档位（仅 pro 用户使用）
 *
 *  - sora-2-pro: 1080p, 4-12s, 约 $0.30-0.50/秒
 *  - 12s 1080p ≈ $4-6 ≈ 28-42 RMB → 250 积分
 *
 * API 是异步任务模式：
 *   POST /v1/videos               → { id, status }
 *   GET  /v1/videos/{id}          → 轮询直到 status=completed
 *   GET  /v1/videos/{id}/content  → 二进制 MP4
 */

const OPENAI_BASE = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const SORA_MODEL = process.env.SORA_MODEL || "sora-2-pro";

export type SoraSize =
  | "1280x720"   // 720p landscape
  | "720x1280"   // 720p portrait
  | "1792x1024"  // 1080p landscape
  | "1024x1792"; // 1080p portrait

export interface SoraGenerateInput {
  prompt: string;
  seconds?: 4 | 6 | 8 | 10 | 12;
  size?: SoraSize;
}

export interface SoraResult {
  videoBuffer: Buffer;
  taskId: string;
  durationMs: number;
  model: string;
  size: SoraSize;
  videoDurationSec: number;
  costUsdEstimate: number;
}

export class SoraClient {
  constructor(private readonly apiKey: string) {}

  static fromEnv(): SoraClient | null {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return null;
    return new SoraClient(key);
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  async createTask(input: SoraGenerateInput, log?: any): Promise<{ taskId: string; size: SoraSize; seconds: number }> {
    const seconds = input.seconds ?? 12;
    const size: SoraSize = input.size ?? "1024x1792"; // 1080p portrait 默认（短视频）

    const body = {
      model: SORA_MODEL,
      prompt: input.prompt,
      seconds, // OpenAI Sora 接收数字
      size,
    };

    (log || logger).info({ model: SORA_MODEL, size, seconds }, "Sora: creating video task");

    // ⚠️ 创建任务是非幂等 POST,Sora API 不支持 Idempotency-Key。
    // 重试 = 可能在上游已扣费的情况下二次创建任务 → 双重扣费 + 双重视频。
    // 故此处不走重试,直接 fetch;429/5xx 让用户/调用方决定要不要重试。
    const res = await fetch(`${OPENAI_BASE}/videos`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Sora create task ${res.status}: ${text.slice(0, 400)}`);
    }
    const data: any = await res.json();
    if (!data?.id) throw new Error("Sora returned no task id");
    return { taskId: data.id, size, seconds };
  }

  async pollTask(
    taskId: string,
    log?: any,
    opts: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<{ status: string; raw: any }> {
    const interval = opts.intervalMs ?? 5000;
    const timeout = opts.timeoutMs ?? 12 * 60 * 1000; // Sora 1080p 比 Seedance 慢，留 12 min
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const res = await fetchWithRetry(
        () => fetch(`${OPENAI_BASE}/videos/${taskId}`, {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        }),
        { label: "sora.pollTask", log, maxRetries: 2 }, // 轮询本身就是循环,少重试避免叠加
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Sora poll ${res.status}: ${text.slice(0, 200)}`);
      }
      const data: any = await res.json();
      const status = data?.status;
      if (status === "completed") return { status, raw: data };
      if (status === "failed" || status === "cancelled") {
        const errMsg = data?.error?.message ?? data?.error ?? "unknown";
        throw new Error(`Sora task ${status}: ${typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg)}`);
      }
      (log || logger).debug({ taskId, status }, "Sora: still generating");
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error(`Sora task timeout after ${Math.round((Date.now() - start) / 1000)}s`);
  }

  async downloadContent(taskId: string): Promise<Buffer> {
    const res = await fetchWithRetry(
      () => fetch(`${OPENAI_BASE}/videos/${taskId}/content`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      }),
      { label: "sora.download" },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Sora download ${res.status}: ${text.slice(0, 200)}`);
    }
    const arr = await res.arrayBuffer();
    return Buffer.from(new Uint8Array(arr));
  }

  async generate(input: SoraGenerateInput, log?: any): Promise<SoraResult> {
    const start = Date.now();
    const { taskId, size, seconds } = await this.createTask(input, log);
    await this.pollTask(taskId, log);
    const videoBuffer = await this.downloadContent(taskId);

    // sora-2-pro 1080p ≈ $0.50/s; 720p ≈ $0.30/s
    const is1080p = size === "1792x1024" || size === "1024x1792";
    const usdPerSec = is1080p ? 0.5 : 0.3;
    const costUsdEstimate = +(seconds * usdPerSec).toFixed(2);

    return {
      videoBuffer,
      taskId,
      durationMs: Date.now() - start,
      model: SORA_MODEL,
      size,
      videoDurationSec: seconds,
      costUsdEstimate,
    };
  }
}
