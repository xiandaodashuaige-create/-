import { Router, type IRouter } from "express";
import { eq, sql, type SQL } from "drizzle-orm";
import { db, schedulesTable, contentTable } from "@workspace/db";
import {
  ListSchedulesQueryParams,
  ListSchedulesResponse,
  DeleteScheduleParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/schedules", async (req, res): Promise<void> => {
  try {
    const query = ListSchedulesQueryParams.safeParse(req.query);
    const conditions: SQL[] = [];

    if (query.success) {
      if (query.data.accountId) {
        conditions.push(sql`s.account_id = ${query.data.accountId}`);
      }
      if (query.data.startDate) {
        conditions.push(sql`s.scheduled_at >= ${query.data.startDate}`);
      }
      if (query.data.endDate) {
        conditions.push(sql`s.scheduled_at <= ${query.data.endDate}`);
      }
    }

    const whereClause = conditions.length > 0
      ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
      : sql``;

    const rows = await db.execute(sql`
      SELECT s.*, 
        c.title as content_title, c.status as content_status,
        a.nickname as account_nickname, a.region as account_region
      FROM schedules s
      LEFT JOIN content c ON s.content_id = c.id
      LEFT JOIN accounts a ON s.account_id = a.id
      ${whereClause}
      ORDER BY s.scheduled_at ASC
    `);

    const result = (rows.rows as any[]).map((row: any) => ({
      id: row.id,
      contentId: row.content_id,
      accountId: row.account_id,
      scheduledAt: row.scheduled_at,
      status: row.status,
      createdAt: row.created_at,
      content: {
        id: row.content_id,
        title: row.content_title || "Untitled",
        status: row.content_status || "draft",
      },
      account: {
        id: row.account_id,
        nickname: row.account_nickname || "Unknown",
        region: row.account_region || "SG",
      },
    }));

    res.json(ListSchedulesResponse.parse(result));
  } catch (err) {
    req.log.error(err, "Failed to list schedules");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/schedules/:id", async (req, res): Promise<void> => {
  try {
    const params = DeleteScheduleParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [schedule] = await db
      .delete(schedulesTable)
      .where(eq(schedulesTable.id, params.data.id))
      .returning();

    if (!schedule) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }

    await db
      .update(contentTable)
      .set({ status: "draft", scheduledAt: null })
      .where(eq(contentTable.id, schedule.contentId));

    res.sendStatus(204);
  } catch (err) {
    req.log.error(err, "Failed to delete schedule");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
