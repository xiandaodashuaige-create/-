import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || "";
const RAPIDAPI_HOST = "xiaohongshu-all-api.p.rapidapi.com";
const AUTODL_XHS_URL = process.env.AUTODL_XHS_URL || "";
const AUTODL_API_KEY = process.env.AUTODL_API_KEY || "";

async function fetchFromRapidAPI(endpoint: string, params: Record<string, string> = {}): Promise<any> {
  if (!RAPIDAPI_KEY) {
    throw new Error("RapidAPI key not configured");
  }

  const url = new URL(`https://${RAPIDAPI_HOST}${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    signal: AbortSignal.timeout(15_000),
    headers: {
      "Content-Type": "application/json",
      "x-rapidapi-host": RAPIDAPI_HOST,
      "x-rapidapi-key": RAPIDAPI_KEY,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RapidAPI error ${res.status}: ${text}`);
  }

  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`RapidAPI response error: ${data.message || "unknown"}`);
  }

  return data;
}

function normalizeRapidAPINotes(rawItems: any[]): any[] {
  return rawItems.map((item: any) => {
    const note = item.note || item;
    const tags = (note.desc || "").match(/#[^\s#]+/g) || [];
    return {
      id: note.id || "",
      title: note.title || note.display_title || "",
      desc: (note.desc || "").slice(0, 200),
      liked_count: note.liked_count || note.likes || 0,
      collected_count: note.collected_count || note.collects || 0,
      comment_count: note.comments_count || note.comment_count || 0,
      shared_count: note.shared_count || 0,
      author: note.user?.nickname || "",
      tags: tags.map((t: string) => t.replace(/\[话题\]/g, "").replace("#", "")),
      type: note.type || "normal",
      source: "rapidapi",
    };
  });
}

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
  if (RAPIDAPI_KEY) {
    try {
      const data = await fetchFromRapidAPI("/api/xiaohongshu/search-note/v2", {
        keyword,
        page: "1",
      });

      const rawItems = data?.data?.items || [];
      if (rawItems.length > 0) {
        const notes = normalizeRapidAPINotes(rawItems).slice(0, 10);
        return { available: true, notes, source: "real-data" };
      }
    } catch (e: any) {
      logger.warn({ err: e.message }, "RapidAPI XHS search failed, trying AutoDL fallback");
    }
  }

  if (AUTODL_XHS_URL) {
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
        logger.warn({ error: data.error }, "AutoDL XHS search returned error");
        return { available: false, notes: [], source: "ai-only" };
      }

      const notes = (data?.notes || []).slice(0, 10);
      if (notes.length > 0) {
        return { available: true, notes, source: "real-data" };
      }
    } catch (e: any) {
      logger.warn({ err: e.message }, "AutoDL XHS data fetch also failed");
    }
  }

  return { available: false, notes: [], source: "ai-only" };
}

router.get("/xhs/health", async (_req, res): Promise<void> => {
  const status: any = { rapidapi: false, autodl: false };

  if (RAPIDAPI_KEY) {
    try {
      await fetchFromRapidAPI("/api/xiaohongshu/search-recommend/v1", { keyword: "test" });
      status.rapidapi = true;
    } catch { /* ignore */ }
  }

  if (AUTODL_XHS_URL) {
    try {
      const data = await proxyToAutoDL("/health");
      status.autodl = !!data?.xhs_ready;
    } catch { /* ignore */ }
  }

  status.anyAvailable = status.rapidapi || status.autodl;
  res.json(status);
});

router.post("/xhs/search", async (req, res): Promise<void> => {
  try {
    const { keyword, page } = req.body;
    if (!keyword) {
      res.status(400).json({ error: "keyword is required" });
      return;
    }

    if (RAPIDAPI_KEY) {
      try {
        const data = await fetchFromRapidAPI("/api/xiaohongshu/search-note/v2", {
          keyword,
          page: String(page || 1),
        });
        const rawItems = data?.data?.items || [];
        const notes = normalizeRapidAPINotes(rawItems);
        res.json({ notes, source: "rapidapi", total: notes.length });
        return;
      } catch (e: any) {
        logger.warn({ err: e.message }, "RapidAPI search failed, trying AutoDL");
      }
    }

    if (AUTODL_XHS_URL) {
      const data = await proxyToAutoDL("/api/xhs/search", {
        method: "POST",
        body: JSON.stringify({ keyword, page: page || 1, sort: "general" }),
      });
      res.json(data);
      return;
    }

    res.status(503).json({ error: "No XHS data source available" });
  } catch (e: any) {
    logger.error(e, "XHS search failed");
    res.status(500).json({ error: e.message });
  }
});

router.get("/xhs/note/:noteId", async (req, res): Promise<void> => {
  try {
    const { noteId } = req.params;

    if (RAPIDAPI_KEY) {
      try {
        const data = await fetchFromRapidAPI("/api/xiaohongshu/get-note-detail/v1", { noteId });
        res.json({ data: data?.data, source: "rapidapi" });
        return;
      } catch (e: any) {
        logger.warn({ err: e.message }, "RapidAPI note detail failed, trying AutoDL");
      }
    }

    if (AUTODL_XHS_URL) {
      const data = await proxyToAutoDL(`/api/xhs/note/${noteId}`);
      res.json(data);
      return;
    }

    res.status(503).json({ error: "No XHS data source available" });
  } catch (e: any) {
    logger.error(e, "XHS note detail failed");
    res.status(500).json({ error: e.message });
  }
});

router.get("/xhs/user/:userId/notes", async (req, res): Promise<void> => {
  try {
    const { userId } = req.params;
    const cursor = req.query.cursor as string || "";

    if (RAPIDAPI_KEY) {
      try {
        const data = await fetchFromRapidAPI("/api/xiaohongshu/get-user-note-list/v4", {
          userId,
          lastCursor: cursor,
        });
        const notes = (data?.data?.notes || []).map((n: any) => ({
          id: n.id || "",
          title: n.title || n.display_title || "",
          likes: n.likes || 0,
          comments_count: n.comments_count || 0,
          desc: (n.desc || "").slice(0, 200),
          author: n.user?.nickname || "",
        }));
        res.json({ notes, source: "rapidapi" });
        return;
      } catch (e: any) {
        logger.warn({ err: e.message }, "RapidAPI user notes failed, trying AutoDL");
      }
    }

    if (AUTODL_XHS_URL) {
      const data = await proxyToAutoDL(`/api/xhs/user/${userId}/notes?cursor=${cursor}`);
      res.json(data);
      return;
    }

    res.status(503).json({ error: "No XHS data source available" });
  } catch (e: any) {
    logger.error(e, "XHS user notes failed");
    res.status(500).json({ error: e.message });
  }
});

export default router;
