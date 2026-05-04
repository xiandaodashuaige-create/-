import { Router, type IRouter } from "express";
import { eq, and, sql, desc, type SQL } from "drizzle-orm";
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
import { requireCredits, deductCredits } from "../middlewares/creditSystem";

const router: IRouter = Router();

function mapContentRow(row: any) {
  return {
    id: row.id,
    accountId: row.account_id,
    title: row.title,
    body: row.body,
    originalReference: row.original_reference,
    tags: row.tags || [],
    imageUrls: row.image_urls || [],
    videoUrl: row.video_url,
    status: row.status,
    sensitivityScore: row.sensitivity_score,
    sensitivityIssues: row.sensitivity_issues || [],
    scheduledAt: row.scheduled_at,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    account: {
      id: row.account_id,
      nickname: row.account_nickname || "Unknown",
      region: row.account_region || "SG",
    },
  };
}

router.get("/content", async (req, res): Promise<void> => {
  try {
    const query = ListContentQueryParams.safeParse(req.query);
    const conditions: SQL[] = [];

    if (query.success) {
      if (query.data.accountId) {
        conditions.push(sql`c.account_id = ${query.data.accountId}`);
      }
      if (query.data.status && query.data.status !== "all") {
        conditions.push(sql`c.status = ${query.data.status}`);
      }
      if (query.data.region && query.data.region !== "ALL") {
        conditions.push(sql`a.region = ${query.data.region}`);
      }
    }

    const whereClause = conditions.length > 0
      ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
      : sql``;

    const rows = await db.execute(sql`
      SELECT c.*, a.nickname as account_nickname, a.region as account_region
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

router.post("/content", requireCredits("content-create"), async (req, res): Promise<void> => {
  try {
    const parsed = CreateContentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const accountIdVal = parsed.data.accountId && parsed.data.accountId > 0 ? parsed.data.accountId : null;
    const [content] = await db
      .insert(contentTable)
      .values({
        accountId: accountIdVal,
        title: parsed.data.title,
        body: parsed.data.body,
        originalReference: parsed.data.originalReference,
        tags: parsed.data.tags || [],
        imageUrls: parsed.data.imageUrls || [],
        videoUrl: parsed.data.videoUrl,
      })
      .returning();

    if (accountIdVal) {
      await db
        .update(accountsTable)
        .set({ contentCount: sql`content_count + 1`, lastActiveAt: new Date() })
        .where(eq(accountsTable.id, accountIdVal));
    }

    let account = null;
    if (accountIdVal) {
      const [a] = await db.select().from(accountsTable).where(eq(accountsTable.id, accountIdVal));
      account = a;
    }
    await logActivity("content_created", `Created: ${content.title}`, content.id, content.accountId);

    const result = {
      ...content,
      account: account ? { id: account.id, nickname: account.nickname, region: account.region } : null,
    };

    const parsed_result = GetContentResponse.parse(result);
    await deductCredits(req, "content-create");
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

    const rows = await db.execute(sql`
      SELECT c.*, a.nickname as account_nickname, a.region as account_region
      FROM content c
      LEFT JOIN accounts a ON c.account_id = a.id
      WHERE c.id = ${params.data.id}
    `);

    if (rows.rows.length === 0) {
      res.status(404).json({ error: "Content not found" });
      return;
    }

    res.json(GetContentResponse.parse(mapContentRow(rows.rows[0])));
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

    const updateData: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
    if (parsed.data.body !== undefined) updateData.body = parsed.data.body;
    if (parsed.data.originalReference !== undefined) updateData.originalReference = parsed.data.originalReference;
    if (parsed.data.tags !== undefined) updateData.tags = parsed.data.tags;
    if (parsed.data.imageUrls !== undefined) updateData.imageUrls = parsed.data.imageUrls;
    if (parsed.data.videoUrl !== undefined) updateData.videoUrl = parsed.data.videoUrl;

    const [content] = await db
      .update(contentTable)
      .set(updateData)
      .where(eq(contentTable.id, params.data.id))
      .returning();

    if (!content) {
      res.status(404).json({ error: "Content not found" });
      return;
    }

    const [account] = await db.select().from(accountsTable).where(eq(accountsTable.id, content.accountId));

    const result = {
      ...content,
      account: account ? { id: account.id, nickname: account.nickname, region: account.region } : { id: content.accountId, nickname: "Unknown", region: "SG" },
    };

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

    const [content] = await db
      .delete(contentTable)
      .where(eq(contentTable.id, params.data.id))
      .returning();

    if (!content) {
      res.status(404).json({ error: "Content not found" });
      return;
    }

    await db
      .update(accountsTable)
      .set({ contentCount: sql`GREATEST(content_count - 1, 0)` })
      .where(eq(accountsTable.id, content.accountId));

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

    const [content] = await db
      .update(contentTable)
      .set({ status: "scheduled", scheduledAt: new Date(parsed.data.scheduledAt) })
      .where(eq(contentTable.id, params.data.id))
      .returning();

    if (!content) {
      res.status(404).json({ error: "Content not found" });
      return;
    }

    await db.insert(schedulesTable).values({
      contentId: content.id,
      accountId: content.accountId,
      scheduledAt: new Date(parsed.data.scheduledAt),
    });

    const [account] = await db.select().from(accountsTable).where(eq(accountsTable.id, content.accountId));
    await logActivity("content_scheduled", `Scheduled: ${content.title}`, content.id, content.accountId);

    const result = {
      ...content,
      account: account ? { id: account.id, nickname: account.nickname, region: account.region } : { id: content.accountId, nickname: "Unknown", region: "SG" },
    };

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

    const [content] = await db
      .update(contentTable)
      .set({ status: "published", publishedAt: new Date() })
      .where(eq(contentTable.id, params.data.id))
      .returning();

    if (!content) {
      res.status(404).json({ error: "Content not found" });
      return;
    }

    await db
      .update(schedulesTable)
      .set({ status: "completed" })
      .where(eq(schedulesTable.contentId, content.id));

    const [account] = await db.select().from(accountsTable).where(eq(accountsTable.id, content.accountId));
    await logActivity("content_published", `Published: ${content.title}`, content.id, content.accountId);

    const result = {
      ...content,
      account: account ? { id: account.id, nickname: account.nickname, region: account.region } : { id: content.accountId, nickname: "Unknown", region: "SG" },
    };

    await deductCredits(req, "content-publish");
    res.json(MarkContentPublishedResponse.parse(result));
  } catch (err) {
    req.log.error(err, "Failed to publish content");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
