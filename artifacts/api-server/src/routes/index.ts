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
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.use(healthRouter);

router.use(requireAuth);

router.use(accountsRouter);
router.use(contentRouter);
router.use(assetsRouter);
router.use(aiRouter);
router.use(schedulesRouter);
router.use(dashboardRouter);
router.use(sensitiveWordsRouter);
router.use(storageRouter);

export default router;
