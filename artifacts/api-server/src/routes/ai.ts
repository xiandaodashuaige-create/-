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
    const imageStyle = style || "小红书风格，精美，高质量";
    const fullPrompt = `${prompt}. Style: ${imageStyle}. High quality, professional, suitable for Xiaohongshu (Little Red Book) social media post.`;

    const response = await openai.images.generate({
      model: "gpt-image-1",
      prompt: fullPrompt,
      n: 1,
      size: imageSize as "1024x1024" | "1024x1536" | "1536x1024" | "auto",
      quality: "auto",
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

    const isHK = rg === "HK";
    const langInstruction = isHK
      ? "\n\n🔴 重要：目標受眾係香港人。你必須用繁體中文撰寫所有內容，並融入自然嘅香港廣東話口語表達（例如：搵、嘅、啲、唔、俾、揀、係、咗、嚟、喺）。標題同正文都要用繁體字，語氣要親切自然，符合香港人嘅閱讀習慣。標籤也用繁體中文。分析同行時要重點參考香港地區嘅小紅書爆款內容。"
      : "";

    const searchKeyword = ni || bd.slice(0, 20);
    let realDataContext = "";
    let dataSource = "ai-only";
    let competitorNotes: any[] = [];

    if (searchKeyword) {
      const xhsResult = await tryFetchXhsData(searchKeyword);
      dataSource = xhsResult.source;
      if (xhsResult.available && xhsResult.notes.length > 0) {
        competitorNotes = xhsResult.notes;
        const noteSummaries = xhsResult.notes.map((n: any, i: number) =>
          `${i + 1}. 「${n.title}」by @${n.author} — ❤️${n.liked_count} ⭐${n.collected_count} 💬${n.comment_count} | 标签: ${(n.tags || []).join(", ")}`
        ).join("\n");
        realDataContext = `\n\n📊 以下是该领域小红书真实热门笔记数据（来源：实时抓取）：\n${noteSummaries}\n\n请基于以上真实数据，分析这些爆款的共同特征（标题技巧、内容角度、标签策略），并据此生成更精准的内容方案。`;
      }
    }

    const inputContext = [
      bd ? `业务/品牌描述: ${bd}` : "",
      cl ? `对标参考链接/账号: ${cl}` : "",
      ni ? `行业/赛道: ${ni}` : "",
      rg ? `目标地区: ${rg === "SG" ? "新加坡" : rg === "HK" ? "香港" : "马来西亚"}` : "",
    ].filter(Boolean).join("\n") + realDataContext;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `你是一位资深的小红书内容策略专家。根据用户提供的业务信息、对标竞品或行业方向，分析该领域在目标地区的小红书内容策略，并生成3套完整的笔记内容方案供用户选择。${langInstruction}

你需要返回一个JSON对象，格式如下：
{
  "analysis": {
    "industry": "行业分析概要（1-2句话）",
    "targetAudience": "目标受众画像",
    "contentStrategy": "推荐的内容策略（2-3句话）",
    "popularAngles": ["热门切入角度1", "热门切入角度2", "热门切入角度3"],
    "competitorInsights": "竞品分析要点（2-3句话，分析同行在该地区的内容特点和成功要素）",
    "bestPostingTimes": ["推荐发布时间1（如：周一 12:00-13:00）", "推荐发布时间2", "推荐发布时间3"],
    "postingTimeReason": "为什么推荐这些时间段（基于该地区行业特点和用户活跃规律）"
  },
  "suggestions": [
    {
      "angle": "内容切入角度",
      "title": "推荐标题",
      "body": "完整笔记正文（200-400字，要有小红书风格，包含emoji，段落清晰，有个人感受和实用干货）",
      "tags": ["标签1", "标签2", "标签3", "标签4", "标签5"],
      "style": "内容风格描述",
      "whyThisWorks": "为什么这个方案有效（1句话）",
      "imagePrompt": "配图建议描述（可用于AI生成配图的prompt）"
    }
  ]
}

规则：
- suggestions 必须正好3个，每个方案的切入角度和风格要有明显差异
- 必须根据目标地区（新加坡/香港/马来西亚）的本地文化和市场特点来定制内容
- 标题要吸引人，符合小红书爆款标题特征（使用数字、感叹号、提问、对比等技巧）
- 正文要像真正的小红书用户写的，自然、亲切、有温度
- 标签要精准，包含行业大词和长尾词
- imagePrompt 要具体，适合AI图片生成
- bestPostingTimes 要根据目标地区该行业的受众活跃时间，推荐3个具体的发布时间段（包含星期几和具体时间），格式如"周一 12:00-13:00"
- postingTimeReason 解释推荐原因`
        },
        {
          role: "user",
          content: inputContext,
        },
      ],
      max_tokens: 3000,
      temperature: 0.8,
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
