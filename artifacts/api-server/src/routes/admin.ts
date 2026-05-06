import { Router, type IRouter } from "express";
import { db, usersTable, creditTransactionsTable, publishLogsTable } from "@workspace/db";
import { eq, desc, sql, count, gte } from "drizzle-orm";
import { ensureUser, CREDIT_COSTS } from "../middlewares/creditSystem";

const router: IRouter = Router();

async function requireAdmin(req: any, res: any, next: any) {
  const user = await ensureUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  req.dbUser = user;
  next();
}

router.get("/admin/users", requireAdmin, async (req, res): Promise<void> => {
  try {
    const users = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt));
    res.json(users);
  } catch (err) {
    req.log.error(err, "Failed to list users");
    res.status(500).json({ error: "Failed to list users" });
  }
});

router.get("/admin/users/:id", requireAdmin, async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    res.json(user);
  } catch (err) {
    req.log.error(err, "Failed to get user");
    res.status(500).json({ error: "Failed to get user" });
  }
});

router.patch("/admin/users/:id", requireAdmin, async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const { role, plan } = req.body;
    const updates: any = {};
    if (role && ["user", "admin"].includes(role)) updates.role = role;
    if (plan && ["free", "starter", "pro"].includes(plan)) updates.plan = plan;
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No valid fields to update" });
      return;
    }
    const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "User not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error(err, "Failed to update user");
    res.status(500).json({ error: "Failed to update user" });
  }
});

router.post("/admin/users/:id/credits", requireAdmin, async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const { amount, description } = req.body;
    if (!amount || typeof amount !== "number") {
      res.status(400).json({ error: "amount is required (positive to add, negative to deduct)" });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const newBalance = Math.max(0, user.credits + amount);

    await db.update(usersTable).set({ credits: newBalance }).where(eq(usersTable.id, id));

    await db.insert(creditTransactionsTable).values({
      userId: id,
      amount,
      balanceAfter: newBalance,
      type: amount > 0 ? "recharge" : "admin_deduct",
      operationType: "admin",
      description: description || (amount > 0 ? `管理员充值 ${amount} 积分` : `管理员扣除 ${Math.abs(amount)} 积分`),
    });

    const [updated] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    res.json(updated);
  } catch (err) {
    req.log.error(err, "Failed to adjust credits");
    res.status(500).json({ error: "Failed to adjust credits" });
  }
});

router.get("/admin/users/:id/transactions", requireAdmin, async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const transactions = await db.select().from(creditTransactionsTable)
      .where(eq(creditTransactionsTable.userId, id))
      .orderBy(desc(creditTransactionsTable.createdAt))
      .limit(limit);
    res.json(transactions);
  } catch (err) {
    req.log.error(err, "Failed to list transactions");
    res.status(500).json({ error: "Failed to list transactions" });
  }
});

router.get("/admin/stats", requireAdmin, async (req, res): Promise<void> => {
  try {
    const [userCount] = await db.select({ count: count() }).from(usersTable);
    const [freeCount] = await db.select({ count: count() }).from(usersTable).where(eq(usersTable.plan, "free"));
    const [starterCount] = await db.select({ count: count() }).from(usersTable).where(eq(usersTable.plan, "starter"));
    const [proCount] = await db.select({ count: count() }).from(usersTable).where(eq(usersTable.plan, "pro"));
    const [totalCreditsUsed] = await db.select({ total: sql<number>`coalesce(sum(${usersTable.totalCreditsUsed}), 0)` }).from(usersTable);

    res.json({
      totalUsers: userCount?.count || 0,
      freeUsers: freeCount?.count || 0,
      starterUsers: starterCount?.count || 0,
      proUsers: proCount?.count || 0,
      totalCreditsUsed: totalCreditsUsed?.total || 0,
    });
  } catch (err) {
    req.log.error(err, "Failed to get admin stats");
    res.status(500).json({ error: "Failed to get admin stats" });
  }
});

router.get("/admin/credit-costs", requireAdmin, async (_req, res): Promise<void> => {
  res.json(CREDIT_COSTS);
});

router.get("/user/me", async (req, res): Promise<void> => {
  try {
    const user = await ensureUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    res.json({
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      role: user.role,
      plan: user.plan,
      credits: user.credits,
      totalCreditsUsed: user.totalCreditsUsed,
      language: user.language,
      onboardingCompleted: user.onboardingCompleted,
      createdAt: user.createdAt,
    });
  } catch (err) {
    req.log.error(err, "Failed to get current user");
    res.status(500).json({ error: "Failed to get user info" });
  }
});

router.patch("/user/me", async (req, res): Promise<void> => {
  try {
    const user = await ensureUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { language, onboardingCompleted, nickname } = req.body;
    const updates: any = {};
    if (language && ["zh", "en", "zh-HK"].includes(language)) updates.language = language;
    if (typeof onboardingCompleted === "number") updates.onboardingCompleted = onboardingCompleted;
    if (typeof nickname === "string" && nickname.trim()) updates.nickname = nickname.trim();

    if (Object.keys(updates).length === 0) {
      res.json(user);
      return;
    }

    const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, user.id)).returning();
    res.json(updated);
  } catch (err) {
    req.log.error(err, "Failed to update user");
    res.status(500).json({ error: "Failed to update user" });
  }
});

router.get("/user/me/transactions", async (req, res): Promise<void> => {
  try {
    const user = await ensureUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const transactions = await db.select().from(creditTransactionsTable)
      .where(eq(creditTransactionsTable.userId, user.id))
      .orderBy(desc(creditTransactionsTable.createdAt))
      .limit(limit);
    res.json(transactions);
  } catch (err) {
    req.log.error(err, "Failed to list user transactions");
    res.status(500).json({ error: "Failed to list transactions" });
  }
});

// ── GET /api/admin/publish-stats?windowHours=24 ──
// 多平台发布失败率聚合面板（最近 N 小时按平台 × 状态分组）
router.get("/admin/publish-stats", requireAdmin, async (req, res): Promise<void> => {
  try {
    const windowHours = Math.min(Math.max(parseInt(req.query.windowHours as string) || 24, 1), 24 * 30);
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    const rows = await db
      .select({
        platform: publishLogsTable.platform,
        status: publishLogsTable.status,
        count: count(),
        avgDurationMs: sql<number>`COALESCE(AVG(${publishLogsTable.durationMs})::int, 0)`,
      })
      .from(publishLogsTable)
      .where(gte(publishLogsTable.createdAt, since))
      .groupBy(publishLogsTable.platform, publishLogsTable.status);

    // 重组成 {platform: {success, failed, retried, total, successRate, avgDurationMs}}
    type Bucket = { success: number; failed: number; retried: number; total: number; avgDurationMs: number };
    const byPlatform: Record<string, Bucket> = {};
    for (const r of rows) {
      const b = byPlatform[r.platform] ??= { success: 0, failed: 0, retried: 0, total: 0, avgDurationMs: 0 };
      b.total += r.count;
      if (r.status === "success" || r.status === "succeeded") b.success += r.count;
      else if (r.status === "failed" || r.status === "error") b.failed += r.count;
      else if (r.status === "retried" || r.status === "retry") b.retried += r.count;
      // 加权平均（按 count 加权）
      b.avgDurationMs = b.total > 0 ? Math.round((b.avgDurationMs * (b.total - r.count) + r.avgDurationMs * r.count) / b.total) : 0;
    }
    const platforms = Object.entries(byPlatform).map(([platform, b]) => ({
      platform,
      ...b,
      successRate: b.total > 0 ? Math.round((b.success / b.total) * 1000) / 10 : 0, // 一位小数百分比
    }));

    // 最近 20 条失败明细（方便 admin 快速 grep 错误）
    const recentFailures = await db
      .select({
        id: publishLogsTable.id,
        platform: publishLogsTable.platform,
        status: publishLogsTable.status,
        errorMessage: publishLogsTable.errorMessage,
        scheduleId: publishLogsTable.scheduleId,
        contentId: publishLogsTable.contentId,
        attempt: publishLogsTable.attempt,
        createdAt: publishLogsTable.createdAt,
      })
      .from(publishLogsTable)
      .where(sql`${publishLogsTable.createdAt} >= ${since} AND ${publishLogsTable.status} IN ('failed','error')`)
      .orderBy(desc(publishLogsTable.createdAt))
      .limit(20);

    res.json({ windowHours, since: since.toISOString(), platforms, recentFailures });
  } catch (err) {
    req.log.error(err, "Failed to get publish stats");
    res.status(500).json({ error: "Failed to get publish stats" });
  }
});

export default router;
