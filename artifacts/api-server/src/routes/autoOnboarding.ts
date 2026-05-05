import { Router, type IRouter } from "express";
import { ensureUser } from "../middlewares/creditSystem.js";
import { inferUserNiche, type AutoOnboardingPlatform } from "../services/autoOnboarding.js";
import { enqueueAutoOnboarding, getAutoOnboardingJob } from "../services/autoOnboardingJobs.js";

const router: IRouter = Router();

// ── POST /api/auto-onboarding/run ────────────────────────────────────────
// 客户最少只需提交 { region } 甚至空 body，AI 自动接管：
//   1) 自动推断 niche（从客户已发布内容/账号 nickname）
//   2) 自动 discover 同行（TikTok 关键词搜 + XHS 关键词搜）
//   3) 批量入库 + 自动抓取每人最新 12 条作品
//   4) 触发该 niche 的全平台训练画像
// 异步：立即返回 jobId，后台执行；客户用 GET /status?jobId 轮询进度。
router.post("/auto-onboarding/run", async (req, res): Promise<void> => {
  const user = await ensureUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const body = req.body ?? {};
  const niche = typeof body.niche === "string" ? body.niche.trim() : null;
  const region = typeof body.region === "string" ? body.region.trim() : null;
  const perPlatformCount = Number.isFinite(body.perPlatformCount) ? Number(body.perPlatformCount) : undefined;
  const platforms: AutoOnboardingPlatform[] | undefined = Array.isArray(body.platforms)
    ? body.platforms.filter((p: unknown): p is AutoOnboardingPlatform =>
        p === "tiktok" || p === "xhs" || p === "facebook" || p === "instagram")
    : undefined;

  const job = enqueueAutoOnboarding(user.id, { niche, region, platforms, perPlatformCount });
  res.status(202).json({
    jobId: job.id,
    status: job.status,
    message: "AI 已开始后台自动发现 + 抓取同行数据，请轮询 /api/auto-onboarding/status?jobId=" + job.id,
  });
});

// ── GET /api/auto-onboarding/status?jobId=xxx ────────────────────────────
router.get("/auto-onboarding/status", async (req, res): Promise<void> => {
  const user = await ensureUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const jobId = String(req.query.jobId ?? "");
  if (!jobId) { res.status(400).json({ error: "missing_jobId" }); return; }
  const job = getAutoOnboardingJob(jobId, user.id);
  if (!job) { res.status(404).json({ error: "job_not_found" }); return; }
  res.json({
    jobId: job.id,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    result: job.result,
    error: job.error,
  });
});

// ── GET /api/auto-onboarding/preview ─────────────────────────────────────
// 给前端展示"AI 将为你做什么"：自动推断 niche + 默认平台/数量，不写任何数据
router.get("/auto-onboarding/preview", async (req, res): Promise<void> => {
  const user = await ensureUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const inferred = await inferUserNiche(user.id);
  res.json({
    inferredNiche: inferred,
    defaultRegion: "MY",
    defaultPlatforms: ["tiktok", "xhs"],
    defaultPerPlatformCount: 10,
    note: inferred
      ? `AI 已根据你的历史内容推断行业为「${inferred}」，将自动发现并添加约 10 个 TikTok 同行 + 10 个小红书同行。`
      : "AI 暂无足够历史数据推断你的行业；建议你输入一个关键词（如 培训 / 美妆），其余完全自动。",
  });
});

export default router;
