// 全局错误处理中间件
// 兜底所有路由抛出/未捕获的 Error，统一响应格式 + 隐藏堆栈
import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

export interface ErrorResponse {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

// 自定义可抛出错误，路由里 throw new ApiError(404, "not_found", "...")
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  // 已经响应过 → 交给 Express 默认 finalhandler（避免双写 header）
  if (res.headersSent) return;

  const isProd = process.env.NODE_ENV === "production";

  // ApiError —— 业务错误，原样返回
  if (err instanceof ApiError) {
    req.log?.warn({ err, code: err.code, statusCode: err.statusCode }, "API error");
    res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
    } satisfies ErrorResponse);
    return;
  }

  // ZodError —— 输入校验失败
  if (err instanceof ZodError) {
    req.log?.warn({ issues: err.issues }, "Validation error");
    res.status(400).json({
      success: false,
      error: { code: "validation_error", message: "请求数据格式不正确", details: err.issues },
    } satisfies ErrorResponse);
    return;
  }

  // 兜底 —— 未预期错误：500 + 隐藏堆栈
  const message = err instanceof Error ? err.message : String(err);
  req.log?.error({ err }, "Unhandled error");
  res.status(500).json({
    success: false,
    error: {
      code: "internal_error",
      message: isProd ? "服务器内部错误" : message,
      ...(isProd ? {} : { details: err instanceof Error ? err.stack : undefined }),
    },
  } satisfies ErrorResponse);
}
