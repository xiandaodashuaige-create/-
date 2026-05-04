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

const router: IRouter = Router();

function safeJsonParse(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

router.post("/ai/rewrite", async (req, res): Promise<void> => {
  try {
    const parsed = AiRewriteContentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { originalContent, style, region, additionalInstructions } = parsed.data;

    const regionContext = region
      ? `Target audience is in ${region === "SG" ? "Singapore" : region === "HK" ? "Hong Kong" : "Malaysia"}.`
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
- Use natural, conversational Chinese
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

router.post("/ai/check-sensitivity", async (req, res): Promise<void> => {
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

router.post("/ai/generate-title", async (req, res): Promise<void> => {
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

    res.json(AiGenerateTitleResponse.parse({ titles: result.titles || [] }));
  } catch (err) {
    req.log.error(err, "Failed to generate titles");
    res.status(500).json({ error: "AI service error" });
  }
});

router.post("/ai/generate-hashtags", async (req, res): Promise<void> => {
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

    res.json(AiGenerateHashtagsResponse.parse({ hashtags: result.hashtags || [] }));
  } catch (err) {
    req.log.error(err, "Failed to generate hashtags");
    res.status(500).json({ error: "AI service error" });
  }
});

export default router;
