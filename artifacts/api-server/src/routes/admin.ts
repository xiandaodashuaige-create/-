import { Router, type IRouter } from "express";
import { db, usersTable, creditTransactionsTable } from "@workspace/db";
import { eq, desc, sql, count } from "drizzle-orm";
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
  (req as any).dbUser = user;
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
    if (plan && ["free", "paid"].includes(plan)) updates.plan = plan;
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
    const [paidCount] = await db.select({ count: count() }).from(usersTable).where(eq(usersTable.plan, "paid"));
    const [totalCreditsUsed] = await db.select({ total: sql<number>`coalesce(sum(${usersTable.totalCreditsUsed}), 0)` }).from(usersTable);

    res.json({
      totalUsers: userCount?.count || 0,
      freeUsers: freeCount?.count || 0,
      paidUsers: paidCount?.count || 0,
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
    if (language && ["zh", "en"].includes(language)) updates.language = language;
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

export default router;
