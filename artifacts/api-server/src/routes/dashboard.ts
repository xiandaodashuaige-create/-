import { Router, type IRouter } from "express";
import { sql, desc, eq, and, type SQL } from "drizzle-orm";
import { db, activityLogTable, accountsTable } from "@workspace/db";
import {
  GetDashboardStatsResponse,
  GetRecentActivityQueryParams,
  GetRecentActivityResponse,
  GetContentByRegionResponse,
  GetContentByStatusResponse,
} from "@workspace/api-zod";
import { ensureUser } from "../middlewares/creditSystem";

const router: IRouter = Router();

// 可选 platform 过滤；当传入时进一步收窄到该平台。注意所有 dashboard 端点必须按 owner_user_id 强隔离。
function platformFilterSql(rawPlatform: unknown): SQL | null {
  if (typeof rawPlatform !== "string" || rawPlatform === "" || rawPlatform === "ALL") return null;
  return sql`${rawPlatform}`;
}

router.get("/dashboard/stats", async (req, res): Promise<void> => {
  try {
    const u = await ensureUser(req);
    if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }
    const platformParam = platformFilterSql(req.query.platform);
    const platformAccountWhere = platformParam ? sql`AND platform = ${platformParam}` : sql``;
    const platformContentJoinWhere = platformParam ? sql`AND a.platform = ${platformParam}` : sql``;
    const platformContentWhere = platformParam ? sql`AND c.platform = ${platformParam}` : sql``;

    const accountStats = await db.execute(sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'active') as active
      FROM accounts
      WHERE owner_user_id = ${u.id}
      ${platformAccountWhere}
    `);

    // content 通过 account.owner_user_id 关联到当前用户
    const contentStats = await db.execute(sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE c.status = 'published') as published,
        COUNT(*) FILTER (WHERE c.status = 'scheduled') as scheduled,
        COUNT(*) FILTER (WHERE c.status = 'draft') as draft,
        COUNT(*) FILTER (WHERE c.created_at >= CURRENT_DATE) as today
      FROM content c
      INNER JOIN accounts a ON c.account_id = a.id
      WHERE a.owner_user_id = ${u.id}
      ${platformContentJoinWhere}
      ${platformContentWhere}
    `);

    // assets 通过 account.owner_user_id 关联（assets.account_id 关联到 accounts）
    const assetStats = await db.execute(sql`
      SELECT COUNT(*) as total
      FROM assets ast
      INNER JOIN accounts a ON ast.account_id = a.id
      WHERE a.owner_user_id = ${u.id}
      ${platformContentJoinWhere}
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
    const u = await ensureUser(req);
    if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }
    const query = GetRecentActivityQueryParams.safeParse(req.query);
    const limit = query.success && query.data.limit ? query.data.limit : 10;
    const platform = query.success ? query.data.platform : undefined;

    // 当前 activityLogTable 没有直接的 owner_user_id 列；通过 accountId 反查归属。
    // 为避免泄露其他租户活动，过滤 accountId 在当前用户名下，或 accountId/contentId 都为 NULL 的系统级活动暂时不展示。
    const activities = await db.execute(sql`
      SELECT al.*
      FROM activity_log al
      INNER JOIN accounts a ON al.account_id = a.id
      WHERE a.owner_user_id = ${u.id}
      ${platform ? sql`AND a.platform = ${platform}` : sql``}
      ORDER BY al.created_at DESC
      LIMIT ${limit}
    `);

    res.json(GetRecentActivityResponse.parse(activities.rows.map((row: any) => ({
      id: row.id,
      action: row.action,
      description: row.description,
      contentId: row.content_id,
      accountId: row.account_id,
      createdAt: row.created_at,
    }))));
  } catch (err) {
    req.log.error(err, "Failed to get recent activity");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/content-by-region", async (req, res): Promise<void> => {
  try {
    const u = await ensureUser(req);
    if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }
    const platformParam = platformFilterSql(req.query.platform);
    const platformWhere = platformParam ? sql`AND a.platform = ${platformParam}` : sql``;

    const rows = await db.execute(sql`
      SELECT a.region, COUNT(c.id) as count
      FROM accounts a
      LEFT JOIN content c ON a.id = c.account_id
      WHERE a.owner_user_id = ${u.id}
      ${platformWhere}
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
    const u = await ensureUser(req);
    if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }
    const platformParam = platformFilterSql(req.query.platform);
    const platformWhere = platformParam ? sql`AND c.platform = ${platformParam}` : sql``;

    const rows = await db.execute(sql`
      SELECT c.status, COUNT(*) as count
      FROM content c
      INNER JOIN accounts a ON c.account_id = a.id
      WHERE a.owner_user_id = ${u.id}
      ${platformWhere}
      GROUP BY c.status
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
