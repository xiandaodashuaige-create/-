import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = getAuth(req);
  // 唯一可信来源是 Clerk 的 auth.userId（形如 "user_xxx"）。
  // 不再 fallback 到 sessionClaims.userId — 一旦有人配自定义 JWT template 把
  // userId 设成应用层数字 ID，会绕过 ensureUser 的 clerkId 查询导致租户穿透。
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = userId;
  next();
}
