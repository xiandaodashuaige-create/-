import { Router, type IRouter } from "express";
import { eq, and, sql, type SQL } from "drizzle-orm";
import { db, schedulesTable, contentTable, accountsTable } from "@workspace/db";
import {
  ListSchedulesQueryParams,
  ListSchedulesResponse,
  DeleteScheduleParams,
} from "@workspace/api-zod";
import { ensureUser } from "../middlewares/creditSystem";

const router: IRouter = Router();

router.get("/schedules", async (req, res): Promise<void> => {
  try {
    const u = await ensureUser(req);
    if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }

    const query = ListSchedulesQueryParams.safeParse(req.query);
    const conditions: SQL[] = [sql`a.owner_user_id = ${u.id}`];

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

    const whereClause = sql`WHERE ${sql.join(conditions, sql` AND `)}`;

    const rows = await db.execute(sql`
      SELECT s.*,
        c.title as content_title, c.status as content_status,
        a.nickname as account_nickname, a.region as account_region, a.platform as account_platform
      FROM schedules s
      INNER JOIN accounts a ON s.account_id = a.id
      LEFT JOIN content c ON s.content_id = c.id
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
        platform: row.account_platform || "xhs",
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
    const u = await ensureUser(req);
    if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }

    // 验证归属（通过 schedule.account → account.ownerUserId）
    const [schedule] = await db
      .select({ id: schedulesTable.id, contentId: schedulesTable.contentId, accountId: schedulesTable.accountId })
      .from(schedulesTable)
      .innerJoin(accountsTable, eq(schedulesTable.accountId, accountsTable.id))
      .where(and(eq(schedulesTable.id, params.data.id), eq(accountsTable.ownerUserId, u.id)));

    if (!schedule) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }

    await db.delete(schedulesTable).where(eq(schedulesTable.id, params.data.id));

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
