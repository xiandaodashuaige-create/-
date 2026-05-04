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
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(xhsPublicRouter);

router.use(requireAuth);

router.use(adminRouter);
router.use(accountsRouter);
router.use(contentRouter);
router.use(assetsRouter);
router.use(aiRouter);
router.use(schedulesRouter);
router.use(dashboardRouter);
router.use(sensitiveWordsRouter);
router.use(xhsRouter);

export default router;
