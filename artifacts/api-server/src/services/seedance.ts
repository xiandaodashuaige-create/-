import { logger } from "../lib/logger.js";

/**
 * 豆包 Seedance（火山方舟）视频生成 — 全网最便宜的大厂方案。
 *  - Lite t2v/i2v: 0.025 元/秒 @ 720p（默认 5s 视频 ≈ 0.13 元）
 *  - Pro:         0.05  元/秒 @ 1080p
 *
 * API 是异步任务模式：
 *   POST /api/v3/contents/generations/tasks  → { id, status }
 *   GET  /api/v3/contents/generations/tasks/{id}  → 轮询直到 status=succeeded
 */

const ARK_BASE = "https://ark.cn-beijing.volces.com/api/v3";
const TASK_ENDPOINT = `${ARK_BASE}/contents/generations/tasks`;

const MODEL_T2V_LITE = process.env.SEEDANCE_T2V_MODEL || "doubao-seedance-1-0-lite-t2v-250428";
const MODEL_I2V_LITE = process.env.SEEDANCE_I2V_MODEL || "doubao-seedance-1-0-lite-i2v-250428";
const MODEL_T2V_PRO = process.env.SEEDANCE_PRO_MODEL || "doubao-seedance-1-0-pro-250528";

export type SeedanceAspect = "9:16" | "16:9" | "1:1" | "4:3" | "3:4";
export type SeedanceTier = "lite" | "pro";

export interface SeedanceGenerateInput {
  prompt: string;
  /** 提供 referenceImageUrl 时走 i2v（首帧图生视频），否则走 t2v */
  referenceImageUrl?: string | null;
  aspect?: SeedanceAspect;       // 默认 9:16
  durationSec?: 5 | 10;          // Lite 仅支持 5；Pro 支持 5/10
  tier?: SeedanceTier;           // 默认 lite
  resolution?: "480p" | "720p" | "1080p"; // Lite 默认 720p, Pro 默认 1080p
  cameraFixed?: boolean;          // true = 固定镜头
  watermark?: boolean;            // 默认 false
  seed?: number;
}

export interface SeedanceResult {
  videoUrl: string;
  taskId: string;
  durationMs: number;
  model: string;
  aspect: SeedanceAspect;
  videoDurationSec: number;
  costYuanEstimate: number;
}

export class SeedanceClient {
  constructor(private readonly apiKey: string) {}

  static fromEnv(): SeedanceClient | null {
    const key = process.env.ARK_API_KEY;
    if (!key) return null;
    return new SeedanceClient(key);
  }

  private pickModel(input: SeedanceGenerateInput): string {
    if (input.tier === "pro") return MODEL_T2V_PRO;
    return input.referenceImageUrl ? MODEL_I2V_LITE : MODEL_T2V_LITE;
  }

  private buildContent(input: SeedanceGenerateInput): any[] {
    // 把 aspect / resolution / camerafixed / 时长写进 prompt 末尾的 --tag 控制串
    const aspect = input.aspect ?? "9:16";
    const dur = input.durationSec ?? 5;
    const res = input.resolution ?? (input.tier === "pro" ? "1080p" : "720p");
    const camera = input.cameraFixed ? " --camerafixed true" : "";
    const wm = input.watermark === true ? " --watermark true" : " --watermark false";
    const seed = input.seed != null ? ` --seed ${input.seed}` : "";

    const fullPrompt = `${input.prompt}\n--ratio ${aspect} --resolution ${res} --duration ${dur}${camera}${wm}${seed}`.trim();

    const content: any[] = [{ type: "text", text: fullPrompt }];
    if (input.referenceImageUrl) {
      content.push({ type: "image_url", image_url: { url: input.referenceImageUrl } });
    }
    return content;
  }

  async createTask(input: SeedanceGenerateInput, log?: any): Promise<{ taskId: string; model: string }> {
    const model = this.pickModel(input);
    const body = { model, content: this.buildContent(input) };

    (log || logger).info({ model, hasRef: !!input.referenceImageUrl, aspect: input.aspect, dur: input.durationSec }, "Seedance: creating video task");

    const res = await fetch(TASK_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Seedance create task ${res.status}: ${text.slice(0, 300)}`);
    }
    const data: any = await res.json();
    if (!data?.id) throw new Error("Seedance returned no task id");
    return { taskId: data.id, model };
  }

  async pollTask(taskId: string, log?: any, opts: { intervalMs?: number; timeoutMs?: number } = {}): Promise<{ videoUrl: string; raw: any }> {
    const interval = opts.intervalMs ?? 4000;
    const timeout = opts.timeoutMs ?? 8 * 60 * 1000; // 8 min hard cap
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const res = await fetch(`${TASK_ENDPOINT}/${taskId}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Seedance poll ${res.status}: ${text.slice(0, 200)}`);
      }
      const data: any = await res.json();
      const status = data?.status;
      if (status === "succeeded") {
        const url = data?.content?.video_url;
        if (!url) throw new Error("Seedance succeeded but no video_url");
        return { videoUrl: url, raw: data };
      }
      if (status === "failed" || status === "cancelled") {
        throw new Error(`Seedance task ${status}: ${data?.error?.message ?? "unknown"}`);
      }
      (log || logger).debug({ taskId, status }, "Seedance: still generating");
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error(`Seedance task timeout after ${Math.round((Date.now() - start) / 1000)}s`);
  }

  async generate(input: SeedanceGenerateInput, log?: any): Promise<SeedanceResult> {
    const start = Date.now();
    const { taskId, model } = await this.createTask(input, log);
    const { videoUrl } = await this.pollTask(taskId, log);
    const dur = input.durationSec ?? 5;
    const aspect = input.aspect ?? "9:16";
    const isPro = input.tier === "pro";
    const costYuanEstimate = +(dur * (isPro ? 0.05 : 0.025)).toFixed(3);
    return {
      videoUrl,
      taskId,
      durationMs: Date.now() - start,
      model,
      aspect,
      videoDurationSec: dur,
      costYuanEstimate,
    };
  }
}
