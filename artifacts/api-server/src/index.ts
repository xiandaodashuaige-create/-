import { validateEnv } from "./config/env";
// 启动前先校验环境变量（必需项缺失直接 process.exit(1)）
const env = validateEnv();

import app from "./app";
import { logger } from "./lib/logger";
import { startCronJobs } from "./services/cron";

const port = Number(env.PORT);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${env.PORT}"`);
}

// ⚠️ 多实例风险检测:
// aiRateLimit / cron / videoJobs in-flight 检查 / oauth state cleanup 全部是
// 进程内单实例语义。如果 Replit autoscale 同时拉起 ≥ 2 个实例:
//   - 用户能在不同实例间绕过 rate limit (双倍 burn)
//   - cron 会被多实例并发触发 (重复扣费/重复发布)
// 正确做法是切到 Reserved VM(单实例)或在 .replit 配置 maxInstances=1,或者把
// 这些状态外置到 Redis。当前没有外部状态后端,所以启动时打印强警告。
if (process.env.REPLIT_DEPLOYMENT === "1" && !process.env.REDIS_URL) {
  logger.warn(
    {
      hint: "Set maxInstances=1 in .replit autoscale OR provision Redis to externalize rate-limit/cron state",
    },
    "[MULTI-INSTANCE GUARD] Process-internal state in use (rate-limit/cron/in-flight). " +
      "Running >1 instance will silently break these guarantees.",
  );
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startCronJobs();
});
