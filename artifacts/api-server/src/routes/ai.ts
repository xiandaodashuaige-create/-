import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { db, sensitiveWordsTable } from "@workspace/db";
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
import { requireCredits, deductCredits, ensureUser } from "../middlewares/creditSystem";
import { ComfyUIClient } from "../services/comfyui.js";
import { analyzeCompetitorImage, generateImagePrompt } from "../services/imagePipeline.js";
import { tryFetchXhsData } from "./xhs";

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

    const { originalContent, style, region, additionalInstructions } = parsed.data;

    const regionContext = region
      ? region === "HK"
        ? "Target audience is in Hong Kong. IMPORTANT: You MUST write ALL content in Traditional Chinese (繁體中文) with natural Hong Kong Cantonese expressions and tone. Use Hong Kong local vocabulary (e.g., 搵=找, 嘅=的, 啲=些, 唔=不, 俾=给, 揀=选). The audience speaks Cantonese and reads Traditional Chinese characters."
        : `Target audience is in ${region === "SG" ? "Singapore" : "Malaysia"}. Write in Simplified Chinese.`
      : "";

    const styleContext = style
      ? `Writing style: ${style}.`
      : "Writing style: casual and engaging.";

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 4096,
      messages: [
        {
          role: "system",
          content: `You are a professional Xiaohongshu (Little Red Book) content writer. Your job is to rewrite content to be original, engaging, and optimized for the platform. ${regionContext} ${styleContext}
        
Rules:
- Keep the core message and information but rewrite completely
- Use natural, conversational Chinese${region === "HK" ? " (Traditional Chinese / 繁體中文 with Hong Kong expressions)" : ""}
- Add appropriate line breaks and formatting for readability
- Make it feel authentic and personal, not like AI-generated content
- Avoid any sensitive or banned words on Xiaohongshu
${additionalInstructions ? `Additional instructions: ${additionalInstructions}` : ""}

Respond in JSON format:
{
  "rewrittenTitle": "catchy title here",
  "rewrittenBody": "rewritten content here",
  "suggestedTags": ["tag1", "tag2", "tag3"]
}`,
        },
        {
          role: "user",
          content: `Please rewrite this content for Xiaohongshu:\n\n${originalContent}`,
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

router.post("/ai/check-sensitivity", requireCredits("ai-check-sensitivity"), async (req, res): Promise<void> => {
  try {
    const parsed = AiCheckSensitivityBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { title, body } = parsed.data;

    const customWords = await db.select().from(sensitiveWordsTable);
    const wordList = customWords.map((w) => `${w.word} (${w.category}, ${w.severity})`).join("\n");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 4096,
      messages: [
        {
          role: "system",
          content: `You are a Xiaohongshu content compliance checker. Analyze the given content for potential violations of Xiaohongshu's community guidelines and advertising rules.

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

    const { body: contentBody, style, count } = parsed.data;
    const titleCount = count || 5;

    const styleHint = style
      ? `Style: ${style}.`
      : "Style: engaging and eye-catching.";

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 4096,
      messages: [
        {
          role: "system",
          content: `You are a Xiaohongshu title expert. Generate ${titleCount} catchy, click-worthy titles for the given content. ${styleHint}

Rules for good XHS titles:
- Use numbers when appropriate (e.g., "5 must-try...")
- Include emotional hooks
- Keep under 20 Chinese characters when possible
- Use trending formats on Xiaohongshu
- Mix different styles: question, exclamation, list, story

Respond in JSON format:
{
  "titles": ["title1", "title2", ...]
}`,
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

    const { title, body: contentBody, count } = parsed.data;
    const tagCount = count || 10;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 4096,
      messages: [
        {
          role: "system",
          content: `You are a Xiaohongshu hashtag expert. Generate ${tagCount} relevant hashtags for the given content.

Rules:
- Mix popular and niche hashtags
- Include Chinese hashtags
- Consider trending topics
- Include category-specific tags
- Format without # symbol

Respond in JSON format:
{
  "hashtags": ["hashtag1", "hashtag2", ...]
}`,
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

    const { toFile } = await import("openai");
    const imageFile = await toFile(refImageBuffer, "reference.png", { type: "image/png" });

    const fullPrompt = `参考这张图片的构图、配色和风格，创作一张全新的、与之风格相似但内容不同的图片。要求：${prompt}. 保持小红书风格，精美、高质量、适合社交媒体展示。`;

    const response = await openai.images.edit({
      model: "gpt-image-1",
      image: imageFile,
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
    const { referenceImageUrl, newTopic, newTitle, newKeyPoints, mimicStrength, customTextOverlays, size } = req.body;

    if (!referenceImageUrl || typeof referenceImageUrl !== "string") {
      res.status(400).json({ error: "referenceImageUrl is required" });
      return;
    }
    if (!newTopic || typeof newTopic !== "string") {
      res.status(400).json({ error: "newTopic is required" });
      return;
    }

    const strength = ["full", "partial", "minimal"].includes(mimicStrength) ? mimicStrength : "partial";

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

    req.log.info("Pipeline step 2: prompt generation");
    const promptResult = await generateImagePrompt({
      analysis,
      newTopic,
      newTitle,
      newKeyPoints: Array.isArray(newKeyPoints) ? newKeyPoints : undefined,
      mimicStrength: strength,
      customTextOverlays: Array.isArray(customTextOverlays) ? customTextOverlays : undefined,
    });

    req.log.info("Pipeline step 3: image generation");
    const imageSize = ["1024x1024", "1024x1536", "1536x1024"].includes(size)
      ? size
      : promptResult.recommendedSize;

    let imageBuffer: Buffer;
    let provider = "gpt-image-1";
    let durationMs = 0;
    const startGen = Date.now();

    const comfy = ComfyUIClient.fromEnv();
    if (comfy && referenceBuffer) {
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
    res.json({
      imageUrl: storedUrl,
      objectPath,
      storedUrl,
      analysis,
      promptUsed: promptResult.imagePrompt,
      textOverlays: promptResult.textToOverlay,
      provider,
      durationMs,
    });
  } catch (err: any) {
    req.log.error(err, "Image pipeline failed");
    const message = err?.message?.includes("content_policy")
      ? "图片内容不符合安全政策，请修改主题后重试"
      : "图片生成失败，请重试";
    res.status(500).json({ error: message });
  }
});

async function fetchImageAsBuffer(urlOrPath: string, req: any): Promise<Buffer> {
  const isExternal = urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://");
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

router.post("/ai/competitor-research", requireCredits("ai-competitor-research"), async (req, res): Promise<void> => {
  try {
    const { businessDescription, competitorLink, niche, region } = req.body;

    const bd = typeof businessDescription === "string" ? businessDescription.slice(0, 1000).trim() : "";
    const cl = typeof competitorLink === "string" ? competitorLink.slice(0, 500).trim() : "";
    const ni = typeof niche === "string" ? niche.slice(0, 200).trim() : "";
    const rg = typeof region === "string" ? region.slice(0, 10).trim() : "";

    if (!bd && !cl && !ni) {
      res.status(400).json({ error: "请提供业务描述、对标链接或行业关键词" });
      return;
    }

    if (!rg || !["SG", "HK", "MY"].includes(rg)) {
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

    if (searchKeyword) {
      const xhsResult = await tryFetchXhsData(searchKeyword);
      dataSource = xhsResult.source;
      if (xhsResult.available && xhsResult.notes.length > 0) {
        competitorNotes = xhsResult.notes;
        const sorted = [...xhsResult.notes].sort((a: any, b: any) => (b.liked_count || 0) - (a.liked_count || 0));
        const noteSummaries = sorted.map((n: any, i: number) =>
          `${i + 1}. 「${n.title}」by @${n.author} — ❤️${n.liked_count} ⭐${n.collected_count} 💬${n.comment_count}${n.desc ? ` | 摘要: ${n.desc.slice(0, 80)}` : ""} | 标签: ${(n.tags || []).join(", ")}`
        ).join("\n");
        const avgLikes = Math.round(sorted.reduce((s: number, n: any) => s + (n.liked_count || 0), 0) / sorted.length);
        const avgCollected = Math.round(sorted.reduce((s: number, n: any) => s + (n.collected_count || 0), 0) / sorted.length);
        realDataContext = `\n\n📊 以下是该领域小红书${sorted.length}篇真实爆款笔记（按点赞数排序，来源：实时抓取）：
${noteSummaries}

📈 数据概览：共${sorted.length}篇，平均点赞${avgLikes}，平均收藏${avgCollected}，最高点赞${sorted[0]?.liked_count || 0}

⚠️ 核心任务：你必须深度分析以上全部${sorted.length}篇爆款笔记，完成以下工作：
1. 【分类归纳】将这些爆款按内容方向/角度分成3-5个类别（如：教程攻略类、个人体验类、测评对比类、避坑指南类、种草推荐类等）
2. 【爆款模式提炼】从标题、正文结构、情绪钩子、标签策略四个维度，总结每类爆款的成功规律
3. 【伪原创方案】基于提炼出的爆款模式，生成3套伪原创内容方案。每套方案必须：
   - 借鉴某篇/某类高赞笔记的成功模式（在whyThisWorks中说明参考了哪篇）
   - 标题使用该类爆款验证过的标题公式（数字+痛点、对比反差、好奇心缺口等）
   - 正文结构模仿爆款的行文逻辑，但内容完全原创
   - 标签策略参考高赞笔记的标签组合`;
      }
    }

    const inputContext = [
      bd ? `业务/品牌描述: ${bd}` : "",
      cl ? `对标参考链接/账号: ${cl}` : "",
      ni ? `行业/赛道: ${ni}` : "",
      rg ? `目标地区: ${rg === "SG" ? "新加坡" : rg === "HK" ? "香港" : "马来西亚"}` : "",
    ].filter(Boolean).join("\n") + realDataContext;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `你是一位运营过千万级粉丝账号的小红书顶级操盘手，专精于"爆款逆向工程"——拆解高赞笔记的底层逻辑、情绪触发器、信息密度、节奏感，然后用同样的爆款基因生成全新原创内容。${langInstruction}

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

# ✅ 爆款正文结构（每篇必须遵循）

【钩子段】(1-2句话) → 用上面8种开头之一，瞬间抓住眼球
【背景段】(2-3句话) → 我是谁、为什么写这篇、什么具体场景促使我分享（要有真实细节）
【干货段】(主体3-5个小段落) → 必须有：①具体步骤/对比 ②真实数据/价格/时间 ③踩过的坑或意外发现 ④独特视角或行业内幕
【高潮段】(2-3句话) → 制造情绪峰值：意外结果/反差对比/重要警告/独家tips
【互动段】(1-2句话) → 不要"喜欢就点赞"，要具体提问引导评论：如"你们做面雕花了多少钱？""有人和我一样的经历吗？"

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
    "bestPostingTimes": ["推荐发布时间1（如：周一 12:00-13:00）", "推荐发布时间2", "推荐发布时间3"],
    "postingTimeReason": "为什么推荐这些时间段（基于该地区行业特点和用户活跃规律）"
  },
  "suggestions": [
    {
      "angle": "内容切入角度（要具体，如：避坑指南/真实测评/踩雷警告/省钱攻略，不要写"个人体验"这种泛词）",
      "title": "标题（必须使用爆款标题公式，禁止平淡描述）",
      "body": "完整笔记正文（350-550字，严格按照【钩子→背景→干货→高潮→互动】五段结构。必须从8种爆款开头公式之一开始，绝对禁用'大家好'）",
      "tags": ["标签1", "标签2", "标签3", "标签4", "标签5", "标签6"],
      "style": "内容风格描述（如：测评对比体/踩坑警告体/干货清单体/真实记录体）",
      "whyThisWorks": "明确说明：①借鉴了第几篇爆款（标题）②用了什么开头公式 ③用了什么叙事结构 ④为什么对这个地区受众有效（3-4句话，要具体）",
      "imagePrompt": "配图建议（具体描述画面主体、构图、色调、风格、氛围）"
    }
  ]
}

# 最终质量自检（每个suggestion必须通过）

1. 标题第一眼会不会让人想点？不会→重写
2. 正文第一句话能不能让人停下手指？不能→重写
3. 有没有"大家好/今天分享/姐妹们"等废话开头？有→重写
4. 有没有具体的数字、价格、时间、地名、产品名？没有→加上
5. 高潮段有没有制造记忆点？没有→加上
6. 整篇读起来像不像一个真实的人在分享真实经历？不像→重写

# 最终核心规则

- suggestions 必须正好3个，每个方案借鉴不同类型的爆款模式（建议：一个走情绪共鸣、一个走干货实用、一个走反差悬念）
- 每个方案的标题、开头、叙事结构、情绪钩子必须有明显差异
- 必须根据目标地区（新加坡/香港/马来西亚）的本地文化、消费习惯、地名、价格水平来定制内容
- 标签要精准，混合使用行业大词+长尾词+热门话题词+地域标签
- bestPostingTimes 要根据目标地区该行业的受众活跃时间推荐3个具体时间段
- 整体输出必须达到"用户看完后会觉得：哇，这个AI是真的看懂了同行爆款"的水平`
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

    const validSuggestions = result.suggestions.filter(
      (s: any) => s && typeof s.title === "string" && typeof s.body === "string"
    ).slice(0, 3);

    if (validSuggestions.length === 0) {
      res.status(500).json({ error: "AI返回格式异常，请重试" });
      return;
    }

    await deductCredits(req, "ai-competitor-research");
    res.json({ analysis: result.analysis || {}, suggestions: validSuggestions, dataSource, competitorNotes });
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

export default router;
