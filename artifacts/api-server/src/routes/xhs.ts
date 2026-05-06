import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const publicRouter: IRouter = Router();

const TIKHUB_API_KEY = process.env.TIKHUB_API_KEY || "";
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || "";
const RAPIDAPI_HOST = "xiaohongshu-all-api.p.rapidapi.com";
const AUTODL_XHS_URL = process.env.AUTODL_XHS_URL || "";
const AUTODL_API_KEY = process.env.AUTODL_API_KEY || "";

interface NormalizedNote {
  id: string;
  title: string;
  desc: string;
  liked_count: number;
  collected_count: number;
  comment_count: number;
  shared_count: number;
  author: string;
  tags: string[];
  type: string;
  source: string;
  cover_url: string;
}

async function fetchFromTikHub(endpoint: string, params: Record<string, string> = {}): Promise<any> {
  if (!TIKHUB_API_KEY) throw new Error("TikHub API key not configured");

  const url = new URL(`https://api.tikhub.io${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    signal: AbortSignal.timeout(15_000),
    headers: {
      "Authorization": `Bearer ${TIKHUB_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TikHub error ${res.status}: ${text}`);
  }

  return res.json();
}

function normalizeTikHubNotes(rawData: any): NormalizedNote[] {
  const items = rawData?.data?.data?.items || rawData?.data?.items || [];
  if (!Array.isArray(items)) return [];

  return items.map((item: any) => {
    const note = item.noteCard || item.note_card || item.note || item;
    const interactInfo = note.interactInfo || note.interact_info || {};
    const title = note.displayTitle || note.display_title || note.title || "";
    const desc = note.desc || title;
    const tags = desc.match(/#[^\s#]+/g) || [];
    return {
      id: item.id || note.note_id || note.id || "",
      title,
      desc: desc.slice(0, 200),
      liked_count: parseInt(interactInfo.likedCount || interactInfo.liked_count || "0", 10) || 0,
      collected_count: parseInt(interactInfo.collectedCount || interactInfo.collected_count || "0", 10) || 0,
      comment_count: parseInt(interactInfo.commentCount || interactInfo.comment_count || "0", 10) || 0,
      shared_count: parseInt(interactInfo.sharedCount || interactInfo.share_count || "0", 10) || 0,
      author: note.user?.nickname || note.user?.nickName || note.user?.nick_name || "",
      tags: tags.map((t: string) => t.replace(/\[话题\]/g, "").replace("#", "")),
      type: note.type || "normal",
      source: "tikhub",
      cover_url: note.cover?.urlDefault || note.cover?.url || "",
      note_url: (item.id || note.note_id || note.id)
        ? `https://www.xiaohongshu.com/explore/${item.id || note.note_id || note.id}${item.xsecToken || note.xsec_token ? `?xsec_token=${item.xsecToken || note.xsec_token}&xsec_source=pc_search` : ""}`
        : "",
    };
  });
}

async function fetchFromRapidAPI(endpoint: string, params: Record<string, string> = {}): Promise<any> {
  if (!RAPIDAPI_KEY) throw new Error("RapidAPI key not configured");

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

  const data = (await res.json()) as { code?: number; message?: string; [k: string]: unknown };
  if (data.code !== 0) {
    throw new Error(`RapidAPI response error: ${data.message || "unknown"}`);
  }

  return data;
}

function normalizeRapidAPINotes(rawItems: any[]): NormalizedNote[] {
  return rawItems.map((item: any) => {
    const note = item.note || item;
    const tags = (note.desc || "").match(/#[^\s#]+/g) || [];
    // RapidAPI 真实字段名：images_list[0].url（带签名的小红书 CDN 直链）
    // 兼容旧/异常情况：cover.url、image_list[0].url
    const firstImage = note.images_list?.[0] || note.image_list?.[0] || note.imageList?.[0];
    const coverUrl =
      firstImage?.url ||
      firstImage?.url_size_large ||
      note.cover?.url ||
      note.cover?.urlDefault ||
      "";
    // RapidAPI 也用了奇怪的 like 计数字段，比如 interaction_area.text
    const likedCountRaw =
      note.liked_count ?? note.likes ?? note.interactInfo?.likedCount ?? note.interact_info?.liked_count ?? "0";
    return {
      id: note.id || "",
      title: note.title || note.display_title || "",
      desc: (note.desc || "").slice(0, 200),
      liked_count: typeof likedCountRaw === "string" ? parseInt(likedCountRaw, 10) || 0 : likedCountRaw,
      collected_count: note.collected_count || note.collects || 0,
      comment_count: note.comments_count || note.comment_count || 0,
      shared_count: note.shared_count || 0,
      author: note.user?.nickname || "",
      tags: tags.map((t: string) => t.replace(/\[话题\]/g, "").replace("#", "")),
      type: note.type || "normal",
      source: "rapidapi",
      cover_url: coverUrl,
      note_url: note.id
        ? `https://www.xiaohongshu.com/explore/${note.id}${note.xsec_token ? `?xsec_token=${note.xsec_token}&xsec_source=pc_search` : ""}`
        : "",
    };
  });
}

async function proxyToAutoDL(path: string, options: RequestInit = {}): Promise<any> {
  if (!AUTODL_XHS_URL) throw new Error("AutoDL XHS service not configured");

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

export async function tryFetchXhsData(keyword: string): Promise<{ available: boolean; notes: NormalizedNote[]; source: string }> {
  if (TIKHUB_API_KEY) {
    try {
      const data = await fetchFromTikHub("/api/v1/xiaohongshu/web_v3/fetch_search_notes", {
        keyword,
        page: "1",
        sort: "general",
        note_type: "0",
      });

      const notes = normalizeTikHubNotes(data).slice(0, 20);
      if (notes.length > 0) {
        logger.info({ count: notes.length }, "TikHub XHS search succeeded");
        return { available: true, notes, source: "real-data" };
      }
    } catch (e: any) {
      logger.warn({ err: e.message }, "TikHub XHS search failed, trying RapidAPI");
    }
  }

  if (RAPIDAPI_KEY) {
    try {
      const data = await fetchFromRapidAPI("/api/xiaohongshu/search-note/v2", {
        keyword,
        page: "1",
      });

      const rawItems = data?.data?.items || [];
      if (rawItems.length > 0) {
        const notes = normalizeRapidAPINotes(rawItems).slice(0, 20);
        logger.info({ count: notes.length }, "RapidAPI XHS search succeeded");
        return { available: true, notes, source: "real-data" };
      }
    } catch (e: any) {
      logger.warn({ err: e.message }, "RapidAPI XHS search failed, trying AutoDL");
    }
  }

  if (AUTODL_XHS_URL) {
    try {
      const healthRes = await proxyToAutoDL("/health");
      if (healthRes?.xhs_ready) {
        const data = await proxyToAutoDL("/api/xhs/search", {
          method: "POST",
          body: JSON.stringify({ keyword, page: 1, sort: "hot" }),
        });

        if (!data?.error) {
          const notes = (data?.notes || []).slice(0, 10);
          if (notes.length > 0) {
            return { available: true, notes, source: "real-data" };
          }
        }
      }
    } catch (e: any) {
      logger.warn({ err: e.message }, "AutoDL XHS data fetch also failed");
    }
  }

  return { available: false, notes: [], source: "ai-only" };
}

publicRouter.get("/xhs/image-proxy", async (req, res): Promise<void> => {
  try {
    const url = req.query.url as string;
    if (!url || typeof url !== "string") {
      res.status(400).json({ error: "url parameter required" });
      return;
    }

    const allowed = ["xhscdn.com", "xiaohongshu.com", "sns-webpic", "sns-img", "sns-na-", "sns-avatar"];
    const isAllowed = allowed.some((d) => url.includes(d));
    if (!isAllowed) {
      res.status(403).json({ error: "URL not allowed" });
      return;
    }

    // 小红书 CDN 默认返回 HEIF，浏览器不认。改写为 webp。
    const rewritten = url.replace(/format\/heif/gi, "format/webp");
    const fetchUrl = rewritten.startsWith("//") ? `https:${rewritten}` : rewritten;
    const imgRes = await fetch(fetchUrl, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });

    if (!imgRes.ok) {
      res.status(imgRes.status).json({ error: "Failed to fetch image" });
      return;
    }

    const ct = imgRes.headers.get("content-type") || "image/webp";
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const buffer = Buffer.from(await imgRes.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    logger.warn(err, "Image proxy failed");
    res.status(500).json({ error: "Image proxy failed" });
  }
});

router.get("/xhs/health", async (_req, res): Promise<void> => {
  const status: any = { tikhub: false, rapidapi: false, autodl: false };

  if (TIKHUB_API_KEY) {
    try {
      const data = await fetchFromTikHub("/api/v1/xiaohongshu/web_v3/fetch_search_notes", {
        keyword: "测试",
        page: "1",
        sort: "general",
        note_type: "0",
      });
      status.tikhub = !!(data?.data?.data?.items?.length || data?.data?.items?.length);
    } catch { /* ignore */ }
  }

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

  status.anyAvailable = status.tikhub || status.rapidapi || status.autodl;
  res.json(status);
});

router.post("/xhs/search", async (req, res): Promise<void> => {
  try {
    const { keyword, page } = req.body;
    if (!keyword) {
      res.status(400).json({ error: "keyword is required" });
      return;
    }

    if (TIKHUB_API_KEY) {
      try {
        const data = await fetchFromTikHub("/api/v1/xiaohongshu/web_v3/fetch_search_notes", {
          keyword,
          page: String(page || 1),
          sort: "general",
          note_type: "0",
        });
        const notes = normalizeTikHubNotes(data);
        if (notes.length > 0) {
          res.json({ notes, source: "tikhub", total: notes.length });
          return;
        }
      } catch (e: any) {
        logger.warn({ err: e.message }, "TikHub search failed, trying RapidAPI");
      }
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

    if (TIKHUB_API_KEY) {
      try {
        const data = await fetchFromTikHub("/api/v1/xiaohongshu/web_v3/fetch_note_detail", { note_id: noteId });
        res.json({ data: data?.data, source: "tikhub" });
        return;
      } catch (e: any) {
        logger.warn({ err: e.message }, "TikHub note detail failed, trying RapidAPI");
      }
    }

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
export { publicRouter as xhsPublicRouter };
