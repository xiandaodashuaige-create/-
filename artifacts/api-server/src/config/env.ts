// 启动时校验必需 env，缺失就直接 process.exit(1)
// 避免运行到一半才报"undefined is not a function" / 数据库连不上等隐性崩溃
import { z } from "zod";
import { logger } from "../lib/logger";

const envSchema = z.object({
  // —— 必需 —— //
  PORT: z.string().min(1, "服务端口未设置"),
  DATABASE_URL: z.string().url("DATABASE_URL 必须是合法 URL"),
  CLERK_SECRET_KEY: z.string().min(1, "CLERK_SECRET_KEY 未设置（鉴权会全失败）"),
  CLERK_PUBLISHABLE_KEY: z.string().min(1, "CLERK_PUBLISHABLE_KEY 未设置"),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET 至少 16 字符"),

  // —— 强烈推荐（缺失只 warn 不退出） —— //
  OAUTH_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ARK_API_KEY: z.string().optional(),
  TIKHUB_API_KEY: z.string().optional(),
  RAPIDAPI_KEY: z.string().optional(),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  AYRSHARE_API_KEY: z.string().optional(),
  INITIAL_ADMIN_EMAILS: z.string().optional(),
  REPLIT_DOMAINS: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(): AppEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    // 用 console.error 而非 logger，避免 logger 还没准备好的边界场景
    console.error("\n❌ 环境变量校验失败，无法启动服务：\n" + issues + "\n");
    process.exit(1);
  }
  // 可选项缺失给 warn，不阻塞启动
  const warnIfMissing: Array<keyof AppEnv> = [
    "OAUTH_TOKEN_ENCRYPTION_KEY", "OPENAI_API_KEY", "ARK_API_KEY",
    "META_APP_ID", "META_APP_SECRET", "TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET",
  ];
  const missing = warnIfMissing.filter((k) => !parsed.data[k]);
  if (missing.length > 0) {
    logger.warn({ missing }, "可选环境变量未配置，相关功能将降级");
  }
  return parsed.data;
}
