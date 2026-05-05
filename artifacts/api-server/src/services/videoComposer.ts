import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "../lib/logger.js";
import type { SubtitleSegment } from "./videoPipeline.js";

/**
 * ffmpeg 后期合成：把字幕（.ass）烧入 Seedance 原始视频。
 *  - 输入: rawVideoBuffer（mp4） + subtitleSegments
 *  - 输出: composed mp4 buffer
 *  - emoji: 写在字幕段 text 中即可，依赖系统字体（Noto Color Emoji 在 Replit nix 容器中可用）
 *  - BGM: MVP 不混音（无授权 BGM 库），由前端在 CapCut/抖音剪辑器自行叠加
 */

function secToAssTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec - Math.floor(sec)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function escapeAssText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\n/g, "\\N");
}

function buildAss(segments: SubtitleSegment[], videoWidth: number, videoHeight: number): string {
  // 三档样式：hook=大字粗黑居中带描边/CTA=底部彩色/normal=底部白字黑边
  const styles = [
    // Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment(2=底部居中,5=正中央,8=顶部居中), MarginV
    `Style: hook,Noto Sans CJK SC,${Math.round(videoHeight * 0.075)},&H00FFFFFF,&H00000000,&H66000000,1,1,4,2,5,80`,
    `Style: normal,Noto Sans CJK SC,${Math.round(videoHeight * 0.045)},&H00FFFFFF,&H00000000,&H66000000,1,1,3,1,2,${Math.round(videoHeight * 0.06)}`,
    `Style: cta,Noto Sans CJK SC,${Math.round(videoHeight * 0.06)},&H0000F0FF,&H00000000,&H66000000,1,1,4,2,2,${Math.round(videoHeight * 0.08)}`,
  ].join("\n");

  const events = segments.map((s) => {
    const start = secToAssTime(s.startSec);
    const end = secToAssTime(s.endSec);
    const styleName = s.style === "hook" ? "hook" : s.style === "cta" ? "cta" : "normal";
    return `Dialogue: 0,${start},${end},${styleName},,0,0,0,,${escapeAssText(s.text)}`;
  }).join("\n");

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginV
${styles}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}
`;
}

function aspectToWh(aspect: string): { w: number; h: number } {
  switch (aspect) {
    case "16:9": return { w: 1280, h: 720 };
    case "1:1": return { w: 720, h: 720 };
    case "4:3": return { w: 960, h: 720 };
    case "3:4": return { w: 720, h: 960 };
    case "9:16":
    default: return { w: 720, h: 1280 };
  }
}

async function runFfmpeg(args: string[], log?: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else {
        (log || logger).warn({ code, stderr: stderr.slice(-800) }, "ffmpeg failed");
        reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-200)}`));
      }
    });
  });
}

export interface BurnSubtitlesInput {
  rawVideoBuffer: Buffer;
  subtitleSegments: SubtitleSegment[];
  aspectRatio: string;
}

export interface BurnSubtitlesResult {
  videoBuffer: Buffer;
  durationMs: number;
  burned: boolean;
  fallbackReason?: string;
}

export async function burnSubtitles(input: BurnSubtitlesInput, log?: any): Promise<BurnSubtitlesResult> {
  const start = Date.now();
  if (!input.subtitleSegments || input.subtitleSegments.length === 0) {
    return { videoBuffer: input.rawVideoBuffer, durationMs: 0, burned: false, fallbackReason: "no segments" };
  }

  const { w, h } = aspectToWh(input.aspectRatio);
  const dir = await mkdtemp(join(tmpdir(), "videocomp-"));
  const inPath = join(dir, "in.mp4");
  const assPath = join(dir, "subs.ass");
  const outPath = join(dir, "out.mp4");

  try {
    await writeFile(inPath, input.rawVideoBuffer);
    await writeFile(assPath, buildAss(input.subtitleSegments, w, h), "utf8");

    // libass 字幕滤镜 — escape colons/backslashes for ffmpeg filter syntax
    const escapedAss = assPath.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
    const args = [
      "-y", "-loglevel", "error",
      "-i", inPath,
      "-vf", `ass=${escapedAss}`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-c:a", "copy",
      "-movflags", "+faststart",
      outPath,
    ];
    await runFfmpeg(args, log);
    const out = await readFile(outPath);
    return { videoBuffer: out, durationMs: Date.now() - start, burned: true };
  } catch (err: any) {
    (log || logger).warn({ err: err?.message }, "burnSubtitles failed, returning raw video");
    return {
      videoBuffer: input.rawVideoBuffer,
      durationMs: Date.now() - start,
      burned: false,
      fallbackReason: err?.message ?? "ffmpeg error",
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
