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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startCronJobs();
});
