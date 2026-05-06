import { logger } from "./logger.js";

/**
 * 通用 fetch 重试 + 指数退避(带 jitter)。
 *
 * 仅对临时性失败重试:
 *   - 网络错误(fetch throw)
 *   - HTTP 429 Too Many Requests(尊重 Retry-After 头,秒或 HTTP-date)
 *   - HTTP 5xx(500/502/503/504)
 *
 * 4xx(除 429) = 真实业务/参数错误,立即抛出不重试。
 *
 * 默认: 最多 4 次尝试 = 1 + 3 retries; 基础延迟 800ms,指数 2^n + 0~30% jitter; 上限 20s。
 */

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** 用于日志识别哪个上游 */
  label?: string;
  log?: any;
}

const DEFAULT_OPTS: Required<Omit<RetryOptions, "label" | "log">> = {
  maxRetries: 3,
  baseDelayMs: 800,
  maxDelayMs: 20_000,
};

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  // 整数秒
  const asInt = Number(trimmed);
  if (Number.isFinite(asInt) && asInt >= 0) {
    return Math.min(asInt * 1000, 60_000);
  }
  // HTTP-date
  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    const diff = parsed - Date.now();
    return diff > 0 ? Math.min(diff, 60_000) : 0;
  }
  return null;
}

function computeBackoff(attempt: number, base: number, cap: number): number {
  const exp = Math.min(base * Math.pow(2, attempt), cap);
  const jitter = exp * (Math.random() * 0.3); // 0~30% jitter 防 thundering herd
  return Math.round(exp + jitter);
}

/**
 * 包一个 fetch 调用 + 自动重试。返回 Response(调用方仍需自己 .ok 判定)。
 *
 * @example
 *   const res = await fetchWithRetry(() => fetch(url, init), { label: "sora.create" });
 */
export async function fetchWithRetry(
  doFetch: () => Promise<Response>,
  opts: RetryOptions = {},
): Promise<Response> {
  const { maxRetries, baseDelayMs, maxDelayMs } = { ...DEFAULT_OPTS, ...opts };
  const log = opts.log || logger;
  const label = opts.label || "fetchWithRetry";

  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await doFetch();

      if (res.ok || !RETRYABLE_STATUS.has(res.status)) {
        return res;
      }

      // 可重试的 HTTP 错误
      if (attempt === maxRetries) {
        return res; // 用完次数,把最后这个 res 还给调用方,让它走原有的 !ok 报错路径
      }

      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      const wait = retryAfter ?? computeBackoff(attempt, baseDelayMs, maxDelayMs);

      log.warn(
        { label, attempt: attempt + 1, status: res.status, waitMs: wait, hasRetryAfter: retryAfter != null },
        "upstream returned retryable status, backing off",
      );
      await new Promise((r) => setTimeout(r, wait));
    } catch (err: any) {
      // 网络层异常(DNS / TCP / TLS / abort)
      lastErr = err;
      if (attempt === maxRetries) break;
      const wait = computeBackoff(attempt, baseDelayMs, maxDelayMs);
      log.warn(
        { label, attempt: attempt + 1, waitMs: wait, errMsg: err?.message },
        "upstream fetch threw, backing off",
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  throw lastErr ?? new Error(`${label}: exhausted retries`);
}
