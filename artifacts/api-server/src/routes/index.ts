import { Router, type IRouter } from "express";
import healthRouter from "./health";
import accountsRouter from "./accounts";
import contentRouter from "./content";
import assetsRouter from "./assets";
import aiRouter from "./ai";
import schedulesRouter from "./schedules";
import dashboardRouter from "./dashboard";
import sensitiveWordsRouter from "./sensitiveWords";
import storageRouter from "./storage";
import adminRouter from "./admin";
import xhsRouter from "./xhs";
import { xhsPublicRouter } from "./xhs";
import trackingRouter from "./tracking";
import oauthRouter, { oauthPublicRouter } from "./oauth";
import legalRouter from "./legal";
import competitorsRouter from "./competitors";
import strategyRouter from "./strategy";
import marketDataRouter from "./marketData";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(xhsPublicRouter);
// 仅 OAuth 回调路由公开（浏览器跳转回来时无 Clerk session 头）
router.use(oauthPublicRouter);
// 服务条款 / 隐私政策必须公开（TikTok / Meta 审核需访问）
router.use(legalRouter);

router.use(requireAuth);

router.use(oauthRouter);

router.use(adminRouter);
router.use(accountsRouter);
router.use(contentRouter);
router.use(assetsRouter);
router.use(aiRouter);
router.use(schedulesRouter);
router.use(dashboardRouter);
router.use(sensitiveWordsRouter);
router.use(xhsRouter);
router.use(trackingRouter);
router.use(competitorsRouter);
router.use(strategyRouter);
router.use(marketDataRouter);

export default router;
