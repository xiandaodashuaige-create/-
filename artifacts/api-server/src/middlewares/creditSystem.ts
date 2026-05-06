import { db, usersTable, creditTransactionsTable } from "@workspace/db";
import { eq, gte, sql, and } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";

export const CREDIT_COSTS: Record<string, number> = {
  "ai-rewrite": 3,
  "ai-competitor-research": 5,
  "ai-operations-strategy": 5,
  "ai-generate-title": 1,
  "ai-generate-hashtags": 1,
  "ai-generate-image": 5,
  "ai-analyze-reference-image": 1,
  "ai-generate-image-prompt": 1,
  "ai-generate-video-plan": 2,
  "ai-generate-video": 15,
  "ai-guide": 1,
  "ai-check-sensitivity": 1,
  "content-publish": 2,
  "content-create": 1,
  "asset-upload": 1,
};

const ROUTE_TO_OPERATION: Record<string, string> = {
  "POST:/ai/rewrite": "ai-rewrite",
  "POST:/ai/refine-schedule-item": "ai-rewrite",
  "POST:/ai/competitor-research": "ai-competitor-research",
  "POST:/ai/generate-title": "ai-generate-title",
  "POST:/ai/generate-hashtags": "ai-generate-hashtags",
  "POST:/ai/generate-image": "ai-generate-image",
  "POST:/ai/analyze-reference-image": "ai-analyze-reference-image",
  "POST:/ai/generate-image-prompt": "ai-generate-image-prompt",
  "POST:/ai/generate-image-pipeline": "ai-generate-image",
  "POST:/ai/generate-video-plan": "ai-generate-video-plan",
  "POST:/ai/generate-video": "ai-generate-video",
  "POST:/ai/guide": "ai-guide",
  "POST:/ai/check-sensitivity": "ai-check-sensitivity",
};

export async function ensureUser(req: Request): Promise<any> {
  const clerkId = (req as any).userId;
  if (!clerkId) return null;

  let [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).limit(1);

  if (!user) {
    const auth = (req as any).auth;
    const email = auth?.sessionClaims?.email || auth?.sessionClaims?.primaryEmail || null;
    const nickname = auth?.sessionClaims?.firstName || auth?.sessionClaims?.name || null;

    // 初始 admin 邮箱白名单 — 仅在新用户首次注册时生效（决定 role 字段初值）
    // 现有用户的管理员状态以 users.role 为准；env 变更不影响存量数据。
    // 修改方式：在 Replit Secrets / env 设置 INITIAL_ADMIN_EMAILS（逗号分隔）
    const adminEmailsEnv = process.env.INITIAL_ADMIN_EMAILS
      || "xiandao456@gmail.com,xiandaodashuaige@gmail.com";
    const adminEmails = adminEmailsEnv
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const isAdmin = email && adminEmails.includes(email.toLowerCase());

    [user] = await db.insert(usersTable).values({
      clerkId,
      email,
      nickname,
      role: isAdmin ? "admin" : "user",
      plan: "free",
      credits: 20,
    }).onConflictDoNothing({ target: usersTable.clerkId }).returning();

    if (!user) {
      [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).limit(1);
    }
  }

  return user;
}

export function requireCredits(operationType?: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await ensureUser(req);
      if (!user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      (req as any).dbUser = user;

      const op = operationType || ROUTE_TO_OPERATION[`${req.method}:${req.path}`];
      if (!op) {
        next();
        return;
      }

      const cost = CREDIT_COSTS[op] || 0;
      if (cost <= 0) {
        next();
        return;
      }

      if (user.role === "admin") {
        (req as any).creditOperation = op;
        (req as any).creditCost = 0;
        next();
        return;
      }

      if (user.credits < cost) {
        res.status(403).json({
          error: "积分不足",
          required: cost,
          current: user.credits,
          operation: op,
        });
        return;
      }

      (req as any).creditOperation = op;
      (req as any).creditCost = cost;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export async function deductCredits(req: Request, operationType?: string): Promise<void> {
  const user = (req as any).dbUser;
  if (!user || user.role === "admin") return;

  const op = operationType || (req as any).creditOperation;
  const cost = (req as any).creditCost || CREDIT_COSTS[op] || 0;
  if (cost <= 0) return;

  const result = await db.update(usersTable)
    .set({
      credits: sql`GREATEST(0, ${usersTable.credits} - ${cost})`,
      totalCreditsUsed: sql`${usersTable.totalCreditsUsed} + ${cost}`,
    })
    .where(and(eq(usersTable.id, user.id), gte(usersTable.credits, cost)))
    .returning({ newCredits: usersTable.credits });

  if (!result.length) {
    return;
  }

  const newBalance = result[0].newCredits;

  await db.insert(creditTransactionsTable).values({
    userId: user.id,
    amount: -cost,
    balanceAfter: newBalance,
    type: "deduct",
    operationType: op,
    description: getOperationLabel(op),
  });

  user.credits = newBalance;
}

/**
 * 退款（仅用于异步任务失败补偿）。amount 必须为正。
 */
export async function refundCredits(userId: number, amount: number, op: string, reason: string): Promise<void> {
  if (amount <= 0) return;
  const result = await db.update(usersTable)
    .set({
      credits: sql`${usersTable.credits} + ${amount}`,
      totalCreditsUsed: sql`GREATEST(0, ${usersTable.totalCreditsUsed} - ${amount})`,
    })
    .where(eq(usersTable.id, userId))
    .returning({ newCredits: usersTable.credits });
  if (!result.length) return;
  await db.insert(creditTransactionsTable).values({
    userId,
    amount,
    balanceAfter: result[0].newCredits,
    type: "refund",
    operationType: op,
    description: `失败自动退款：${reason}`.slice(0, 200),
  });
}

function getOperationLabel(op: string): string {
  const labels: Record<string, string> = {
    "ai-rewrite": "AI智能改写",
    "ai-competitor-research": "AI竞品分析",
    "ai-operations-strategy": "30天运营策略",
    "ai-generate-title": "AI生成标题",
    "ai-generate-hashtags": "AI生成标签",
    "ai-generate-image": "AI生成配图",
    "ai-generate-video-plan": "AI视频创意 brief",
    "ai-generate-video": "AI生成视频（豆包Seedance）",
    "ai-guide": "AI运营向导",
    "ai-check-sensitivity": "敏感词检测",
    "content-publish": "发布内容",
    "content-create": "创建内容",
    "asset-upload": "上传素材",
  };
  return labels[op] || op;
}
