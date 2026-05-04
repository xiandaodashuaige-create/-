import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, sensitiveWordsTable } from "@workspace/db";
import {
  CreateSensitiveWordBody,
  ListSensitiveWordsResponse,
  DeleteSensitiveWordParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/sensitive-words", async (req, res): Promise<void> => {
  try {
    const words = await db.select().from(sensitiveWordsTable).orderBy(sensitiveWordsTable.createdAt);
    res.json(ListSensitiveWordsResponse.parse(words));
  } catch (err) {
    req.log.error(err, "Failed to list sensitive words");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/sensitive-words", async (req, res): Promise<void> => {
  try {
    const parsed = CreateSensitiveWordBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [word] = await db.insert(sensitiveWordsTable).values(parsed.data).returning();
    res.status(201).json(word);
  } catch (err) {
    req.log.error(err, "Failed to create sensitive word");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/sensitive-words/:id", async (req, res): Promise<void> => {
  try {
    const params = DeleteSensitiveWordParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [word] = await db
      .delete(sensitiveWordsTable)
      .where(eq(sensitiveWordsTable.id, params.data.id))
      .returning();

    if (!word) {
      res.status(404).json({ error: "Sensitive word not found" });
      return;
    }

    res.sendStatus(204);
  } catch (err) {
    req.log.error(err, "Failed to delete sensitive word");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
