import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const AUTODL_XHS_URL = process.env.AUTODL_XHS_URL || "";
const AUTODL_API_KEY = process.env.AUTODL_API_KEY || "";

async function proxyToAutoDL(path: string, options: RequestInit = {}): Promise<any> {
  if (!AUTODL_XHS_URL) {
    throw new Error("AutoDL XHS service not configured");
  }

  const url = `${AUTODL_XHS_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(12_000),
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": AUTODL_API_KEY,
      ...((options.headers as Record<string, string>) || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AutoDL error ${res.status}: ${text}`);
  }

  return res.json();
}

export async function tryFetchXhsData(keyword: string): Promise<{ available: boolean; notes: any[]; source: string }> {
  if (!AUTODL_XHS_URL) {
    return { available: false, notes: [], source: "ai-only" };
  }

  try {
    const healthRes = await proxyToAutoDL("/health");
    if (!healthRes?.xhs_ready) {
      return { available: false, notes: [], source: "ai-only" };
    }

    const data = await proxyToAutoDL("/api/xhs/search", {
      method: "POST",
      body: JSON.stringify({ keyword, page: 1, sort: "hot" }),
    });

    if (data?.error) {
      logger.warn({ error: data.error }, "XHS search returned error, falling back to AI-only");
      return { available: false, notes: [], source: "ai-only" };
    }

    const notes = (data?.notes || []).slice(0, 10);
    if (notes.length === 0) {
      return { available: false, notes: [], source: "ai-only" };
    }

    return { available: true, notes, source: "real-data" };
  } catch (e: any) {
    logger.warn({ err: e.message }, "XHS data fetch failed, falling back to AI-only");
    return { available: false, notes: [], source: "ai-only" };
  }
}

router.get("/xhs/health", async (_req, res): Promise<void> => {
  try {
    const data = await proxyToAutoDL("/health");
    res.json(data);
  } catch (e: any) {
    logger.error(e, "XHS health check failed");
    res.status(503).json({ status: "error", message: e.message });
  }
});

router.post("/xhs/search", async (req, res): Promise<void> => {
  try {
    const { keyword, page, sort } = req.body;
    if (!keyword) {
      res.status(400).json({ error: "keyword is required" });
      return;
    }

    const data = await proxyToAutoDL("/api/xhs/search", {
      method: "POST",
      body: JSON.stringify({ keyword, page: page || 1, sort: sort || "general" }),
    });

    res.json(data);
  } catch (e: any) {
    logger.error(e, "XHS search failed");
    res.status(500).json({ error: e.message });
  }
});

router.get("/xhs/note/:noteId", async (req, res): Promise<void> => {
  try {
    const { noteId } = req.params;
    const data = await proxyToAutoDL(`/api/xhs/note/${noteId}`);
    res.json(data);
  } catch (e: any) {
    logger.error(e, "XHS note detail failed");
    res.status(500).json({ error: e.message });
  }
});

router.get("/xhs/user/:userId/notes", async (req, res): Promise<void> => {
  try {
    const { userId } = req.params;
    const cursor = req.query.cursor as string || "";
    const data = await proxyToAutoDL(`/api/xhs/user/${userId}/notes?cursor=${cursor}`);
    res.json(data);
  } catch (e: any) {
    logger.error(e, "XHS user notes failed");
    res.status(500).json({ error: e.message });
  }
});

export default router;
