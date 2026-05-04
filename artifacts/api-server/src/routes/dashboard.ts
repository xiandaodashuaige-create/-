import { Router, type IRouter } from "express";
import { sql, desc } from "drizzle-orm";
import { db, activityLogTable } from "@workspace/db";
import {
  GetDashboardStatsResponse,
  GetRecentActivityQueryParams,
  GetRecentActivityResponse,
  GetContentByRegionResponse,
  GetContentByStatusResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/dashboard/stats", async (req, res): Promise<void> => {
  try {
    const accountStats = await db.execute(sql`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'active') as active
      FROM accounts
    `);

    const contentStats = await db.execute(sql`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'published') as published,
        COUNT(*) FILTER (WHERE status = 'scheduled') as scheduled,
        COUNT(*) FILTER (WHERE status = 'draft') as draft,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) as today
      FROM content
    `);

    const assetStats = await db.execute(sql`
      SELECT COUNT(*) as total FROM assets
    `);

    const row1 = accountStats.rows[0] as any;
    const row2 = contentStats.rows[0] as any;
    const row3 = assetStats.rows[0] as any;

    res.json(
      GetDashboardStatsResponse.parse({
        totalAccounts: Number(row1?.total || 0),
        activeAccounts: Number(row1?.active || 0),
        totalContent: Number(row2?.total || 0),
        publishedContent: Number(row2?.published || 0),
        scheduledContent: Number(row2?.scheduled || 0),
        draftContent: Number(row2?.draft || 0),
        totalAssets: Number(row3?.total || 0),
        contentToday: Number(row2?.today || 0),
      })
    );
  } catch (err) {
    req.log.error(err, "Failed to get dashboard stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/recent-activity", async (req, res): Promise<void> => {
  try {
    const query = GetRecentActivityQueryParams.safeParse(req.query);
    const limit = query.success && query.data.limit ? query.data.limit : 10;

    const activities = await db
      .select()
      .from(activityLogTable)
      .orderBy(desc(activityLogTable.createdAt))
      .limit(limit);

    res.json(GetRecentActivityResponse.parse(activities));
  } catch (err) {
    req.log.error(err, "Failed to get recent activity");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/content-by-region", async (req, res): Promise<void> => {
  try {
    const rows = await db.execute(sql`
      SELECT a.region, COUNT(c.id) as count
      FROM accounts a
      LEFT JOIN content c ON a.id = c.account_id
      GROUP BY a.region
      ORDER BY count DESC
    `);

    const result = (rows.rows as any[]).map((row: any) => ({
      region: row.region,
      count: Number(row.count),
    }));

    res.json(GetContentByRegionResponse.parse(result));
  } catch (err) {
    req.log.error(err, "Failed to get content by region");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/content-by-status", async (req, res): Promise<void> => {
  try {
    const rows = await db.execute(sql`
      SELECT status, COUNT(*) as count
      FROM content
      GROUP BY status
      ORDER BY count DESC
    `);

    const result = (rows.rows as any[]).map((row: any) => ({
      status: row.status,
      count: Number(row.count),
    }));

    res.json(GetContentByStatusResponse.parse(result));
  } catch (err) {
    req.log.error(err, "Failed to get content by status");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
