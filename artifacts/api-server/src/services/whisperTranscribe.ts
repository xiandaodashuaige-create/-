import { openai as client } from "@workspace/integrations-openai-ai-server";
import { logger } from "../lib/logger.js";

const MAX_BYTES = 25 * 1024 * 1024;

export async function transcribeVideoUrl(videoUrl: string, opts?: { language?: string }): Promise<string> {
  if (!videoUrl) throw new Error("videoUrl 必填");

  logger.info({ videoUrl: videoUrl.slice(0, 80) }, "Whisper: downloading video");
  const r = await fetch(videoUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Referer: "https://www.tiktok.com/",
    },
  });
  if (!r.ok) throw new Error(`视频下载失败 HTTP ${r.status}`);
  const ab = await r.arrayBuffer();
  if (ab.byteLength > MAX_BYTES) {
    throw new Error(
      `视频文件 ${(ab.byteLength / 1024 / 1024).toFixed(1)}MB 超过 Whisper 单次 25MB 上限`,
    );
  }
  const ct = r.headers.get("content-type") || "video/mp4";
  const ext = ct.includes("mp3") ? "mp3" : ct.includes("wav") ? "wav" : ct.includes("m4a") ? "m4a" : "mp4";
  const file = new File([ab], `competitor.${ext}`, { type: ct });

  logger.info({ bytes: ab.byteLength }, "Whisper: transcribing");
  const res = await client.audio.transcriptions.create({
    file,
    model: "whisper-1",
    response_format: "text",
    ...(opts?.language ? { language: opts.language } : {}),
  });
  const text = typeof res === "string" ? res : (res as { text?: string }).text || "";
  logger.info({ chars: text.length }, "Whisper: done");
  return text;
}
