import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, assetsTable } from "@workspace/db";
import {
  CreateAssetBody,
  ListAssetsQueryParams,
  ListAssetsResponse,
  DeleteAssetParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/assets", async (req, res): Promise<void> => {
  try {
    const query = ListAssetsQueryParams.safeParse(req.query);
    const conditions = [];

    if (query.success) {
      if (query.data.accountId) {
        conditions.push(eq(assetsTable.accountId, query.data.accountId));
      }
      if (query.data.type && query.data.type !== "all") {
        conditions.push(eq(assetsTable.type, query.data.type));
      }
    }

    let assets;
    if (conditions.length > 0) {
      assets = await db
        .select()
        .from(assetsTable)
        .where(conditions.length === 1 ? conditions[0] : and(...conditions))
        .orderBy(assetsTable.createdAt);
    } else {
      assets = await db.select().from(assetsTable).orderBy(assetsTable.createdAt);
    }

    res.json(ListAssetsResponse.parse(assets));
  } catch (err) {
    req.log.error(err, "Failed to list assets");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/assets", async (req, res): Promise<void> => {
  try {
    const parsed = CreateAssetBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [asset] = await db
      .insert(assetsTable)
      .values({
        accountId: parsed.data.accountId,
        type: parsed.data.type,
        filename: parsed.data.filename,
        objectPath: parsed.data.objectPath,
        size: parsed.data.size,
        tags: parsed.data.tags || [],
      })
      .returning();

    res.status(201).json(asset);
  } catch (err) {
    req.log.error(err, "Failed to create asset");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/assets/:id", async (req, res): Promise<void> => {
  try {
    const params = DeleteAssetParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [asset] = await db
      .delete(assetsTable)
      .where(eq(assetsTable.id, params.data.id))
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
