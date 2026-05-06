import { Router, type IRouter } from "express";
import { eq, and, sql, type SQL } from "drizzle-orm";
import { db, contentTable, accountsTable, schedulesTable, publishLogsTable } from "@workspace/db";
import { dispatchContentToProvider, isAccountReadyToPublish } from "../services/publishDispatcher.js";
import { brandProfilesTable, strategiesTable } from "@workspace/db";
import { z } from "zod/v4";
import {
  CreateContentBody,
  GetContentParams,
  GetContentResponse,
  ListContentQueryParams,
  ListContentResponse,
  UpdateContentParams,
  UpdateContentBody,
  UpdateContentResponse,
  DeleteContentParams,
  ScheduleContentParams,
  ScheduleContentBody,
  ScheduleContentResponse,
  MarkContentPublishedParams,
  MarkContentPublishedResponse,
} from "@workspace/api-zod";
import { logActivity } from "../lib/activity";
import { requireCredits, deductCredits, ensureUser } from "../middlewares/creditSystem";
import { triggerContentProfileRecompute } from "../services/contentProfile.js";

const router: IRouter = Router();

function mapContentRow(row: any) {
  return {
    id: row.id,
    accountId: row.account_id,
    platform: row.platform || "xhs",
    mediaType: row.media_type || "image",
    parentContentId: row.parent_content_id ?? null,
    title: row.title,
    body: row.body,
    originalReference: row.original_reference,
    tags: row.tags || [],
    imageUrls: row.image_urls || [],
    videoUrl: row.video_url,
    ttsAudioUrl: row.tts_audio_url ?? null,
    status: row.status,
    sensitivityScore: row.sensitivity_score,
    sensitivityIssues: row.sensitivity_issues || [],
    scheduledAt: row.scheduled_at,
    publishedAt: row.published_at,
    remotePostId: row.remote_post_id ?? null,
    remotePostUrl: row.remote_post_url ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    account: row.account_id ? {
      id: row.account_id,
      platform: row.account_platform || row.platform || "xhs",
      nickname: row.account_nickname || "Unknown",
      region: row.account_region || "SG",
    } : null,
    // 账号已删除（account_id set null）时给前端一个明确标记，列表展示灰色徽标
    accountDeleted: !row.account_id,
  };
}

// 把 ORM 返回的 camelCase 行转成 mapContentRow 期望的 snake_case 形态
function ormRowToMapInput(content: any, account: any) {
  return {
    id: content.id,
    account_id: content.accountId,
    platform: content.platform,
    media_type: content.mediaType,
    parent_content_id: content.parentContentId,
    title: content.title,
    body: content.body,
    original_reference: content.originalReference,
    tags: content.tags,
    image_urls: content.imageUrls,
    video_url: content.videoUrl,
    tts_audio_url: content.ttsAudioUrl,
    status: content.status,
    sensitivity_score: content.sensitivityScore,
    sensitivity_issues: content.sensitivityIssues,
    scheduled_at: content.scheduledAt,
    published_at: content.publishedAt,
    remote_post_id: content.remotePostId,
    remote_post_url: content.remotePostUrl,
    created_at: content.createdAt,
    updated_at: content.updatedAt,
    account_nickname: account?.nickname,
    account_region: account?.region,
    account_platform: account?.platform,
  };
}

router.get("/content", async (req, res): Promise<void> => {
  try {
    const u = await ensureUser(req);
    if (!u) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const query = ListContentQueryParams.safeParse(req.query);
    // 租户隔离：以 c.owner_user_id 为准，LEFT JOIN accounts 保留账号已删除的孤儿内容
    const conditions: SQL[] = [sql`c.owner_user_id = ${u.id}`];

    if (query.success) {
      if (query.data.accountId) {
        conditions.push(sql`c.account_id = ${query.data.accountId}`);
      }
      if (query.data.platform && query.data.platform !== "ALL") {
        conditions.push(sql`c.platform = ${query.data.platform}`);
      }
      if (query.data.status && query.data.status !== "all") {
        conditions.push(sql`c.status = ${query.data.status}`);
      }
      if (query.data.region && query.data.region !== "ALL") {
        // 账号已删除的孤儿行没有 region，按用户筛选 region 时自然排除
        conditions.push(sql`a.region = ${query.data.region}`);
      }
    }

    const whereClause = sql`WHERE ${sql.join(conditions, sql` AND `)}`;

    const rows = await db.execute(sql`
      SELECT c.*, a.nickname as account_nickname, a.region as account_region, a.platform as account_platform
      FROM content c
      LEFT JOIN accounts a ON c.account_id = a.id
      ${whereClause}
      ORDER BY c.created_at DESC
    `);

    const result = (rows.rows as any[]).map(mapContentRow);
    res.json(ListContentResponse.parse(result));
  } catch (err) {
    req.log.error(err, "Failed to list content");
    res.status(500).json({ error: "Internal server error" });
  }
});

// 内部辅助：校验某 accountId 是否属于当前用户，返回该 account（或 null）
async function loadOwnedAccount(accountId: number, userId: number) {
  if (!accountId) return null;
  const [a] = await db.select().from(accountsTable)
    .where(and(eq(accountsTable.id, accountId), eq(accountsTable.ownerUserId, userId)));
  return a ?? null;
}

// 内部辅助：根据 contentId 加载内容并验证归属（以 c.owner_user_id 为准；LEFT JOIN 保留账号已删除的孤儿内容）
async function loadOwnedContent(contentId: number, userId: number) {
  const rows = await db.execute(sql`
    SELECT c.*, a.nickname as account_nickname, a.region as account_region, a.platform as account_platform, a.owner_user_id as account_owner_user_id
    FROM content c
    LEFT JOIN accounts a ON c.account_id = a.id
    WHERE c.id = ${contentId} AND c.owner_user_id = ${userId}
    LIMIT 1
  `);
  return rows.rows[0] ?? null;
}

router.post("/content", requireCredits("content-create"), async (req, res): Promise<void> => {
  try {
    const parsed = CreateContentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const u = await ensureUser(req);
    if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }

    const accountIdVal = parsed.data.accountId && parsed.data.accountId > 0 ? parsed.data.accountId : null;
    if (!accountIdVal) {
      res.status(400).json({ error: "accountId is required" });
      return;
    }

    const account = await loadOwnedAccount(accountIdVal, u.id);
    if (!account) {
      res.status(403).json({ error: "Account not found or not owned" });
      return;
    }

    // platform 来源优先级：body.platform > account.platform > "xhs"
    const platform = parsed.data.platform || account.platform || "xhs";
    const mediaType = parsed.data.mediaType || (platform === "tiktok" ? "video" : "image");

    const [content] = await db
      .insert(contentTable)
      .values({
        ownerUserId: u.id,
        accountId: accountIdVal,
        platform,
        mediaType,
        parentContentId: parsed.data.parentContentId ?? null,
        title: parsed.data.title,
        body: parsed.data.body,
        originalReference: parsed.data.originalReference,
        tags: parsed.data.tags || [],
        imageUrls: parsed.data.imageUrls || [],
        videoUrl: parsed.data.videoUrl,
        ttsAudioUrl: parsed.data.ttsAudioUrl,
      })
      .returning();

    await db
      .update(accountsTable)
      .set({ contentCount: sql`content_count + 1`, lastActiveAt: new Date() })
      .where(eq(accountsTable.id, accountIdVal));

    await logActivity("content_created", `Created (${platform}): ${content.title}`, content.id, content.accountId ?? undefined);

    const result = mapContentRow(ormRowToMapInput(content, account));
    const parsed_result = GetContentResponse.parse(result);
    await deductCredits(req, "content-create");

    try { triggerContentProfileRecompute(u.id); } catch { /* ignore */ }

    res.status(201).json(parsed_result);
  } catch (err) {
    req.log.error(err, "Failed to create content");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/content/:id", async (req, res): Promise<void> => {
  try {
    const params = GetContentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const u = await ensureUser(req);
    if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }

    const row = await loadOwnedContent(params.data.id, u.id);
    if (!row) {
      res.status(404).json({ error: "Content not found" });
      return;
    }

    res.json(GetContentResponse.parse(mapContentRow(row)));
  } catch (err) {
    req.log.error(err, "Failed to get content");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/content/:id", async (req, res): Promise<void> => {
  try {
    const params = UpdateContentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const parsed = UpdateContentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const u = await ensureUser(req);
    if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }

    // 先验证归属
    const owned = await loadOwnedContent(params.data.id, u.id);
    if (!owned) {
      res.status(404).json({ error: "Content not found" });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
    if (parsed.data.body !== undefined) updateData.body = parsed.data.body;
    if (parsed.data.originalReference !== undefined) updateData.originalReference = parsed.data.originalReference;
    if (parsed.data.tags !== undefined) updateData.tags = parsed.data.tags;
    if (parsed.data.imageUrls !== undefined) updateData.imageUrls = parsed.data.imageUrls;
    if (parsed.data.videoUrl !== undefined) updateData.videoUrl = parsed.data.videoUrl;
    if (parsed.data.platform !== undefined) updateData.platform = parsed.data.platform;
    if (parsed.data.mediaType !== undefined) updateData.mediaType = parsed.data.mediaType;
    if (parsed.data.ttsAudioUrl !== undefined) updateData.ttsAudioUrl = parsed.data.ttsAudioUrl;

    const [content] = await db
      .update(contentTable)
      .set(updateData)
      .where(eq(contentTable.id, params.data.id))
      .returning();

    const [account] = await db.select().from(accountsTable).where(eq(accountsTable.id, content.accountId!));

    const result = mapContentRow(ormRowToMapInput(content, account));

    try { triggerContentProfileRecompute(u.id); } catch { /* ignore */ }

    res.json(UpdateContentResponse.parse(result));
  } catch (err) {
    req.log.error(err, "Failed to update content");
    res.status(500).json({ error: "Internal server error" });
  }
});

// T8：根据 strategy 一键建草稿（autopilot 内部 + 用户手动复用）
const FromStrategySchema = z.object({
  strategyId: z.number().int().positive().optional(),
  accountId: z.number().int().positive(),
  platform: z.enum(["xhs", "tiktok", "instagram", "facebook"]).optional(),
  // 直接传 StrategyCard 时（不持久化），用 inline 字段覆盖
  title: z.string().max(200).optional(),
  body: z.string().max(20000).optional(),
  tags: z.array(z.string()).max(20).optional(),
  imageUrls: z.array(z.string()).max(20).optional(),
  videoUrl: z.string().nullable().optional(),
  mediaType: z.enum(["image", "video", "text"]).optional(),
  // 把策略卡内的 voiceoverScript / coverPrompt 等也存入 originalReference 便于复溯
  originalReference: z.string().max(20000).nullable().optional(),
});
router.post("/content/from-strategy", requireCredits("content-create"), async (req, res): Promise<void> => {
  try {
    const u = await ensureUser(req);
    if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }
    const parsed = FromStrategySchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
    const data = parsed.data;

    const account = await loadOwnedAccount(data.accountId, u.id);
    if (!account) { res.status(403).json({ error: "Account not found or not owned" }); return; }

    let title = data.title?.trim() || "未命名";
    let body = data.body ?? "";
    let tags = data.tags ?? [];
    let mediaType: "image" | "video" | "text" = data.mediaType ?? (account.platform === "tiktok" ? "video" : "image");
    let originalReference = data.originalReference ?? null;

    // 若给了 strategyId，从策略卡里抽 title/body/tags
    if (data.strategyId) {
      const [strategy] = await db.select().from(strategiesTable).where(eq(strategiesTable.id, data.strategyId));
      if (!strategy || strategy.userId !== u.id) {
        res.status(404).json({ error: "strategy_not_found" });
        return;
      }
      const card = strategy.strategyJson as any;
      if (card) {
        if (!data.title) title = (card.theme || card.hookFormula || "未命名").toString().slice(0, 200);
        if (!data.body) body = (card.bodyDraft || card.voiceoverScript || "").toString();
        if (!data.tags) tags = Array.isArray(card.hashtags) ? card.hashtags.slice(0, 10) : [];
        if (!data.originalReference) {
          originalReference = JSON.stringify({
            strategyId: strategy.id,
            theme: card.theme,
            hookFormula: card.hookFormula,
            voiceoverScript: card.voiceoverScript,
            scriptOutline: card.scriptOutline,
            coverPrompt: card.coverPrompt,
            reasoning: card.reasoning,
          }).slice(0, 19000);
        }
      }
    }

    const platform = data.platform || account.platform || "xhs";

    const [content] = await db.insert(contentTable).values({
      ownerUserId: u.id,
      accountId: account.id,
      platform,
      mediaType,
      title: title.slice(0, 200),
      body,
      tags,
      imageUrls: data.imageUrls ?? [],
      videoUrl: data.videoUrl ?? null,
      originalReference,
      status: "draft",
    }).returning();

    await db
      .update(accountsTable)
      .set({ contentCount: sql`content_count + 1`, lastActiveAt: new Date() })
      .where(eq(accountsTable.id, account.id));

    await logActivity(
      "content_created",
      `from-strategy ${data.strategyId ? `#${data.strategyId}` : "(inline)"} → content #${content.id}`,
      content.id,
      account.id,
    );
    await deductCredits(req, "content-create");
    try { triggerContentProfileRecompute(u.id); } catch { /* ignore */ }

    res.status(201).json({
      contentId: content.id,
      platform: content.platform,
      title: content.title,
      body: content.body,
      tags: content.tags,
      status: content.status,
    });
  } catch (err) {
    req.log.error(err, "from-strategy failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/content/:id", async (req, res): Promise<void> => {
  try {
    const params = DeleteContentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const u = await ensureUser(req);
    if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }

    // 验证归属
    const owned = await loadOwnedContent(params.data.id, u.id);
    if (!owned) {
      res.status(404).json({ error: "Content not found" });
      return;
    }

    const [content] = await db
      .delete(contentTable)
      .where(eq(contentTable.id, params.data.id))
      .returning();

    if (content?.accountId) {
      await db
        .update(accountsTable)
        .set({ contentCount: sql`GREATEST(content_count - 1, 0)` })
        .where(eq(accountsTable.id, content.accountId));
    }

    res.sendStatus(204);
  } catch (err) {
    req.log.error(err, "Failed to delete content");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/content/:id/schedule", async (req, res): Promise<void> => {
  try {
    const params = ScheduleContentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const parsed = ScheduleContentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const u = await ensureUser(req);
    if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }

    // 验证归属
    const owned = await loadOwnedContent(params.data.id, u.id);
    if (!owned) {
      res.status(404).json({ error: "Content not found" });
      return;
    }

    // 验证发布时间必须是将来（允许 60 秒时钟漂移）
    const scheduledTime = new Date(parsed.data.scheduledAt).getTime();
    if (!Number.isFinite(scheduledTime) || scheduledTime <= Date.now() - 60_000) {
      res.status(400).json({ error: "scheduledAt must be a future timestamp" });
      return;
    }

    // T1：账号必须已授权（XHS 走标记发布除外）
    const ownedRowSch = owned as Record<string, any>;
    if (ownedRowSch.account_id) {
      const [acc] = await db.select().from(accountsTable).where(eq(accountsTable.id, ownedRowSch.account_id));
      if (acc && !isAccountReadyToPublish(acc)) {
        res.status(400).json({
          error: "account_not_authorized",
          message: `${acc.platform} 账号尚未授权，无法排期自动发布。请先到「账号管理」完成授权。`,
          platform: acc.platform,
        });
        return;
      }
    }

    const [content] = await db
      .update(contentTable)
      .set({ status: "scheduled", scheduledAt: new Date(parsed.data.scheduledAt) })
      .where(eq(contentTable.id, params.data.id))
      .returning();

    if (content.accountId) {
      await db.insert(schedulesTable).values({
        contentId: content.id,
        accountId: content.accountId,
        platform: content.platform,
        scheduledAt: new Date(parsed.data.scheduledAt),
      });
    }

    const [account] = await db.select().from(accountsTable).where(eq(accountsTable.id, content.accountId!));
    await logActivity("content_scheduled", `Scheduled (${content.platform}): ${content.title}`, content.id, content.accountId ?? undefined);

    const result = mapContentRow(ormRowToMapInput(content, account));

    res.json(ScheduleContentResponse.parse(result));
  } catch (err) {
    req.log.error(err, "Failed to schedule content");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/content/:id/publish", requireCredits("content-publish"), async (req, res): Promise<void> => {
  try {
    const params = MarkContentPublishedParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const u = await ensureUser(req);
    if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }

    // 验证归属
    const owned = await loadOwnedContent(params.data.id, u.id);
    if (!owned) {
      res.status(404).json({ error: "Content not found" });
      return;
    }

    // loadOwnedContent 返回 raw SQL row（snake_case）
    const ownedRow = owned as Record<string, any>;
    const ownedAccountId: number | null = ownedRow.account_id ?? null;
    const platform: string = ownedRow.platform || "xhs";
    if (!ownedAccountId) {
      res.status(400).json({ error: "内容未绑定账号，无法发布" });
      return;
    }
    const [account] = await db.select().from(accountsTable).where(eq(accountsTable.id, ownedAccountId));
    if (!account) {
      res.status(400).json({ error: "账号不存在" });
      return;
    }

    // T1：非 XHS 平台必须已授权才允许真发布
    if (!isAccountReadyToPublish(account)) {
      res.status(400).json({
        error: "account_not_authorized",
        message: `${platform} 账号尚未授权，请先在「账号管理」完成授权后再发布`,
        platform,
      });
      return;
    }

    const startedAt = Date.now();
    let remotePostId: string | null = null;
    let realPublish = false;

    if (platform === "facebook" || platform === "instagram" || platform === "tiktok") {
      realPublish = true;
      const dispatch = await dispatchContentToProvider({
        platform,
        accountId: account.id,
        title: ownedRow.title || "",
        body: ownedRow.body || "",
        imageUrls: (ownedRow.image_urls as string[] | null) ?? null,
        videoUrl: (ownedRow.video_url as string | null) ?? null,
        oauthAccessToken: account.oauthAccessToken ?? null,
        oauthRefreshToken: account.oauthRefreshToken ?? null,
        oauthExpiresAt: account.oauthExpiresAt ?? null,
        platformAccountId: account.platformAccountId ?? null,
        ayrshareProfileKey: account.ayrshareProfileKey ?? null,
      });

      // 不论成败都落 publish_logs（schedule_id=NULL 表示手动立即发布）
      try {
        await db.insert(publishLogsTable).values({
          scheduleId: null,
          contentId: ownedRow.id,
          accountId: account.id,
          platform,
          attempt: 1,
          status: dispatch.success ? "success" : "failed",
          postId: dispatch.success ? dispatch.postId : null,
          errorMessage: dispatch.success ? null : dispatch.errorMessage,
          durationMs: Date.now() - startedAt,
        });
      } catch (e) {
        req.log.warn({ err: e }, "publish_logs insert failed (non-fatal)");
      }

      if (!dispatch.success) {
        // 失败：不动 content.status；不扣积分；把错误原因返回前端
        res.status(502).json({ error: dispatch.errorMessage, platform });
        return;
      }
      remotePostId = dispatch.postId;
    }

    const [content] = await db
      .update(contentTable)
      .set({
        status: "published",
        publishedAt: new Date(),
        ...(remotePostId ? { remotePostId } : {}),
      })
      .where(eq(contentTable.id, params.data.id))
      .returning();

    await db
      .update(schedulesTable)
      .set({ status: "completed" })
      .where(eq(schedulesTable.contentId, content.id));

    await logActivity(
      "content_published",
      `${realPublish ? "已真发" : "已标记发布"}（${content.platform}）: ${content.title}${remotePostId ? ` post_id=${remotePostId}` : ""}`,
      content.id,
      content.accountId ?? undefined,
    );

    const result = mapContentRow(ormRowToMapInput(content, account));

    await deductCredits(req, "content-publish");

    try { triggerContentProfileRecompute(u.id); } catch { /* ignore */ }

    res.json(MarkContentPublishedResponse.parse(result));
  } catch (err) {
    req.log.error(err, "Failed to publish content");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
