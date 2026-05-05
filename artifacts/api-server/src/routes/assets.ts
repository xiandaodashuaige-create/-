import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, assetsTable } from "@workspace/db";
import {
  CreateAssetBody,
  ListAssetsQueryParams,
  ListAssetsResponse,
  DeleteAssetParams,
} from "@workspace/api-zod";
import { requireCredits, deductCredits, ensureUser } from "../middlewares/creditSystem";

const router: IRouter = Router();

// 列出当前用户的素材（按 userId 隔离）
router.get("/assets", async (req, res): Promise<void> => {
  try {
    const u = await ensureUser(req);
    if (!u) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const query = ListAssetsQueryParams.safeParse(req.query);
    const conditions = [eq(assetsTable.userId, u.id)];

    if (query.success) {
      if (query.data.accountId) {
        conditions.push(eq(assetsTable.accountId, query.data.accountId));
      }
      if (query.data.type && query.data.type !== "all") {
        conditions.push(eq(assetsTable.type, query.data.type));
      }
    }

    const assets = await db
      .select()
      .from(assetsTable)
      .where(and(...conditions))
      .orderBy(desc(assetsTable.createdAt));

    res.json(ListAssetsResponse.parse(assets));
  } catch (err) {
    req.log.error(err, "Failed to list assets");
    res.status(500).json({ error: "Internal server error" });
  }
});

// 创建素材：自动绑定 userId
router.post("/assets", requireCredits("asset-upload"), async (req, res): Promise<void> => {
  try {
    const u = await ensureUser(req);
    if (!u) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const parsed = CreateAssetBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [asset] = await db
      .insert(assetsTable)
      .values({
        userId: u.id,
        accountId: parsed.data.accountId,
        type: parsed.data.type,
        filename: parsed.data.filename,
        objectPath: parsed.data.objectPath,
        size: parsed.data.size,
        tags: parsed.data.tags || [],
      })
      .returning();

    await deductCredits(req, "asset-upload");
    res.status(201).json(asset);
  } catch (err) {
    req.log.error(err, "Failed to create asset");
    res.status(500).json({ error: "Internal server error" });
  }
});

// 删除素材：必须属于当前用户
router.delete("/assets/:id", async (req, res): Promise<void> => {
  try {
    const u = await ensureUser(req);
    if (!u) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const params = DeleteAssetParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [asset] = await db
      .delete(assetsTable)
      .where(and(eq(assetsTable.id, params.data.id), eq(assetsTable.userId, u.id)))
      .returning();

    if (!asset) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }

    res.sendStatus(204);
  } catch (err) {
    req.log.error(err, "Failed to delete asset");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
