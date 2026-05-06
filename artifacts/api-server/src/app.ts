import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";
import { errorHandler } from "./middlewares/errorHandler";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// CORS：origin: true 会回显任意来源给 ACAO，配合 credentials: true 等于允许任何站点
// 携带用户 cookie 调本 API（CSRF）。改为白名单：本机开发 + REPLIT_DOMAINS（逗号分隔的生产域名）。
const corsAllowlist = new Set<string>([
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:80",
  "http://localhost",
  ...(process.env.REPLIT_DOMAINS ?? "").split(",").map((d) => d.trim()).filter(Boolean).flatMap((d) => [`https://${d}`, `http://${d}`]),
]);
app.use(cors({
  credentials: true,
  origin: (origin, cb) => {
    // 同源 / curl / SSR 等无 Origin header 的请求允许通过
    if (!origin) return cb(null, true);
    if (corsAllowlist.has(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked: ${origin}`));
  },
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

// 全局错误处理 —— 必须在所有 route 之后挂载
app.use(errorHandler);

export default app;
