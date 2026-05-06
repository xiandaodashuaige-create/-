import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

// /healthz — 进程是否还在跑（K8s liveness 用）
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// /readyz — 是否能服务请求（K8s readiness / 部署后冒烟用）
// 检查 DB 连通性，3 秒超时
router.get("/readyz", async (_req, res) => {
  try {
    await Promise.race([
      db.execute(sql`SELECT 1`),
      new Promise((_, rej) => setTimeout(() => rej(new Error("db_timeout")), 3000)),
    ]);
    res.json({ status: "ready", db: "ok", uptime: Math.round(process.uptime()) });
  } catch (e) {
    res.status(503).json({ status: "not_ready", db: "fail", error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
