import { and, eq, inArray, sql } from "drizzle-orm";
import { db, contentTable, competitorPostsTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "../lib/logger";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  analyzeCompetitorImage,
  generateImagePrompt,
  buildSeedreamPrompt,
  PLATFORM_VISUAL_PRESET,
} from "./imagePipeline";
import { loadBrandContext, brandStyleHint } from "./brandContext";

const objectStorageService = new ObjectStorageService();

async function uploadBuffer(buf: Buffer, contentType: string): Promise<string | null> {
  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    const r = await fetch(uploadURL, { method: "PUT", body: buf, headers: { "Content-Type": contentType } });
    if (!r.ok) return null;
    return `/api/storage${objectPath}`;
  } catch (err) {
    logger.warn({ err: (err as any)?.message }, "auto-media: storage upload failed");
    return null;
  }
}

async function generateGptImage(prompt: string, size: "1024x1024" | "1024x1536" | "1536x1024" = "1024x1536"): Promise<string | null> {
  try {
    const r = await openai.images.generate({ model: "gpt-image-1", prompt, n: 1, size, quality: "high" });
    const b64 = r.data?.[0]?.b64_json;
    if (!b64) return null;
    return await uploadBuffer(Buffer.from(b64, "base64"), "image/png");
  } catch (err) {
    logger.warn({ err: (err as any)?.message }, "auto-media: gpt-image-1 generate failed");
    return null;
  }
}

// 高级 pipeline：用第一张同行爆款图做 vision 分析 → 风格化 prompt → gpt-image-1 出图
// 失败返回 null，让上层降级到简单路径
async function tryAdvancedPipeline(opts: {
  platform: string;
  topic: string;
  title?: string;
  competitorImageUrl: string;
  brandBlock?: string;
}): Promise<string | null> {
  try {
    const analysis = await analyzeCompetitorImage(opts.competitorImageUrl);
    const promptOut = await generateImagePrompt({
      analysis,
      newTopic: opts.topic,
      newTitle: opts.title,
      mimicStrength: "partial",
      brandBlock: opts.brandBlock,
    });
    const preset = PLATFORM_VISUAL_PRESET[opts.platform] || PLATFORM_VISUAL_PRESET.xhs;
    const finalPrompt = buildSeedreamPrompt(
      promptOut.imagePrompt,
      promptOut.textToOverlay,
      "single",
      promptOut.emojisToInclude,
      opts.platform,
    );
    return await generateGptImage(finalPrompt, preset.size);
  } catch (err) {
    logger.warn({ err: (err as any)?.message, contentId: opts.title }, "auto-media: advanced pipeline failed, will fallback");
    return null;
  }
}

async function markFailedInRef(contentId: number) {
  try {
    const [c] = await db.select().from(contentTable).where(eq(contentTable.id, contentId));
    let ref: any = {};
    if (c?.originalReference) {
      try { ref = JSON.parse(c.originalReference); } catch { ref = {}; }
    }
    ref.autoMediaImageStatus = "failed";
    await db.update(contentTable).set({ originalReference: JSON.stringify(ref) }).where(eq(contentTable.id, contentId));
  } catch (err) {
    logger.warn({ err: (err as any)?.message, contentId }, "auto-media: mark-failed write failed");
  }
}

/**
 * Autopilot approve 后台任务：自动为 content 草稿生成封面图。
 * - 优先高级 pipeline（同行爆款 vision 分析 + 风格化 prompt）
 * - 失败降级到简单 gpt-image-1（仅 topic + title）
 * - 不扣额外积分（autopilot 自动驾驶基础体验）
 * - 任何失败都记日志并写 originalReference.autoMediaImageStatus="failed"，
 *   前端 polling 见到后停止 spinner 并提示用户手动点 AI 生成
 */
export async function kickOffImageForDraft(opts: {
  contentId: number;
  platform: string;
  topic: string;
  title?: string;
  competitorPostIds: number[];
  // 新增:用户 ID,用来加载该用户该平台的品牌画像 → 注入到 prompt,让自动出图也 brand-aware
  // 兼容旧调用方:undefined 时跳过 brand 注入,行为与之前一致
  userId?: number;
}): Promise<void> {
  // 加载品牌画像（失败/缺省直接跳过,不阻断主流程）
  let brandBlock = "";
  let brandHint = "";
  if (opts.userId) {
    const brand = await loadBrandContext(opts.userId, opts.platform);
    brandBlock = brand.promptBlock;
    brandHint = brandStyleHint(brand.brand);
  }
  // 取第一张同行爆款图做 vision 参考
  let competitorImg: string | undefined;
  if (opts.competitorPostIds.length > 0) {
    try {
      const posts = await db
        .select()
        .from(competitorPostsTable)
        .where(inArray(competitorPostsTable.id, opts.competitorPostIds.slice(0, 3)));
      // 找第一张有可用 cover/media url 的
      for (const p of posts) {
        const u = p.coverUrl ?? p.mediaUrl ?? "";
        if (u && /^https?:\/\//.test(u)) { competitorImg = u; break; }
      }
    } catch (err) {
      logger.warn({ err: (err as any)?.message }, "auto-media: load competitor post failed");
    }
  }

  let url: string | null = null;

  if (competitorImg) {
    url = await tryAdvancedPipeline({
      platform: opts.platform,
      topic: opts.topic,
      title: opts.title,
      competitorImageUrl: competitorImg,
      brandBlock,
    });
  }

  // 降级到简单 prompt（也注入 brand styleHint,让画风随客户调性走）
  if (!url) {
    const platformHint = opts.platform === "tiktok"
      ? "TikTok 9:16 短视频封面，hook 强、人物/产品居中"
      : opts.platform === "instagram"
        ? "Instagram 1:1 精致 lifestyle，柔和高级感配色"
        : opts.platform === "facebook"
          ? "Facebook 16:9 故事图配图风格"
          : "小红书 3:4 爆款封面，色彩饱满有冲击力";
    const simplePrompt = `${opts.topic}${opts.title ? `，主题：${opts.title}` : ""}。${platformHint}，画面精致饱满、构图专业。${brandHint}no text, no words, no logo, no letters.`;
    const size: "1024x1024" | "1024x1536" | "1536x1024" = opts.platform === "instagram" ? "1024x1024" : opts.platform === "facebook" ? "1536x1024" : "1024x1536";
    url = await generateGptImage(simplePrompt, size);
  }

  if (!url) {
    logger.warn({ contentId: opts.contentId }, "auto-media: both advanced and simple failed");
    await markFailedInRef(opts.contentId);
    return;
  }

  // 只在用户尚未手动上传/选择图片时才回写，避免后台覆盖用户实时编辑
  // (架构师 review High：用户在 polling 期间可能已经手动 ObjectUploader 上传了)
  const updated = await db
    .update(contentTable)
    .set({ imageUrls: [url] })
    .where(and(
      eq(contentTable.id, opts.contentId),
      sql`(${contentTable.imageUrls} IS NULL OR cardinality(${contentTable.imageUrls}) = 0)`,
    ))
    .returning({ id: contentTable.id });
  if (updated.length === 0) {
    logger.info({ contentId: opts.contentId }, "auto-media: skipped overwrite — user already attached images");
  } else {
    logger.info({ contentId: opts.contentId, platform: opts.platform, advanced: !!competitorImg }, "auto-media: image attached to draft");
  }
}
