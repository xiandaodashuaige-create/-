import type { Request, Response, NextFunction } from "express";

/**
 * 用户级 AI 调用 rate limiter(进程内 Map,与 cron 一样单实例语义)。
 *
 * 双层限制:
 *   - 短突发: 30 次 / 60s 滑动窗口
 *   - 长持续: 200 次 / 1h 滑动窗口
 *
 * 关键点:
 *   - 按 req.userId(Clerk userId)分桶。未登录走不到这里(已被 requireAuth 拦)。
 *   - 失败用 429 + Retry-After 头(秒),前端可解析做退避提示。
 *   - 这是"成本失控"的兜底,单价控制由 creditSystem 负责;两层互补。
 *   - 多实例部署时需切换到 Redis;当前与 cron 单实例假设保持一致。
 */

interface Bucket {
  shortWindow: number[]; // 时间戳数组,60s 窗口
  longWindow: number[];  // 时间戳数组,1h 窗口
}

const SHORT_WINDOW_MS = 60_000;
const LONG_WINDOW_MS = 60 * 60_000;
const SHORT_LIMIT = Number(process.env.AI_RATE_LIMIT_PER_MIN) || 30;
const LONG_LIMIT = Number(process.env.AI_RATE_LIMIT_PER_HOUR) || 200;

const buckets = new Map<string, Bucket>();

// 用全局 setInterval 保证即使没人调用 AI,空桶也会被回收(防止流失/爬虫用户内存堆积)。
// unref() 让定时器不阻塞进程退出;test 环境下不启动避免 leaked handle。
if (process.env.NODE_ENV !== "test") {
  const sweep = () => {
    const now = Date.now();
    for (const [userId, b] of buckets.entries()) {
      b.shortWindow = b.shortWindow.filter((t) => now - t < SHORT_WINDOW_MS);
      b.longWindow = b.longWindow.filter((t) => now - t < LONG_WINDOW_MS);
      if (b.shortWindow.length === 0 && b.longWindow.length === 0) {
        buckets.delete(userId);
      }
    }
  };
  const handle = setInterval(sweep, 5 * 60_000);
  if (typeof handle.unref === "function") handle.unref();
}

export function aiRateLimit(req: Request, res: Response, next: NextFunction): void {
  const userId = req.userId;
  if (!userId) {
    // 没 userId 就让后续 ensureUser 去拒绝,不在这里报错(避免改语义)
    next();
    return;
  }

  const now = Date.now();

  let bucket = buckets.get(userId);
  if (!bucket) {
    bucket = { shortWindow: [], longWindow: [] };
    buckets.set(userId, bucket);
  }

  // prune
  bucket.shortWindow = bucket.shortWindow.filter((t) => now - t < SHORT_WINDOW_MS);
  bucket.longWindow = bucket.longWindow.filter((t) => now - t < LONG_WINDOW_MS);

  if (bucket.shortWindow.length >= SHORT_LIMIT) {
    const oldest = bucket.shortWindow[0];
    const retryAfter = Math.max(1, Math.ceil((SHORT_WINDOW_MS - (now - oldest)) / 1000));
    res.setHeader("Retry-After", String(retryAfter));
    (req as any).log?.warn?.(
      { userId, scope: "short", count: bucket.shortWindow.length, limit: SHORT_LIMIT },
      "AI rate limit hit (per-minute)",
    );
    res.status(429).json({
      error: "rate_limited",
      message: `AI 调用太频繁,请 ${retryAfter}s 后重试(每分钟最多 ${SHORT_LIMIT} 次)`,
      retryAfterSec: retryAfter,
    });
    return;
  }

  if (bucket.longWindow.length >= LONG_LIMIT) {
    const oldest = bucket.longWindow[0];
    const retryAfter = Math.max(60, Math.ceil((LONG_WINDOW_MS - (now - oldest)) / 1000));
    res.setHeader("Retry-After", String(retryAfter));
    (req as any).log?.warn?.(
      { userId, scope: "long", count: bucket.longWindow.length, limit: LONG_LIMIT },
      "AI rate limit hit (per-hour)",
    );
    res.status(429).json({
      error: "rate_limited",
      message: `AI 调用已达每小时上限(${LONG_LIMIT} 次),请稍后再试`,
      retryAfterSec: retryAfter,
    });
    return;
  }

  bucket.shortWindow.push(now);
  bucket.longWindow.push(now);
  next();
}
