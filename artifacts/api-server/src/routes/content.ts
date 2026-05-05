import { Router, type IRouter } from "express";
import { eq, and, sql, type SQL } from "drizzle-orm";
import { db, contentTable, accountsTable, schedulesTable } from "@workspace/db";
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
    // 租户隔离：只列出当前 user 拥有账号下的内容（或 accountId 为 NULL 但创建者是当前用户的——目前所有 content 必须挂账号；NULL 行视为孤儿不返回）
    const conditions: SQL[] = [sql`a.owner_user_id = ${u.id}`];

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
        conditions.push(sql`a.region = ${query.data.region}`);
      }
    }

    const whereClause = sql`WHERE ${sql.join(conditions, sql` AND `)}`;

    const rows = await db.execute(sql`
      SELECT c.*, a.nickname as account_nickname, a.region as account_region, a.platform as account_platform
      FROM content c
      INNER JOIN accounts a ON c.account_id = a.id
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

// 内部辅助：根据 contentId 加载内容并验证归属（通过 account.ownerUserId）
async function loadOwnedContent(contentId: number, userId: number) {
  const rows = await db.execute(sql`
    SELECT c.*, a.nickname as account_nickname, a.region as account_region, a.platform as account_platform, a.owner_user_id as account_owner_user_id
    FROM content c
    INNER JOIN accounts a ON c.account_id = a.id
    WHERE c.id = ${contentId} AND a.owner_user_id = ${userId}
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

    const [content] = await db
      .update(contentTable)
      .set({ status: "published", publishedAt: new Date() })
      .where(eq(contentTable.id, params.data.id))
      .returning();

    await db
      .update(schedulesTable)
      .set({ status: "completed" })
      .where(eq(schedulesTable.contentId, content.id));

    const [account] = await db.select().from(accountsTable).where(eq(accountsTable.id, content.accountId!));
    await logActivity("content_published", `Published (${content.platform}): ${content.title}`, content.id, content.accountId ?? undefined);

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
