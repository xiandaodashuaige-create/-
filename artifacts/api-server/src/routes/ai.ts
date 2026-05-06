import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { localScan } from "../services/sensitiveWordFilter.js";
import { db, sensitiveWordsTable, imageReferencesTable, usersTable, assetsTable, accountsTable, contentTable, brandProfilesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import {
  AiRewriteContentBody,
  AiRewriteContentResponse,
  AiCheckSensitivityBody,
  AiCheckSensitivityResponse,
  AiGenerateTitleBody,
  AiGenerateTitleResponse,
  AiGenerateHashtagsBody,
  AiGenerateHashtagsResponse,
} from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";
import { requireCredits, deductCredits, ensureUser, CREDIT_COSTS } from "../middlewares/creditSystem";
import { ComfyUIClient } from "../services/comfyui.js";
import { SeedreamClient } from "../services/seedream.js";
import { buildCollage, composeWithText, type CollageLayout } from "../services/collage.js";
import { analyzeCompetitorImage, generateImagePrompt, buildSeedreamPrompt, PLATFORM_VISUAL_PRESET } from "../services/imagePipeline.js";
import { loadStyleProfileForPrompt, recomputeUserStyleProfile } from "../services/styleProfile.js";
import { loadUserContentProfile, renderContentProfileForPrompt } from "../services/contentProfile.js";
import { chatWithAssistant, type AssistantImageContext } from "../services/assistant.js";
import { generateWeeklyPlan, type GenerateWeeklyPlanInput } from "../services/planGenerator.js";
import { loadViralContext } from "../services/viralContext.js";
import { tryFetchXhsData } from "./xhs";
import { getPlatformPromptContext, buildRegionContext } from "../lib/platformPrompts.js";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

function safeJsonParse(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

router.post("/ai/rewrite", requireCredits("ai-rewrite"), async (req, res): Promise<void> => {
  try {
    const parsed = AiRewriteContentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { originalContent, style, region, additionalInstructions, platform } = parsed.data;
    const ctx = getPlatformPromptContext(platform);
    const regionContext = buildRegionContext(region, ctx);
    const styleContext = style ? `Writing style: ${style}.` : "Writing style: casual and engaging.";

    // 注入用户已收集的爆款上下文（失败不阻断主流程）
    let viralBlock = "";
    try {
      const u = await ensureUser(req);
      const niche = typeof (req.body as any)?.niche === "string" ? (req.body as any).niche : undefined;
      if (u) {
        const viral = await loadViralContext({ userId: u.id, platform: platform as any, niche, region, maxPosts: 8 });
        viralBlock = viral.promptBlock ? `\n\n${viral.promptBlock}` : "";
      }
    } catch (e: any) {
      req.log?.warn({ err: e?.message }, "loadViralContext failed in /ai/rewrite, continuing without it");
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 4096,
      messages: [
        {
          role: "system",
          content: `${ctx.rolePrompt} ${regionContext} ${styleContext}

Rules:
${ctx.styleRules}
${additionalInstructions ? `Additional instructions: ${additionalInstructions}` : ""}

Respond in JSON format:
{
  "rewrittenTitle": "catchy title / hook here",
  "rewrittenBody": "rewritten content / script here",
  "suggestedTags": ["tag1", "tag2", "tag3"]
}${viralBlock}`,
        },
        {
          role: "user",
          content: `Please rewrite this content for ${ctx.platformDisplayName}:\n\n${originalContent}`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      res.status(500).json({ error: "AI failed to generate response" });
      return;
    }

    const result = safeJsonParse(content);
    if (!result) {
      res.status(500).json({ error: "AI returned invalid response format" });
      return;
    }

    await deductCredits(req, "ai-rewrite");
    res.json(
      AiRewriteContentResponse.parse({
        rewrittenTitle: result.rewrittenTitle || "",
        rewrittenBody: result.rewrittenBody || "",
        suggestedTags: result.suggestedTags || [],
      })
    );
  } catch (err) {
    req.log.error(err, "Failed to rewrite content");
    res.status(500).json({ error: "AI service error" });
  }
});

// 注意：这里 **不挂** requireCredits 中间件——本地词库分支是免费的，
// 余额不足时也应该让用户先用上本地检测。仅在走 LLM 分支前再做余额检查。
router.post("/ai/check-sensitivity", async (req, res): Promise<void> => {
  try {
    const parsed = AiCheckSensitivityBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { title, body, platform } = parsed.data;
    const ctx = getPlatformPromptContext(platform);

    const customWords = await db.select().from(sensitiveWordsTable);
    const wordList = customWords.map((w) => `${w.word} (${w.category}, ${w.severity})`).join("\n");

    // ── 第 1 道：本地 DFA 词库扫描（毫秒级、不扣积分、不调 LLM）──
    const localResult = localScan(`${title}\n${body}`, customWords.map((w) => ({
      word: w.word,
      severity: w.severity as "low" | "medium" | "high" | null,
      category: w.category,
    })));
    if (localResult.hasHighSeverity) {
      // 高危直接返回，不再走 LLM（省钱+秒响应）
      res.json(
        AiCheckSensitivityResponse.parse({
          score: localResult.score,
          issues: localResult.hits.map((h) => ({
            word: h.word,
            reason: `[${h.categoryLabel}] ${h.reason}`,
            severity: h.severity,
            suggestion: h.suggestion,
          })),
          suggestion: `本地词库命中 ${localResult.hits.length} 个高危违禁词，请处理后再尝试发布`,
        })
      );
      return;
    }

    // ── 第 2 道：本地无高危 → 走 LLM 检查语境/隐喻/广告法灰色地带 ──
    // LLM 分支才扣积分，所以这里手动做余额检查（顶层去掉了 requireCredits 中间件）
    const dbUser = await ensureUser(req);
    if (!dbUser) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.dbUser = dbUser;
    const llmCost = CREDIT_COSTS["ai-check-sensitivity"] ?? 0;
    if (dbUser.role !== "admin" && dbUser.credits < llmCost) {
      // 余额不足时不挡用户：把本地结果直接返回（即使 score=0）
      res.json(
        AiCheckSensitivityResponse.parse({
          score: localResult.score,
          issues: localResult.hits.map((h) => ({
            word: h.word, reason: `[${h.categoryLabel}] ${h.reason}`,
            severity: h.severity, suggestion: h.suggestion,
          })),
          suggestion: localResult.hits.length
            ? `本地词库提示 ${localResult.hits.length} 处需调整（积分不足，未做深度 AI 语义检查）`
            : "本地词库未发现高危违禁词；积分不足，跳过 AI 语义检查",
        })
      );
      return;
    }
    req.creditOperation = "ai-check-sensitivity";
    req.creditCost = dbUser.role === "admin" ? 0 : llmCost;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 4096,
      messages: [
        {
          role: "system",
          content: `${ctx.complianceContext}

Check for:
1. Absolute claims (e.g., "best", "number one", "most effective")
2. Medical/health claims without evidence
3. Fake promotions or misleading information
4. Politically sensitive content
5. Copyrighted material references
6. Banned advertising terms
7. Content that could be flagged as spam
${wordList ? `\nCustom sensitive words to also check:\n${wordList}` : ""}

Respond in JSON format:
{
  "score": 0-100 (0=safe, 100=highly risky),
  "issues": [
    {
      "word": "the problematic word/phrase",
      "reason": "why it's problematic",
      "severity": "low|medium|high",
      "suggestion": "alternative wording"
    }
  ],
  "suggestion": "overall recommendation"
}`,
        },
        {
          role: "user",
          content: `Title: ${title}\n\nBody: ${body}`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      res.status(500).json({ error: "AI failed to generate response" });
      return;
    }

    const result = safeJsonParse(content);
    if (!result) {
      res.status(500).json({ error: "AI returned invalid response format" });
      return;
    }

    await deductCredits(req, "ai-check-sensitivity");
    res.json(
      AiCheckSensitivityResponse.parse({
        score: result.score ?? 0,
        issues: (result.issues || []).map((i: any) => ({
          word: i.word || "",
          reason: i.reason || "",
          severity: i.severity || "low",
          suggestion: i.suggestion || "",
        })),
        suggestion: result.suggestion || "No issues found.",
      })
    );
  } catch (err) {
    req.log.error(err, "Failed to check sensitivity");
    res.status(500).json({ error: "AI service error" });
  }
});

router.post("/ai/generate-title", requireCredits("ai-generate-title"), async (req, res): Promise<void> => {
  try {
    const parsed = AiGenerateTitleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { body: contentBody, style, count, platform } = parsed.data;
    const titleCount = count || 5;
    const ctx = getPlatformPromptContext(platform);
    const styleHint = style ? `Style: ${style}.` : "Style: engaging and eye-catching.";

    let titlesHint = "";
    let viralBlock = "";
    try {
      const u = await ensureUser(req);
      const niche = typeof (req.body as any)?.niche === "string" ? (req.body as any).niche : undefined;
      const region = typeof (req.body as any)?.region === "string" ? (req.body as any).region : undefined;
      if (u) {
        const viral = await loadViralContext({ userId: u.id, platform: platform as any, niche, region, maxPosts: 8 });
        if (viral.topTitles.length > 0) {
          titlesHint = `\n\n📚 已收集爆款标题样本（必须借鉴其钩子结构、句式节奏，但主题改写到当前内容）：\n${viral.topTitles.slice(0, 6).map((t, i) => `${i + 1}. "${t.slice(0, 60)}"`).join("\n")}`;
        }
        viralBlock = viral.promptBlock ? `\n\n${viral.promptBlock}` : "";
      }
    } catch (e: any) {
      req.log?.warn({ err: e?.message }, "loadViralContext failed in /ai/generate-title");
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 4096,
      messages: [
        {
          role: "system",
          content: `You are a ${ctx.platformDisplayName} title/hook expert. Generate ${titleCount} catchy, click-worthy ${ctx.platform === "tiktok" ? "video hooks" : "titles"} for the given content. ${styleHint}

${ctx.titleRules}

Respond in JSON format:
{
  "titles": ["title1", "title2", ...]
}${titlesHint}${viralBlock}`,
        },
        {
          role: "user",
          content: contentBody,
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      res.status(500).json({ error: "AI failed to generate response" });
      return;
    }

    const result = safeJsonParse(content);
    if (!result) {
      res.status(500).json({ error: "AI returned invalid response format" });
      return;
    }

    await deductCredits(req, "ai-generate-title");
    res.json(AiGenerateTitleResponse.parse({ titles: result.titles || [] }));
  } catch (err) {
    req.log.error(err, "Failed to generate titles");
    res.status(500).json({ error: "AI service error" });
  }
});

router.post("/ai/generate-hashtags", requireCredits("ai-generate-hashtags"), async (req, res): Promise<void> => {
  try {
    const parsed = AiGenerateHashtagsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { title, body: contentBody, count, platform } = parsed.data;
    const tagCount = count || 10;
    const ctx = getPlatformPromptContext(platform);

    let hashtagSeed = "";
    let viralBlock = "";
    try {
      const u = await ensureUser(req);
      const niche = typeof (req.body as any)?.niche === "string" ? (req.body as any).niche : undefined;
      const region = typeof (req.body as any)?.region === "string" ? (req.body as any).region : undefined;
      if (u) {
        const viral = await loadViralContext({ userId: u.id, platform: platform as any, niche, region, maxPosts: 10 });
        if (viral.topHashtags.length > 0) {
          hashtagSeed = `\n\n🔥 已收集高频/热门 hashtags（**必须从下面挑至少 ${Math.ceil(tagCount * 0.5)} 个，再补充长尾词；不要凭空生造**）：\n${viral.topHashtags.map((h) => `#${h}`).join(" ")}`;
        }
        viralBlock = viral.promptBlock ? `\n\n${viral.promptBlock}` : "";
      }
    } catch (e: any) {
      req.log?.warn({ err: e?.message }, "loadViralContext failed in /ai/generate-hashtags");
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 4096,
      messages: [
        {
          role: "system",
          content: `You are a ${ctx.platformDisplayName} hashtag expert. Generate ${tagCount} relevant hashtags for the given content.

${ctx.hashtagRules}
- Format without # symbol (the client will add it)

Respond in JSON format:
{
  "hashtags": ["hashtag1", "hashtag2", ...]
}${hashtagSeed}${viralBlock}`,
        },
        {
          role: "user",
          content: `Title: ${title}\n\nContent: ${contentBody}`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      res.status(500).json({ error: "AI failed to generate response" });
      return;
    }

    const result = safeJsonParse(content);
    if (!result) {
      res.status(500).json({ error: "AI returned invalid response format" });
      return;
    }

    await deductCredits(req, "ai-generate-hashtags");
    res.json(AiGenerateHashtagsResponse.parse({ hashtags: result.hashtags || [] }));
  } catch (err) {
    req.log.error(err, "Failed to generate hashtags");
    res.status(500).json({ error: "AI service error" });
  }
});

router.post("/ai/generate-image", requireCredits("ai-generate-image"), async (req, res): Promise<void> => {
  try {
    const { prompt, style, size } = req.body;

    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({ error: "prompt is required" });
      return;
    }

    const validSizes = ["1024x1024", "1024x1536", "1536x1024", "auto"];
    const imageSize = validSizes.includes(size) ? size : "1024x1536";
    const imageStyle = style || "小红书爆款封面风格";
    const fullPrompt = `创作一张小红书爆款封面配图。

主题：${prompt}

风格要求：${imageStyle}
- 画面精致、高级感、色彩鲜明饱满
- 构图专业，视觉冲击力强，让人一眼就想点进来
- 适合作为小红书笔记封面图
- 如果涉及产品/美食/场景，要有真实质感和细节
- 如果涉及人物，要自然大方、有亲和力
- 整体氛围要温暖、治愈或高端，符合小红书爆款审美
- 不要出现任何文字、水印或logo`;

    const response = await openai.images.generate({
      model: "gpt-image-1",
      prompt: fullPrompt,
      n: 1,
      size: imageSize as "1024x1024" | "1024x1536" | "1536x1024" | "auto",
      quality: "high",
    });

    const b64Data = response.data?.[0]?.b64_json;
    if (!b64Data) {
      res.status(500).json({ error: "Failed to generate image" });
      return;
    }

    const imageBuffer = Buffer.from(b64Data, "base64");

    let objectPath: string | null = null;
    let storedUrl: string | null = null;
    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const candidatePath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        body: imageBuffer,
        headers: { "Content-Type": "image/png" },
      });

      if (!uploadRes.ok) throw new Error("Failed to upload to storage");
      objectPath = candidatePath;
      storedUrl = `/api/storage${objectPath}`;
    } catch (uploadErr) {
      req.log.warn(uploadErr, "Failed to save generated image to storage");
      objectPath = null;
      storedUrl = null;
    }

    if (!storedUrl) {
      res.status(500).json({ error: "AI图片已生成但存储失败，请重试" });
      return;
    }

    await deductCredits(req, "ai-generate-image");

    // 镜像写入素材库（assets），让用户后续在 /assets 能看到所有 AI 产出并复用
    try {
      const u = await ensureUser(req);
      if (u && objectPath) {
        await db.insert(assetsTable).values({
          userId: u.id,
          accountId: null,
          type: "image",
          filename: `ai-${Date.now()}.png`,
          objectPath,
          size: imageBuffer?.length ?? 0,
          tags: ["ai-generated"],
        } as any);
      }
    } catch (mirrorErr) {
      req.log.warn(mirrorErr, "Failed to mirror AI image to assets library");
    }

    res.json({
      imageUrl: storedUrl,
      objectPath,
      storedUrl,
    });
  } catch (err: any) {
    req.log.error(err, "Failed to generate image");
    const message = err?.message?.includes("content_policy")
      ? "图片内容不符合安全政策，请修改描述后重试"
      : "AI图片生成失败";
    res.status(500).json({ error: message });
  }
});

router.post("/ai/edit-image", requireCredits("ai-generate-image"), async (req, res): Promise<void> => {
  try {
    const { prompt, referenceImageUrl, size } = req.body;

    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({ error: "prompt is required" });
      return;
    }
    if (!referenceImageUrl || typeof referenceImageUrl !== "string") {
      res.status(400).json({ error: "referenceImageUrl is required" });
      return;
    }

    const validSizes = ["1024x1024", "1024x1536", "1536x1024", "auto"];
    const imageSize = validSizes.includes(size) ? size : "1024x1536";

    const isExternalUrl = referenceImageUrl.startsWith("http://") || referenceImageUrl.startsWith("https://");
    const allowedPrefixes = ["/api/storage/objects/", "/api/storage/public-objects/"];
    if (!isExternalUrl && !allowedPrefixes.some((p) => referenceImageUrl.startsWith(p))) {
      res.status(400).json({ error: "referenceImageUrl must be a storage path or external URL" });
      return;
    }

    let refImageBuffer: Buffer;
    try {
      const refUrl = isExternalUrl
        ? referenceImageUrl
        : `http://localhost:${process.env.PORT || 8080}${referenceImageUrl}`;
      const refRes = await fetch(refUrl, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
        headers: isExternalUrl ? { "User-Agent": "Mozilla/5.0 (compatible; XHSTool/1.0)" } : {},
      });
      if (!refRes.ok) throw new Error(`Failed to fetch reference image: ${refRes.status}`);
      refImageBuffer = Buffer.from(await refRes.arrayBuffer());
      if (refImageBuffer.length < 1000) {
        req.log.warn({ size: refImageBuffer.length, url: referenceImageUrl }, "Reference image too small");
        res.status(400).json({ error: "参考图片太小或无法访问" });
        return;
      }
    } catch (fetchErr) {
      req.log.warn(fetchErr, "Failed to fetch reference image");
      res.status(400).json({ error: "无法获取参考图片，请确认图片链接有效" });
      return;
    }

    // openai SDK 由 @workspace/integrations-openai-ai-server 间接 hoist 提供；运行时可解析
    const oa = (await import("openai" as string)) as { toFile: (file: Buffer, name: string, opts?: { type?: string }) => Promise<unknown> };
    const imageFile = await oa.toFile(refImageBuffer, "reference.png", { type: "image/png" });

    const fullPrompt = `参考这张图片的构图、配色和风格，创作一张全新的、与之风格相似但内容不同的图片。要求：${prompt}. 保持小红书风格，精美、高质量、适合社交媒体展示。`;

    const response = await openai.images.edit({
      model: "gpt-image-1",
      image: imageFile as any,
      prompt: fullPrompt,
      n: 1,
      size: imageSize as "1024x1024" | "1024x1536" | "1536x1024" | "auto",
    });

    const b64Data = response.data?.[0]?.b64_json;
    if (!b64Data) {
      res.status(500).json({ error: "图片生成失败" });
      return;
    }

    const imageBuffer = Buffer.from(b64Data, "base64");

    let objectPath: string | null = null;
    let storedUrl: string | null = null;
    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const candidatePath = objectStorageService.normalizeObjectEntityPath(uploadURL);
      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        body: imageBuffer,
        headers: { "Content-Type": "image/png" },
      });
      if (!uploadRes.ok) throw new Error("Failed to upload to storage");
      objectPath = candidatePath;
      storedUrl = `/api/storage${objectPath}`;
    } catch (uploadErr) {
      req.log.warn(uploadErr, "Failed to save edited image to storage");
    }

    if (!storedUrl) {
      res.status(500).json({ error: "图片已生成但存储失败，请重试" });
      return;
    }

    await deductCredits(req, "ai-generate-image");
    res.json({ imageUrl: storedUrl, objectPath, storedUrl });
  } catch (err: any) {
    req.log.error(err, "Failed to edit image");
    const message = err?.message?.includes("content_policy")
      ? "图片内容不符合安全政策，请修改描述后重试"
      : "AI图片编辑失败";
    res.status(500).json({ error: message });
  }
});

router.post("/ai/analyze-reference-image", requireCredits("ai-analyze-reference-image"), async (req, res): Promise<void> => {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl || typeof imageUrl !== "string") {
      res.status(400).json({ error: "imageUrl is required" });
      return;
    }

    let resolvedUrl = imageUrl;
    if (imageUrl.startsWith("/api/storage/") || imageUrl.startsWith("/api/xhs/image-proxy")) {
      const buf = await fetchImageAsBuffer(imageUrl, req);
      resolvedUrl = `data:image/png;base64,${buf.toString("base64")}`;
    }

    const analysis = await analyzeCompetitorImage(resolvedUrl, req.log);
    await deductCredits(req, "ai-analyze-reference-image");
    res.json({ analysis });
  } catch (err: any) {
    req.log.error(err, "Failed to analyze reference image");
    res.status(500).json({ error: "图片分析失败，请重试" });
  }
});

router.post("/ai/generate-image-prompt", requireCredits("ai-generate-image-prompt"), async (req, res): Promise<void> => {
  try {
    const { analysis, newTopic, newTitle, newKeyPoints, mimicStrength, customTextOverlays } = req.body;
    if (!analysis || typeof analysis !== "object") {
      res.status(400).json({ error: "analysis is required" });
      return;
    }
    if (!newTopic || typeof newTopic !== "string") {
      res.status(400).json({ error: "newTopic is required" });
      return;
    }

    const prompt = await generateImagePrompt({
      analysis,
      newTopic,
      newTitle,
      newKeyPoints: Array.isArray(newKeyPoints) ? newKeyPoints : undefined,
      mimicStrength: ["full", "partial", "minimal"].includes(mimicStrength) ? mimicStrength : "partial",
      customTextOverlays: Array.isArray(customTextOverlays) ? customTextOverlays : undefined,
    });

    await deductCredits(req, "ai-generate-image-prompt");
    res.json(prompt);
  } catch (err: any) {
    req.log.error(err, "Failed to generate image prompt");
    res.status(500).json({ error: "生成图片prompt失败" });
  }
});

router.post("/ai/generate-image-pipeline", requireCredits("ai-generate-image"), async (req, res): Promise<void> => {
  try {
    const { referenceImageUrl, newTopic, newTitle, newKeyPoints, mimicStrength, customTextOverlays, customEmojis, size, layoutMode, preferredProvider, extraInstructions, platform: rawPlatform } = req.body;
    const platform = typeof rawPlatform === "string" && rawPlatform in PLATFORM_VISUAL_PRESET ? rawPlatform : "xhs";
    const platformPreset = PLATFORM_VISUAL_PRESET[platform];

    if (!referenceImageUrl || typeof referenceImageUrl !== "string") {
      res.status(400).json({ error: "referenceImageUrl is required" });
      return;
    }
    if (!newTopic || typeof newTopic !== "string") {
      res.status(400).json({ error: "newTopic is required" });
      return;
    }

    const strength = ["full", "partial", "minimal"].includes(mimicStrength) ? mimicStrength : "partial";
    const layout: CollageLayout = ["single", "dual-vertical", "dual-horizontal", "grid-2x2", "left-big-right-small"].includes(layoutMode)
      ? layoutMode
      : "single";
    const numCells = layout === "single" ? 1 : layout === "grid-2x2" ? 4 : layout === "left-big-right-small" ? 3 : 2;

    let visionInput = referenceImageUrl;
    let referenceBuffer: Buffer | null = null;

    if (referenceImageUrl.startsWith("/api/storage/") || referenceImageUrl.startsWith("/api/xhs/image-proxy")) {
      referenceBuffer = await fetchImageAsBuffer(referenceImageUrl, req);
      visionInput = `data:image/png;base64,${referenceBuffer.toString("base64")}`;
    } else if (referenceImageUrl.startsWith("http://") || referenceImageUrl.startsWith("https://")) {
      referenceBuffer = await fetchImageAsBuffer(referenceImageUrl, req);
    }

    req.log.info("Pipeline step 1: vision analysis");
    const analysis = await analyzeCompetitorImage(visionInput, req.log);

    req.log.info("Pipeline step 2: prompt generation (with user style profile)");
    let userIdForLearning: number | null = null;
    try {
      const u = await ensureUser(req);
      userIdForLearning = u?.id ?? null;
    } catch {
      // not auth'd or no user — skip personalization
    }
    const styleProfile = userIdForLearning ? await loadStyleProfileForPrompt(userIdForLearning) : null;
    const promptResult = await generateImagePrompt({
      analysis,
      newTopic,
      newTitle,
      newKeyPoints: Array.isArray(newKeyPoints) ? newKeyPoints : undefined,
      mimicStrength: strength,
      customTextOverlays: Array.isArray(customTextOverlays) ? customTextOverlays : undefined,
      styleProfile,
      extraInstructions: typeof extraInstructions === "string" ? extraInstructions : undefined,
    });

    // 用户/助手指定的 emoji 优先于模型自动生成的
    if (Array.isArray(customEmojis)) {
      promptResult.emojisToInclude = customEmojis.filter((e: any) => typeof e === "string");
    }

    req.log.info("Pipeline step 3: image generation");
    const imageSize = ["1024x1024", "1024x1536", "1536x1024"].includes(size)
      ? size
      : platformPreset.size;

    let imageBuffer: Buffer;
    let provider = "gpt-image-1";
    let durationMs = 0;
    const startGen = Date.now();

    const seedream = SeedreamClient.fromEnv();
    const comfy = ComfyUIClient.fromEnv();
    const wantSeedream = preferredProvider !== "comfyui" && preferredProvider !== "openai" && !!seedream;
    const wantComfy = preferredProvider !== "openai" && !!comfy;

    async function tryComfyFallback(): Promise<{ buf: Buffer; ms: number } | null> {
      if (!wantComfy || !comfy || !referenceBuffer) return null;
      const healthy = await comfy.healthCheck();
      if (!healthy) return null;
      try {
        const [w, h] = imageSize.split("x").map(Number);
        const reduxStrength = strength === "full" ? 0.85 : strength === "partial" ? 0.65 : 0.4;
        const cnStrength = strength === "full" ? 0.7 : strength === "partial" ? 0.45 : 0.2;
        const fluxResult = await comfy.generateWithReference({
          referenceImageBase64: referenceBuffer.toString("base64"),
          prompt: promptResult.imagePrompt,
          width: w,
          height: h,
          reduxStrength,
          controlnetStrength: cnStrength,
        });
        let outBuf: Buffer;
        let totalMs = fluxResult.durationMs;
        if (promptResult.textToOverlay.length > 0) {
          const overlayResult = await comfy.overlayChineseText({
            baseImageBase64: fluxResult.imageBase64,
            textItems: promptResult.textToOverlay.map((t) => ({ text: t.text, position: t.position })),
          });
          outBuf = Buffer.from(overlayResult.imageBase64, "base64");
          totalMs += overlayResult.durationMs;
        } else {
          outBuf = Buffer.from(fluxResult.imageBase64, "base64");
        }
        return { buf: outBuf, ms: totalMs };
      } catch (cErr) {
        req.log.warn(cErr, "ComfyUI fallback path failed");
        return null;
      }
    }

    if (wantSeedream && seedream) {
      try {
        const [w, h] = imageSize.split("x").map(Number);
        if (layout === "single") {
          // 单图模式：把文字直接塞进 Seedream prompt，一次出图
          const fullPrompt = buildSeedreamPrompt(promptResult.imagePrompt, promptResult.textToOverlay, "single", promptResult.emojisToInclude, platform);
          const r = await seedream.generate({ prompt: fullPrompt, size: imageSize }, req.log);
          imageBuffer = r.imageBuffer;
          durationMs = r.durationMs;
        } else {
          // 拼图模式：先生成 N 张子图（不带文字），然后后端拼接 + SVG 文字叠加
          const subPromptBase = promptResult.imagePrompt.replace(/no text|no words|no logo/gi, "").trim();
          const subSize = layout === "dual-horizontal" ? imageSize : `${w}x${Math.round(h / (layout === "grid-2x2" ? 2 : 2))}`;
          const subImages: Buffer[] = [];
          for (let i = 0; i < numCells; i++) {
            const variantHint = numCells > 1 ? `\n（这是 ${numCells} 格拼图中的第 ${i + 1} 张，要求与其他张风格统一但内容有差异）` : "";
            const subPrompt = `${subPromptBase}${variantHint}\n小红书风格，画面无文字，画面饱满有冲击力。`;
            const r = await seedream.generate({ prompt: subPrompt, size: subSize }, req.log);
            subImages.push(r.imageBuffer);
            durationMs += r.durationMs;
          }
          const collaged = await buildCollage({ layout, images: subImages, width: w, height: h, gap: 12 });
          imageBuffer = await composeWithText({
            baseImage: collaged,
            textOverlays: promptResult.textToOverlay.map((t) => ({
              text: t.text,
              position: t.position,
              bgColor: t.style?.includes("白底") ? "#ffffff" : t.style?.includes("黄底") ? "#fde047" : undefined,
              color: t.style?.includes("白底") || t.style?.includes("黄底") ? "#111111" : "#ffffff",
            })),
            width: w,
            height: h,
          });
        }
        provider = layout === "single" ? "seedream-5.0-lite" : `seedream-5.0-lite+collage(${layout})`;
      } catch (sdErr: any) {
        req.log.warn({ err: sdErr?.message }, "Seedream failed, attempting ComfyUI fallback");
        const cFb = await tryComfyFallback();
        if (cFb) {
          imageBuffer = cFb.buf;
          durationMs = cFb.ms;
          provider = "comfyui-fallback-from-seedream";
        } else {
          req.log.warn("ComfyUI unavailable, final fallback to gpt-image-1");
          imageBuffer = await generateWithGptImage(promptResult.imagePrompt, imageSize, promptResult.textToOverlay);
          provider = "gpt-image-1-fallback-from-seedream";
          durationMs = Date.now() - startGen;
        }
      }
    } else if (wantComfy && comfy && referenceBuffer) {
      const healthy = await comfy.healthCheck();
      if (healthy) {
        try {
          const [w, h] = imageSize.split("x").map(Number);
          const reduxStrength = strength === "full" ? 0.85 : strength === "partial" ? 0.65 : 0.4;
          const cnStrength = strength === "full" ? 0.7 : strength === "partial" ? 0.45 : 0.2;

          const fluxResult = await comfy.generateWithReference({
            referenceImageBase64: referenceBuffer.toString("base64"),
            prompt: promptResult.imagePrompt,
            width: w,
            height: h,
            reduxStrength,
            controlnetStrength: cnStrength,
          });

          if (promptResult.textToOverlay.length > 0) {
            const overlayResult = await comfy.overlayChineseText({
              baseImageBase64: fluxResult.imageBase64,
              textItems: promptResult.textToOverlay.map((t) => ({
                text: t.text,
                position: t.position,
              })),
            });
            imageBuffer = Buffer.from(overlayResult.imageBase64, "base64");
            durationMs = fluxResult.durationMs + overlayResult.durationMs;
          } else {
            imageBuffer = Buffer.from(fluxResult.imageBase64, "base64");
            durationMs = fluxResult.durationMs;
          }
          provider = "comfyui-flux-redux";
        } catch (comfyErr) {
          req.log.warn(comfyErr, "ComfyUI failed, falling back to gpt-image-1");
          imageBuffer = await generateWithGptImage(promptResult.imagePrompt, imageSize, promptResult.textToOverlay);
          provider = "gpt-image-1-fallback";
          durationMs = Date.now() - startGen;
        }
      } else {
        req.log.warn({ url: process.env.COMFYUI_URL }, "ComfyUI healthcheck failed, using gpt-image-1");
        imageBuffer = await generateWithGptImage(promptResult.imagePrompt, imageSize, promptResult.textToOverlay);
        durationMs = Date.now() - startGen;
      }
    } else {
      imageBuffer = await generateWithGptImage(promptResult.imagePrompt, imageSize, promptResult.textToOverlay);
      durationMs = Date.now() - startGen;
    }

    let objectPath: string | null = null;
    let storedUrl: string | null = null;
    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const candidatePath = objectStorageService.normalizeObjectEntityPath(uploadURL);
      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        body: imageBuffer,
        headers: { "Content-Type": "image/png" },
      });
      if (!uploadRes.ok) throw new Error("Failed to upload to storage");
      objectPath = candidatePath;
      storedUrl = `/api/storage${objectPath}`;
    } catch (uploadErr) {
      req.log.warn(uploadErr, "Failed to save pipeline image to storage");
    }

    if (!storedUrl) {
      res.status(500).json({ error: "图片已生成但存储失败，请重试" });
      return;
    }

    await deductCredits(req, "ai-generate-image");

    // 镜像写入素材库（assets）—— 管线产出的图也进 /assets，用户能复用
    try {
      const u = await ensureUser(req);
      if (u && objectPath) {
        await db.insert(assetsTable).values({
          userId: u.id,
          accountId: null,
          type: "image",
          filename: `ai-pipeline-${Date.now()}.png`,
          objectPath,
          size: imageBuffer?.length ?? 0,
          tags: ["ai-generated", "pipeline", strength],
        } as any);
      }
    } catch (mirrorErr) {
      req.log.warn(mirrorErr, "Failed to mirror pipeline image to assets library");
    }

    let referenceId: number | null = null;
    if (userIdForLearning) {
      try {
        const inserted = await db
          .insert(imageReferencesTable)
          .values({
            userId: userIdForLearning,
            refImageUrl: referenceImageUrl,
            analysisJson: analysis as any,
            generatedImageUrl: storedUrl,
            generatedObjectPath: objectPath,
            promptUsed: promptResult.imagePrompt,
            layout,
            mimicStrength: strength,
            provider,
            topic: newTopic,
            accepted: false,
          })
          .returning({ id: imageReferencesTable.id });
        referenceId = inserted[0]?.id ?? null;
      } catch (dbErr) {
        req.log.warn(dbErr, "Failed to record image reference for learning");
      }
    }

    res.json({
      imageUrl: storedUrl,
      objectPath,
      storedUrl,
      analysis,
      promptUsed: promptResult.imagePrompt,
      textOverlays: promptResult.textToOverlay,
      emojis: promptResult.emojisToInclude,
      provider,
      durationMs,
      referenceId,
      styleProfileUsed: !!(styleProfile && styleProfile.sampleSize > 0),
    });
  } catch (err: any) {
    req.log.error(err, "Image pipeline failed");
    const message = err?.message?.includes("content_policy")
      ? "图片内容不符合安全政策，请修改主题后重试"
      : "图片生成失败，请重试";
    res.status(500).json({ error: message });
  }
});

router.post("/ai/image-feedback", async (req, res): Promise<void> => {
  try {
    const { referenceId, accepted, rating, feedbackText } = req.body;
    if (typeof referenceId !== "number") {
      res.status(400).json({ error: "referenceId is required" });
      return;
    }
    const user = await ensureUser(req);
    if (!user) {
      res.status(401).json({ error: "未登录" });
      return;
    }
    const updates: Record<string, any> = {};
    if (typeof accepted === "boolean") updates.accepted = accepted;
    if (typeof rating === "number" && rating >= 1 && rating <= 5) updates.rating = rating;
    if (typeof feedbackText === "string") updates.feedbackText = feedbackText.slice(0, 500);
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "至少要提供 accepted/rating/feedbackText 之一" });
      return;
    }
    const rows = await db
      .update(imageReferencesTable)
      .set(updates)
      .where(and(eq(imageReferencesTable.id, referenceId), eq(imageReferencesTable.userId, user.id)))
      .returning({ id: imageReferencesTable.id, userId: imageReferencesTable.userId });
    if (rows.length === 0) {
      res.status(404).json({ error: "记录不存在或无权访问" });
      return;
    }
    if (rows[0].userId && updates.accepted !== undefined) {
      try {
        await recomputeUserStyleProfile(rows[0].userId);
      } catch (e) {
        req.log.warn(e, "Failed to recompute style profile");
      }
    }
    res.json({ ok: true });
  } catch (err: any) {
    req.log.error(err, "Image feedback failed");
    res.status(500).json({ error: "保存反馈失败" });
  }
});

router.post("/ai/assistant-chat", async (req, res): Promise<void> => {
  try {
    const { message, history, context } = req.body as {
      message: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
      context: AssistantImageContext;
    };
    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "message is required" });
      return;
    }
    if (!context || typeof context !== "object") {
      res.status(400).json({ error: "context is required" });
      return;
    }
    const reply = await chatWithAssistant(
      Array.isArray(history) ? history : [],
      message,
      {
        referenceImageUrl: context.referenceImageUrl ?? null,
        generatedImageUrl: context.generatedImageUrl ?? null,
        topic: context.topic ?? null,
        title: context.title ?? null,
        layout: context.layout || "single",
        mimicStrength: context.mimicStrength || "partial",
        textOverlays: Array.isArray(context.textOverlays) ? context.textOverlays : [],
        emojis: Array.isArray(context.emojis) ? context.emojis : [],
        imagePromptUsed: context.imagePromptUsed ?? null,
      },
    );
    res.json(reply);
  } catch (err: any) {
    req.log.error(err, "Assistant chat failed");
    res.status(500).json({ error: "AI 助手暂时无法响应，请稍后再试" });
  }
});

function isPrivateOrLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "0.0.0.0" || h.endsWith(".localhost")) return true;
  if (h === "metadata.google.internal" || h === "instance-data") return true;
  // IPv4 private/link-local/loopback ranges
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 0) return true;
  }
  // IPv6 loopback / link-local / unique-local
  if (h === "::1" || h === "[::1]") return true;
  if (h.startsWith("fe80:") || h.startsWith("[fe80:")) return true;
  if (h.startsWith("fc") || h.startsWith("fd") || h.startsWith("[fc") || h.startsWith("[fd")) return true;
  return false;
}

async function fetchImageAsBuffer(urlOrPath: string, req: any): Promise<Buffer> {
  const isExternal = urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://");
  if (isExternal) {
    let parsed: URL;
    try {
      parsed = new URL(urlOrPath);
    } catch {
      throw new Error("Invalid image URL");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only http(s) URLs allowed");
    if (isPrivateOrLocalHost(parsed.hostname)) {
      throw new Error("Refusing to fetch from private/internal host");
    }
  }
  const fetchUrl = isExternal
    ? urlOrPath
    : `http://localhost:${process.env.PORT || 8080}${urlOrPath}`;
  const res = await fetch(fetchUrl, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
    headers: isExternal ? { "User-Agent": "Mozilla/5.0 (compatible; XHSTool/1.0)" } : {},
  });
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error("Image too small or invalid");
  return buf;
}

async function generateWithGptImage(
  basePrompt: string,
  size: string,
  textOverlays: Array<{ text: string; position: string; style: string }>,
): Promise<Buffer> {
  const textInstructions = textOverlays.length > 0
    ? `\n\n图上需要清晰渲染以下中文文字（务必准确，不要出错别字）：\n${textOverlays.map((t) => `- 在${t.position}位置: "${t.text}" (${t.style})`).join("\n")}`
    : "\n\n不要出现任何文字、水印或logo。";

  const fullPrompt = `${basePrompt}${textInstructions}`;

  const response = await openai.images.generate({
    model: "gpt-image-1",
    prompt: fullPrompt,
    n: 1,
    size: size as "1024x1024" | "1024x1536" | "1536x1024" | "auto",
    quality: "high",
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("gpt-image-1 returned no image");
  return Buffer.from(b64, "base64");
}

router.get("/ai/my-content-profile", async (req, res): Promise<void> => {
  try {
    const u = await ensureUser(req);
    if (!u?.id) {
      res.status(401).json({ error: "未登录" });
      return;
    }
    const profile = await loadUserContentProfile(u.id);
    if (!profile) {
      res.json({
        sampleSize: 0,
        favoriteTags: [],
        preferredTitlePatterns: [],
        preferredOpenings: [],
        preferredEmojis: [],
        preferredRegions: [],
        avgBodyLength: 0,
        avgTagCount: 0,
        lastUpdated: null,
      });
      return;
    }
    res.json({
      sampleSize: profile.sampleSize,
      favoriteTags: profile.favoriteTags,
      preferredTitlePatterns: profile.preferredTitlePatterns,
      preferredOpenings: profile.preferredOpenings,
      preferredEmojis: profile.preferredEmojis,
      preferredRegions: profile.preferredRegions,
      avgBodyLength: profile.avgBodyLength,
      avgTagCount: profile.avgTagCount,
      lastUpdated: profile.lastUpdated,
    });
  } catch (err) {
    req.log.error(err, "Failed to load content profile");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/ai/competitor-research", requireCredits("ai-competitor-research"), async (req, res): Promise<void> => {
  try {
    const { businessDescription, competitorLink, niche, region, platform: rawPlatform } = req.body;

    const bd = typeof businessDescription === "string" ? businessDescription.slice(0, 1000).trim() : "";
    const cl = typeof competitorLink === "string" ? competitorLink.slice(0, 500).trim() : "";
    const ni = typeof niche === "string" ? niche.slice(0, 200).trim() : "";
    const rg = typeof region === "string" ? region.slice(0, 10).trim() : "";
    const platform = (typeof rawPlatform === "string" && ["xhs", "tiktok", "instagram", "facebook"].includes(rawPlatform))
      ? rawPlatform as "xhs" | "tiktok" | "instagram" | "facebook"
      : "xhs";
    const isXhs = platform === "xhs";

    if (!bd && !cl && !ni) {
      res.status(400).json({ error: "请提供业务描述、对标链接或行业关键词" });
      return;
    }

    // 非小红书平台地区限制放宽：允许 GLOBAL / 任意地区
    if (isXhs && (!rg || !["SG", "HK", "MY"].includes(rg))) {
      res.status(400).json({ error: "请选择目标地区（SG/HK/MY）" });
      return;
    }

    const isHK = rg === "HK";
    const langInstruction = isHK
      ? "\n\n🔴 重要：目標受眾係香港人。你必須用繁體中文撰寫所有內容，並融入自然嘅香港廣東話口語表達（例如：搵、嘅、啲、唔、俾、揀、係、咗、嚟、喺）。標題同正文都要用繁體字，語氣要親切自然，符合香港人嘅閱讀習慣。標籤也用繁體中文。分析同行時要重點參考香港地區嘅小紅書爆款內容。"
      : "";

    const regionKeywordMap: Record<string, string> = { SG: "新加坡", HK: "香港", MY: "马来西亚" };
    const regionPrefix = regionKeywordMap[rg] || "";
    const baseKeyword = ni || bd.slice(0, 20);
    const searchKeyword = regionPrefix ? `${regionPrefix} ${baseKeyword}` : baseKeyword;
    let realDataContext = "";
    let dataSource = "ai-only";
    let competitorNotes: any[] = [];

    // 仅小红书走真实数据抓取（其他平台暂时纯 AI 推理）
    if (isXhs && searchKeyword) {
      const xhsResult = await tryFetchXhsData(searchKeyword);
      dataSource = xhsResult.source;
      if (xhsResult.available && xhsResult.notes.length > 0) {
        competitorNotes = xhsResult.notes;
        const sorted = [...xhsResult.notes].sort((a: any, b: any) => (b.liked_count || 0) - (a.liked_count || 0));
        // 把每篇的完整摘要（200字）+ 标签都喂给 AI，确保它能真正吃透爆款风格
        const noteSummaries = sorted.map((n: any, i: number) =>
          `${i + 1}. 「${n.title}」by @${n.author} — ❤️${n.liked_count} ⭐${n.collected_count} 💬${n.comment_count}${n.cover_url ? ` 📷有封面` : ""}
   摘要：${(n.desc || "").slice(0, 200) || "（无）"}
   标签：${(n.tags || []).slice(0, 8).map((t: string) => `#${t}`).join(" ") || "（无）"}`
        ).join("\n\n");

        // 聚合所有爆款里的高频标签 → 标签池，强制 AI 优先采用
        const tagFreq = new Map<string, number>();
        for (const n of sorted) {
          for (const t of (n.tags || [])) {
            const norm = String(t).trim().replace(/^#/, "");
            if (norm) tagFreq.set(norm, (tagFreq.get(norm) || 0) + 1);
          }
        }
        const topTagPool = [...tagFreq.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 25)
          .map(([t, c]) => `#${t}(${c}次)`)
          .join("、");

        const avgLikes = Math.round(sorted.reduce((s: number, n: any) => s + (n.liked_count || 0), 0) / sorted.length);
        const avgCollected = Math.round(sorted.reduce((s: number, n: any) => s + (n.collected_count || 0), 0) / sorted.length);
        realDataContext = `\n\n📊 以下是该领域小红书${sorted.length}篇真实爆款笔记（按点赞数排序，实时抓取）：

${noteSummaries}

📈 数据概览：共${sorted.length}篇，平均点赞${avgLikes}，平均收藏${avgCollected}，最高点赞${sorted[0]?.liked_count || 0}

🏷 爆款高频标签池（按出现次数排序，**生成方案时必须优先从这里挑 3-4 个，再补充 2-3 个长尾标签**）：
${topTagPool || "（暂无）"}

⚠️ 核心任务：你必须深度分析以上全部${sorted.length}篇爆款笔记，完成以下工作：
1. 【分类归纳】将这些爆款按内容方向/角度分成3-5个类别（如：教程攻略类、个人体验类、测评对比类、避坑指南类、种草推荐类等）
2. 【爆款模式提炼】从标题、正文结构、情绪钩子、标签策略四个维度，总结每类爆款的成功规律
3. 【经验总结 experienceSummary】产出 5-8 条**可直接执行的具体经验**，不要泛泛而谈。例如：
   - "标题首字优先用数字（27岁/3天/¥199），${sorted.length}篇里有X篇这么做，平均点赞高XX%"
   - "前 2 句必须出现具体地名/价格/痛点，不要写'最近发现'这种虚词"
   - "结尾必带提问引导评论（'你们花了多少钱？'），实测互动率高3倍"
4. 【伪原创方案 suggestions】生成3套方案。每套方案必须：
   - **mimicSource**: 明确说"借鉴第N篇《XXX标题》的YY模式"（必填，方便用户对照原帖）
   - 标题用爆款验证过的公式（数字+痛点、对比反差、好奇心缺口等）
   - 正文模仿爆款的行文节奏，但内容完全原创
   - **tags 必须从上面【爆款高频标签池】里挑 3-4 个 + 自己补 2-3 个长尾词**`;
      }
    }

    // 加载客户历史风格画像（成长能力的核心）
    let contentProfileBlock = "";
    let contentProfileSampleSize = 0;
    try {
      const u = await ensureUser(req);
      if (u?.id) {
        const profile = await loadUserContentProfile(u.id);
        if (profile) {
          contentProfileSampleSize = profile.sampleSize;
          contentProfileBlock = renderContentProfileForPrompt(profile);
        }
      }
    } catch { /* 未登录或异常都不阻塞 */ }

    const inputContext = [
      bd ? `业务/品牌描述: ${bd}` : "",
      cl ? `对标参考链接/账号: ${cl}` : "",
      ni ? `行业/赛道: ${ni}` : "",
      rg ? `目标地区: ${rg === "SG" ? "新加坡" : rg === "HK" ? "香港" : "马来西亚"}` : "",
    ].filter(Boolean).join("\n") + realDataContext + contentProfileBlock;

    // 各平台系统 prompt（小红书保留原版深度版；其他平台用对应平台爆款公式）
    const PLATFORM_SYSTEM_PROMPTS: Record<string, string> = {
      tiktok: `你是 TikTok 顶级 short-form video 操盘手，运营过多个百万粉账号。你专精"前 3 秒 hook → 留存峰谷 → CTA"的脚本拆解。${langInstruction}

# 你要做的
基于用户的业务/赛道，输出 3 套 TikTok 短视频脚本方案。每套要给出：
- 角度（angle）：差异化定位
- title：作为视频开篇 hook 字幕（6-12 字，必须制造好奇缺口/反差/具体数字）
- body：完整脚本，必须包含 [HOOK 0-3s] [BUILD 3-15s] [PAYOFF 15-45s] [CTA 45-60s] 四段，给出每段台词 + 拍摄镜头建议（中近景/手持运镜/对比 cut 等）
- tags：3-5 个 TikTok hashtag，1 个大词（#fyp 或本地化大词）+ 2-3 niche + 1 trend
- style：脚本风格（如 storytelling / 教学拆解 / 对比测评 / 反转剧情）
- whyThisWorks：解释 hook 公式 + 为什么留存高
- imagePrompt：封面（首帧）配图建议，9:16 竖版，hook 字幕居中放大

# 严禁
❌ 开头说"hi guys/大家好/今天我们来讲"——直接抛冲突或具体数字
❌ 写成纯文字软文——TikTok 是视频，必须有镜头/动作描述
❌ hashtag 全部小众长尾——必须混一个大流量词撬动推荐池`,

      instagram: `你是 Instagram 顶级 Feed/Reels 内容策略师，运营多个百万粉账号。你专精 caption 节奏、save-rate 提升和视觉一致性。${langInstruction}

# 你要做的
基于用户的业务/赛道，输出 3 套 IG 内容方案。每套要给出：
- angle：内容切入角度
- title：作为 caption 第一行 hook（8-15 字，"more" 折叠前必须吸住）
- body：完整 caption，250-450 字。结构：hook → relatable scene/value promise → 3-5 个分段 bullet 或短段落 → CTA（save / share / comment with…）。换行多、留白多
- tags：8-15 个 IG hashtag，混合 branded / community / niche / 地域，全部小写无空格，避开 banned 标签
- style：风格定位（aesthetic editorial / lifestyle storytelling / educational carousel 等）
- whyThisWorks：解释 hook + 为什么 save/share rate 会高
- imagePrompt：1:1 方版封面建议，editorial / lifestyle 调性，构图精致留白考究

# 严禁
❌ caption 第一行平淡——必须 hook
❌ 写成全段一坨——必须用换行/bullet 制造扫读节奏
❌ hashtag 用大写或带空格`,

      facebook: `你是 Facebook 主页内容运营专家，专精 meaningful interactions 优化（评论 > 分享 > 点赞 的算法权重）。${langInstruction}

# 你要做的
基于用户的业务/赛道，输出 3 套 Facebook 主页帖子方案。每套要给出：
- angle：内容切入角度
- title：作为帖子第一句（必须像朋友间真实对话或 newsworthy 开场，禁 clickbait 字眼）
- body：完整帖子正文，1-3 个短段落，对话感强。结尾必须用一个开放式问题引导评论
- tags：0-3 个 hashtag，仅在品牌活动场景使用
- style：风格定位（personal story / community question / behind-the-scenes / quick tip 等）
- whyThisWorks：解释为什么这个开场会引发评论而非划走
- imagePrompt：16:9 横版封面建议，主体清晰、可读性高、像新闻配图或故事图

# 严禁
❌ "You won't believe…" / "Shocking…" 等被算法降权的 clickbait
❌ "like if you agree" / "tag a friend" 这类 engagement bait（FB 会降低触达）
❌ 用太多 hashtag（FB 上 hashtag ROI 很低）`,
    };

    const xhsSystemPrompt = `你是一位运营过千万级粉丝账号的小红书顶级操盘手，专精于"爆款逆向工程"——拆解高赞笔记的底层逻辑、情绪触发器、信息密度、节奏感，然后用同样的爆款基因生成全新原创内容。${langInstruction}

# 你的工作流程（必须严格执行）

## Step 1: 深度拆解每一篇高赞笔记
对用户提供的每篇爆款，你要在脑中分析（不需要输出过程）：
- 标题用了什么钩子公式？（数字+痛点 / 反常识 / 对比反差 / 悬念缺口 / 身份标签 / 场景代入）
- 开头第一句话怎么抓住人？（绝对不是"大家好"！）
- 正文用了什么叙事结构？（个人故事线 / 对比测评 / 步骤拆解 / 避坑清单 / 反转剧情）
- 制造了什么情绪？（焦虑→解决 / 惊讶→好奇 / 共鸣→认同 / 愤怒→站队 / FOMO→收藏）
- 标签策略是怎样的？

## Step 2: 归纳爆款共同模式
找出20篇里反复出现的成功公式，分3-4类。

## Step 3: 用爆款公式生成3套伪原创
每套方案必须基于一个具体的爆款公式重新创作。

# 🚨 严禁违规（违反任意一条该方案作废，必须重写）

❌ **禁用废话开头**：绝对不能用"大家好"、"今天和大家分享"、"今天来聊聊"、"hi大家"、"姐妹们"开头
❌ **禁用模板套话**：不能写"希望对你有帮助"、"喜欢的话点赞收藏"、"有问题评论区见"这种结尾
❌ **禁用空洞描述**：不能写"效果超乎想象"、"真的很惊艳"、"强烈推荐"这种没有具体细节的形容词
❌ **禁用通用文案**：每篇必须有具体的数字、价格、时间、产品名、地名、人物对话等真实细节
❌ **禁止假人设**：不要瞎编"做了10年从业者"这种无法验证的身份

# ✅ 爆款开头公式（必须从中选一个）

1. **数字暴击**："花了8800做完面雕，第3天我后悔了" / "在新加坡踩了3个面雕的雷，第4家终于对了"
2. **痛点直戳**："脸垮、苹果肌下垂、法令纹深，这3个问题我用了2年终于搞懂"
3. **反常识断言**："别再做面雕了！90%的人都搞错了一件事"
4. **对话场景**："上周闺蜜见我第一句话是：你是不是去整容了？"
5. **悬念缺口**："去新加坡5家面雕诊所对比下来，我只敢推荐这一家"
6. **结果先行**："27岁苹果肌掉了，3个月把脸提回去的真实记录"
7. **身份标签**："新加坡留学生省钱版面雕攻略｜本地诊所亲测"
8. **反转开头**："以为做完会很疼，结果...完全没想到"

# ✅ 爆款正文结构（每篇必须遵循 — 仅作为内部写作骨架，下面这些标签名【绝对禁止】出现在 body 文字里）

⚠️【极其重要】下面的"钩子/背景/干货/高潮/互动"是**写作思路骨架**，不是要写进笔记的章节标题！
✗ 错误示范：body 里出现 "【背景段】我是新加坡留学生..."、"【干货段】1. 治疗过程..."
✓ 正确示范：body 直接是流畅的正文，自然过渡，读者读不出任何分段标签

骨架（按顺序写，但不要写出标签名）：
1. 开头 1-2 句 → 用上面8种开头之一，瞬间抓住眼球
2. 紧接着 2-3 句铺垫 → 我是谁、为什么写这篇、什么具体场景促使我分享（要有真实细节）
3. 主体 3-5 个小段落 → 必须有：①具体步骤/对比 ②真实数据/价格/时间 ③踩过的坑或意外发现 ④独特视角或行业内幕（可用"1. 2. 3."或 emoji 起头分点，但不要写"干货段"三个字）
4. 接近结尾 2-3 句 → 制造情绪峰值：意外结果/反差对比/重要警告/独家tips
5. 最后 1-2 句 → 不要"喜欢就点赞"，要具体提问引导评论：如"你们做面雕花了多少钱？""有人和我一样的经历吗？"

# ✅ 表达技巧

- 每段不超过3行，大量使用换行制造呼吸感
- emoji要服务于内容（💡=tip / ⚠️=警告 / 🔥=重点 / 💸=花费 / ✨=效果），不要乱撒
- 多用具体数字（不说"很多人"，说"我问了12个朋友"）
- 多用对话/引语（"医生当时说..." / "闺蜜看完愣了一下"）

# JSON返回格式

{
  "analysis": {
    "industry": "行业分析概要（1-2句话）",
    "targetAudience": "目标受众画像（年龄、性别、消费能力、痛点）",
    "contentStrategy": "推荐的内容策略（2-3句话）",
    "popularAngles": ["热门切入角度1", "热门切入角度2", "热门切入角度3"],
    "competitorInsights": "竞品爆款深度分析（4-6句话）：明确指出最高赞那篇用了什么开头公式、什么叙事结构、什么情绪钩子。指出20篇笔记里反复出现的成功模式。",
    "viralPatterns": "爆款模式总结：将20篇归为3-4个内容类型，每个类型说明：①标题公式 ②开头钩子 ③叙事结构 ④为什么这种类型在该地区高赞",
    "experienceSummary": ["可直接执行的经验1（带数据/对比，如：'标题前置数字的笔记平均点赞高47%'）", "经验2", "经验3", "经验4", "经验5", "经验6", "经验7", "经验8"],
    "bestPostingTimes": ["推荐发布时间1（如：周一 12:00-13:00）", "推荐发布时间2", "推荐发布时间3"],
    "postingTimeReason": "为什么推荐这些时间段（基于该地区行业特点和用户活跃规律）"
  },
  "suggestions": [
    {
      "angle": "内容切入角度（要具体，如：避坑指南/真实测评/踩雷警告/省钱攻略，不要写"个人体验"这种泛词）",
      "title": "标题（必须使用爆款标题公式，禁止平淡描述）",
      "body": "完整笔记正文（350-550字，按钩子→背景→干货→高潮→互动的内在节奏来写，但**绝对不能出现'【钩子段】【背景段】【干货段】【高潮段】【互动段】'这些标签字样**——它们只是写作思路，不是章节标题。必须从8种爆款开头公式之一开始，绝对禁用'大家好'）",
      "tags": ["标签1从爆款标签池挑", "标签2从爆款标签池挑", "标签3从爆款标签池挑", "长尾标签4", "长尾标签5", "长尾标签6"],
      "style": "内容风格描述（如：测评对比体/踩坑警告体/干货清单体/真实记录体）",
      "mimicSource": "明确说：本方案借鉴第N篇《XXX标题》的YY模式（必填，便于用户对照原帖）",
      "whyThisWorks": "明确说明：①用了什么开头公式 ②用了什么叙事结构 ③为什么对该地区受众有效（3-4句话，要具体）",
      "imagePrompt": "配图建议（具体描述画面主体、构图、色调、风格、氛围；要呼应爆款封面的视觉语言）"
    }
  ]
}

# 最终质量自检（每个suggestion必须通过）

1. 标题第一眼会不会让人想点？不会→重写
2. 正文第一句话能不能让人停下手指？不能→重写
3. 有没有"大家好/今天分享/姐妹们"等废话开头？有→重写
4. 有没有具体的数字、价格、时间、地名、产品名？没有→加上
5. 接近结尾有没有制造记忆点？没有→加上
6. 整篇读起来像不像一个真实的人在分享真实经历？不像→重写
7. **body 里有没有出现"【钩子段】【开场段】【背景段】【干货段】【高潮段】【互动段】"等结构标签字样？有 → 必须删除！这些只是写作思路，绝不能出现在正文里**

# 最终核心规则

- suggestions 必须正好3个，每个方案借鉴不同类型的爆款模式（建议：一个走情绪共鸣、一个走干货实用、一个走反差悬念）
- 每个方案的标题、开头、叙事结构、情绪钩子必须有明显差异
- 必须根据目标地区（新加坡/香港/马来西亚）的本地文化、消费习惯、地名、价格水平来定制内容
- 标签要精准，混合使用行业大词+长尾词+热门话题词+地域标签
- bestPostingTimes 要根据目标地区该行业的受众活跃时间推荐3个具体时间段
- 整体输出必须达到"用户看完后会觉得：哇，这个AI是真的看懂了同行爆款"的水平`;

    // 非小红书平台用更通用的 JSON schema 提示
    const NON_XHS_JSON_TAIL = `

# JSON 返回格式（必须严格遵守）

{
  "analysis": {
    "industry": "行业概要 1-2 句",
    "targetAudience": "受众画像（年龄/性别/兴趣/痛点）",
    "contentStrategy": "推荐内容策略 2-3 句",
    "popularAngles": ["角度1","角度2","角度3"],
    "competitorInsights": "同行 / 平台爆款规律 4-6 句",
    "viralPatterns": "该平台 3-4 种主流爆款类型 + 各自公式",
    "experienceSummary": ["可执行经验1","2","3","4","5","6"],
    "bestPostingTimes": ["时间段1","时间段2","时间段3"],
    "postingTimeReason": "为什么这些时间段"
  },
  "suggestions": [
    { "angle":"...", "title":"...", "body":"...", "tags":["..."], "style":"...", "whyThisWorks":"...", "imagePrompt":"..." }
  ]
}

suggestions 必须正好 3 个。每个走不同角度。`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: isXhs ? xhsSystemPrompt : (PLATFORM_SYSTEM_PROMPTS[platform] + NON_XHS_JSON_TAIL),
        },
        {
          role: "user",
          content: inputContext,
        },
      ],
      max_tokens: 6000,
      temperature: 0.85,
    });

    const raw = completion.choices[0]?.message?.content || "";
    const result = safeJsonParse(raw);

    if (!result || !Array.isArray(result.suggestions) || result.suggestions.length === 0) {
      res.status(500).json({ error: "AI返回格式异常，请重试" });
      return;
    }

    // 后端兜底：剥掉 AI 偶尔会漏出的结构标签（【钩子段】【背景段】【干货段】等）
    const stripStructureLabels = (text: string): string => {
      if (typeof text !== "string") return text;
      return text
        // 去掉行首的【XX段】或 【XX段】(说明) 字样，包括后面紧跟的标点
        .replace(/【\s*(钩子|开场|背景|干货|高潮|互动|结尾|引子|铺垫)段\s*】\s*[:：]?\s*/g, "")
        // 去掉无前缀的 (1-2句话) 等空括号说明
        .replace(/[（(]\s*\d+[-–~]\d+\s*句话?\s*[)）]/g, "")
        // 清理因删除留下的多余空行
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    };

    const validSuggestions = result.suggestions
      .filter((s: any) => s && typeof s.title === "string" && typeof s.body === "string")
      .map((s: any) => ({
        ...s,
        title: stripStructureLabels(s.title),
        body: stripStructureLabels(s.body),
        mimicSource: typeof s.mimicSource === "string" ? s.mimicSource : "",
      }))
      .slice(0, 3);

    // 把 experienceSummary 也兜底为数组
    if (result.analysis && !Array.isArray(result.analysis.experienceSummary)) {
      result.analysis.experienceSummary = [];
    }

    if (validSuggestions.length === 0) {
      res.status(500).json({ error: "AI返回格式异常，请重试" });
      return;
    }

    await deductCredits(req, "ai-competitor-research");
    res.json({
      analysis: result.analysis || {},
      suggestions: validSuggestions,
      dataSource,
      competitorNotes,
      personalProfileApplied: contentProfileSampleSize >= 3,
      personalProfileSampleSize: contentProfileSampleSize,
    });
  } catch (err) {
    req.log.error(err, "Failed to do competitor research");
    res.status(500).json({ error: "竞品分析失败，请稍后重试" });
  }
});

router.post("/ai/guide", requireCredits("ai-guide"), async (req, res): Promise<void> => {
  try {
    const { messages, currentPage, workflowStep, accountRegion } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "messages is required" });
      return;
    }

    const stepNum = typeof workflowStep === "number" ? workflowStep : null;
    const stepNames: Record<number, string> = { 1: "分析爆款", 2: "生成内容", 3: "发布" };
    const currentStepName = stepNum ? stepNames[stepNum] || "" : "";
    const regionStr = typeof accountRegion === "string" ? accountRegion : "";
    const isHKGuide = regionStr === "HK";

    const systemPrompt = `你是一位资深的小红书运营专家和AI助手，名叫"小红助手"。你深入了解小红书平台的算法机制、内容创作技巧、运营策略和最新趋势。你不仅是顾问，更是用户的运营教练和心理支持者。${isHKGuide ? "\n\n重要：当前用户的目标受众是香港地区，请用繁體中文回复，并融入香港本地化的表达方式和文化元素。了解香港用户在小红书上的特殊习惯和偏好。" : ""}

你的核心职责：
1. **主动引导**：根据用户当前所在步骤，主动提供最相关的建议，而不是等用户提问
2. **实操为主**：每个建议都要具体到可以立刻执行，给出模板和示例
3. **心理激励**：适时鼓励用户，缓解创作焦虑，让用户感到"我也能做到"
4. **策略思维**：帮用户看到内容背后的逻辑，建立系统化运营思维
5. **数据敏感**：基于小红书算法逻辑给出可量化的目标和预期

用户当前所在页面：${currentPage || "未知"}
${stepNum ? `用户正处于创作向导的【步骤${stepNum}: ${currentStepName}】` : ""}
${regionStr ? `用户选择的账号地区：${regionStr}` : ""}
${currentPage === "/workflow" ? `
创作向导有3个步骤，用户当前在步骤${stepNum || "未知"}：
${stepNum === 1 ? "【当前：灵感研究】这是核心功能！页面顶部有快速账号选择器，用户需要输入业务描述，AI会分析同行并生成3套内容方案，同时推荐最佳发布时间。主动引导用户描述清楚业务特点、目标客群、竞品名称。提醒用户：描述越详细，生成的方案越精准。" : ""}
${stepNum === 2 ? "【当前：创作内容】用户正在编辑笔记，右侧有实时预览和AI工具（包括伪原创配图功能，可上传竞品图片生成类似风格原创图）。帮助优化标题（使用爆款公式：数字+痛点+解决方案）、正文（前3行是黄金区域，要有hook）、标签（3个大词+3个长尾词）、配图（封面决定点击率）。提醒检查：1)标题是否超20字 2)正文是否有违禁词 3)配图是否清晰 4)标签是否精准。" : ""}
${stepNum === 3 ? "【当前：发布】内容已自动复制到剪贴板，图片/视频需要先下载再手动上传到创作中心。页面会显示AI推荐的最佳发布时间。提醒发布后的互动策略：1)黄金2小时内回复每条评论 2)引导互动 3)观察数据。恭喜用户完成创作流程！" : ""}
${!stepNum ? "用户正在使用创作发布向导，帮助其完成从灵感研究到发布的全流程。" : ""}` : ""}
${currentPage === "/content" ? "用户在查看内容列表。可以帮用户分析内容表现规律，提出优化已有内容、复制爆款模式的建议。" : ""}
${currentPage === "/dashboard" ? "用户在查看仪表盘。帮用户解读数据趋势，制定下一步运营计划，保持运营节奏。" : ""}
${currentPage === "/accounts" ? "用户在管理账号。提供多账号矩阵运营策略，不同地区（新加坡/香港/马来西亚）的本地化内容建议。" : ""}

回复规则：
- ${isHKGuide ? "使用繁體中文回复，融入香港本地化表达" : "使用简体中文回复"}，像朋友聊天一样自然
- 每次回复控制在150字以内，精简到位
- 一次只给1-2个核心建议，不要罗列太多
- 用短句，避免长段落和复杂结构
- 少用emoji，最多1-2个
- 直接给答案，不要铺垫和客套
- 如果需要示例，给1个最佳示例即可
- 不要重复用户已知的信息
- 语气专业但亲切，像资深同事而非客服`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.slice(-8).map((m: any) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ],
      max_tokens: 500,
      temperature: 0.7,
    });

    const response = completion.choices[0]?.message?.content || "抱歉，我暂时无法回复。";
    await deductCredits(req, "ai-guide");
    res.json({ response });
  } catch (err) {
    req.log.error(err, "Failed to get AI guide response");
    res.status(500).json({ error: "AI向导暂时不可用" });
  }
});

// 单条计划微调（不重新生成全部）：在发布计划页"修改这一条"时调用
router.post("/ai/refine-schedule-item", requireCredits("ai-rewrite"), async (req, res): Promise<void> => {
  try {
    const { current, instruction, niche, platform } = req.body as {
      current?: { title?: string; body?: string; tags?: string[] };
      instruction?: string;
      niche?: string;
      platform?: string;
    };
    if (!current || !instruction || !instruction.trim()) {
      res.status(400).json({ error: "current 与 instruction 必填" });
      return;
    }
    const platformLabel = platform === "tiktok" ? "TikTok" : platform === "instagram" ? "Instagram" : platform === "facebook" ? "Facebook" : "小红书";
    const sys = `你是${platformLabel}爆款内容编辑。用户已经有一条已排程的内容，现在只想按指令"局部微调"这一条 — 不要扩写到不相关方向，保持与原意一致。
输出严格 JSON：{"title": string, "body": string, "tags": string[]}。
- title <= 30 字，吸睛
- body 保留原本的核心信息，按指令调整语气/长度/卖点
- tags 3-8 个，去 # 号`;

    const userMsg = `${niche ? `行业：${niche}\n` : ""}原标题：${current.title || ""}
原正文：
${current.body || ""}
原标签：${(current.tags || []).join(", ")}

修改指令：${instruction}

请输出修改后的 JSON。`;

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userMsg },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
    });
    const text = resp.choices[0]?.message?.content || "{}";
    let parsed: { title?: string; body?: string; tags?: string[] };
    try { parsed = JSON.parse(text); } catch { parsed = {}; }

    await deductCredits(req, "ai-rewrite");
    res.json({
      title: (parsed.title || current.title || "").slice(0, 200),
      body: parsed.body || current.body || "",
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 10) : (current.tags || []),
    });
  } catch (err) {
    req.log.error(err, "Failed to refine schedule item");
    res.status(500).json({ error: "AI 微调失败，请重试" });
  }
});

// 校验"用户输入的本轮目标 niche"是否跟"账号自身画像"对齐。
// 防止用户绑了美妆号、却临时输入"美食"导致 AI 全程用错位语境跑流水线。
// 返回 { fit: 0-1, accountSummary, suggestedNiche, reason }；前端 fit < 0.5 时弹确认对话框。
router.post("/ai/check-niche-fit", async (req, res): Promise<void> => {
  try {
    const { accountId, niche } = req.body as { accountId?: number; niche?: string };
    if (!accountId || !niche || !niche.trim()) {
      res.status(400).json({ error: "accountId 与 niche 必填" });
      return;
    }
    const u = await ensureUser(req);
    if (!u) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const userId = u.id as number;
    const [account] = await db
      .select()
      .from(accountsTable)
      .where(and(eq(accountsTable.id, accountId), eq(accountsTable.ownerUserId, userId)))
      .limit(1);
    if (!account) {
      res.status(404).json({ error: "账号不存在或无权限" });
      return;
    }

    // 抓该账号最近 5 条已发/草稿内容标题，作为画像佐证
    const recentPosts = await db
      .select({ title: contentTable.title })
      .from(contentTable)
      .where(and(eq(contentTable.accountId, accountId), eq(contentTable.ownerUserId, userId)))
      .orderBy(desc(contentTable.createdAt))
      .limit(5);
    const recentTitles = recentPosts.map((p) => p.title).filter(Boolean);

    const accountSummary = [
      `昵称：${account.nickname}`,
      account.notes ? `画像备注：${account.notes}` : null,
      recentTitles.length > 0 ? `近期内容标题：${recentTitles.join(" / ")}` : "（账号还没有任何内容历史）",
    ].filter(Boolean).join("\n");

    const sys = `你是社媒账号定位审计员。判断【用户本次输入的目标行业】是否跟【账号已有画像】方向一致。
严格输出 JSON：{"fit": 0到1的小数, "suggestedNiche": "从账号画像推断的核心赛道（≤10字）", "reason": "≤40字一句话说明"}。
判分标准：
- 0.8-1.0：高度一致或属于同一大类
- 0.5-0.8：相邻领域（如美妆↔个护、母婴↔家居），可顺势拓展
- 0-0.5：明显错位（如美妆账号要做财经、宠物号要做职场），强烈建议确认
账号无任何内容历史时给 fit=1（无据可比，不要拦截）。`;

    const userMsg = `【账号画像】
${accountSummary}

【本次目标行业】${niche.trim()}

输出 JSON。`;

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userMsg },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });
    const text = resp.choices[0]?.message?.content || "{}";
    const parsed = safeJsonParse(text) || {};
    const fit = Math.max(0, Math.min(1, Number(parsed.fit) || 0));
    res.json({
      fit,
      accountSummary,
      suggestedNiche: typeof parsed.suggestedNiche === "string" ? parsed.suggestedNiche.slice(0, 30) : "",
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 80) : "",
      hasHistory: recentTitles.length > 0,
    });
  } catch (err) {
    req.log.error(err, "Failed to check niche fit");
    // 校验失败不能阻断主流程，返回 fit=1 让前端正常往下走
    res.json({ fit: 1, accountSummary: "", suggestedNiche: "", reason: "(校验服务暂时不可用)", hasHistory: false });
  }
});

router.post("/ai/generate-weekly-plan", requireCredits("ai-guide"), async (req, res): Promise<void> => {
  try {
    const u = await ensureUser(req);
    if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }

    const body = req.body as Partial<GenerateWeeklyPlanInput>;
    const ALLOWED_PLATFORMS: GenerateWeeklyPlanInput["platform"][] = ["xhs", "tiktok", "instagram", "facebook"];
    const ALLOWED_FREQ = ["daily", "twice-daily", "every-other-day", "weekly-3"] as const;
    if (!body?.platform || !ALLOWED_PLATFORMS.includes(body.platform)) {
      res.status(400).json({ error: "platform 非法" });
      return;
    }
    if (!body?.niche || typeof body.niche !== "string" || body.niche.trim().length < 2) {
      res.status(400).json({ error: "niche 必填（至少 2 个字符）" });
      return;
    }
    const freq = body.frequency && (ALLOWED_FREQ as readonly string[]).includes(body.frequency) ? body.frequency : "daily";

    // 必须先拉用户已收集的爆款数据作为上下文
    const viral = await loadViralContext({
      userId: u.id,
      platform: body.platform,
      niche: body.niche.trim(),
      region: body.region,
      maxPosts: 10,
    });

    // 拉品牌画像（per-platform），把 category/products/audience/tone/forbiddenClaims/conversionGoal 注入 prompt
    const [brand] = await db
      .select()
      .from(brandProfilesTable)
      .where(and(eq(brandProfilesTable.ownerUserId, u.id), eq(brandProfilesTable.platform, body.platform)));
    let brandBlock = "";
    if (brand) {
      const lines: string[] = [];
      if (brand.category) lines.push(`类目：${brand.category}`);
      if (brand.products) lines.push(`商品：${brand.products}`);
      if (brand.targetAudience) lines.push(`目标受众：${brand.targetAudience}`);
      if (brand.priceRange) lines.push(`价位带：${brand.priceRange}`);
      if (brand.tone) lines.push(`品牌调性：${brand.tone}`);
      if (brand.conversionGoal) lines.push(`转化目标：${brand.conversionGoal}`);
      const forbidden = Array.isArray(brand.forbiddenClaims) ? brand.forbiddenClaims.filter((x) => typeof x === "string" && x.trim().length > 0) : [];
      if (forbidden.length > 0) lines.push(`【禁用宣称】（绝对不能出现，包括同义词/暗示/反问）：${forbidden.join("、")}`);
      if (lines.length > 0) {
        // 截断防止用户填的超长品牌资料挤掉 prompt 主体或被模型误读为指令
        const body = lines.join("\n").slice(0, 1500);
        brandBlock = `\n\n[品牌画像 — 必须严格遵守]\n${body}`;
      }
    }

    const items = await generateWeeklyPlan({
      platform: body.platform,
      niche: body.niche.trim(),
      region: body.region,
      frequency: freq,
      audience: body.audience,
      styleHints: body.styleHints,
      language: body.language === "en" ? "en" : "zh",
      viralPromptBlock: viral.promptBlock,
      viralHashtags: viral.topHashtags,
      brandBlock,
    });

    await deductCredits(req, "ai-guide");
    res.json({
      items,
      viralMeta: {
        sampleCount: viral.sampleCount,
        hasViralData: viral.hasViralData,
        warning: viral.warning,
        topHashtags: viral.topHashtags.slice(0, 8),
      },
    });
  } catch (err: any) {
    req.log.error(err, "Failed to generate weekly plan");
    res.status(500).json({ error: err?.message || "AI 周计划生成失败" });
  }
});

export default router;
