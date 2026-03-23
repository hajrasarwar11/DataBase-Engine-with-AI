import { Router, type IRouter } from "express";
import healthRouter from "./health";
import databasesRouter from "./databases";
import queriesRouter from "./queries";
import anthropicRouter from "./anthropic/index";
import authRouter from "./auth/index";

const router = Router();

router.use(healthRouter);
router.use(databasesRouter);
router.use("/queries", queriesRouter);
router.use(anthropicRouter);
router.use(authRouter);

export default router;
