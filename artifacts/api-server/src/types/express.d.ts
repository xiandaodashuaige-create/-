// Express Request 类型增强 — 移除 (req as any) 散落在各处的隐患
//
// 由 requireAuth 中间件填充：
//   - userId: Clerk 的 user_xxx 字符串（唯一可信来源）
// 由 creditSystem 中间件填充：
//   - dbUser: ensureUser 解析出的本地 users 表行
//   - creditOperation / creditCost: 当前请求要扣的积分操作
import type { usersTable } from "@workspace/db";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      dbUser?: typeof usersTable.$inferSelect;
      creditOperation?: string;
      creditCost?: number;
    }
  }
}

export {};
