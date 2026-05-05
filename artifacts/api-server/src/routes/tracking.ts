import { Router, type IRouter } from "express";
import { eq, and, desc, asc, inArray } from "drizzle-orm";
import {
  db,
  noteTrackingTable,
  noteMetricsDailyTable,
  keywordRankingsDailyTable,
  contentTable,
  accountsTable,
} from "@workspace/db";
import { ensureUser } from "../middlewares/creditSystem";
import {
  refreshTracking,
  parseNoteIdFromUrl,
  parseXsecTokenFromUrl,
} from "../services/noteTracking";
import { getOrFetchHotTopics } from "../services/hotTopics";

const router: IRouter = Router();

router.post("/tracking/notes", async (req, res): Promise<void> => {
  try {
    const u = await ensureUser(req);
    if (!u) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const {
      xhsUrl,
      title = "",
      targetKeywords = [],
      contentId,
      accountId,
      region,
    } = req.body || {};

    if (!xhsUrl || typeof xhsUrl !== "string") {
      res.status(400).json({ error: "xhsUrl is required" });
      return;
    }

    const noteId = parseNoteIdFromUrl(xhsUrl);
    if (!noteId) {
      res.status(400).json({
        error: "无法从链接解析出笔记 ID。请使用形如 https://www.xiaohongshu.com/explore/xxxxx 的完整链接。",
      });
      return;
    }

    const cleanKeywords = (Array.isArray(targetKeywords) ? targetKeywords : [])
      .map((k: any) => String(k).trim())
      .filter(Boolean)
      .slice(0, 5);

    // 防止跨租户引用：contentId/accountId 必须属于当前用户
    let safeContentId: number | null = null;
    if (contentId) {
      const [c] = await db
        .select({ id: contentTable.id })
        .from(contentTable)
        .innerJoin(accountsTable, eq(contentTable.accountId, accountsTable.id))
        .where(and(eq(contentTable.id, Number(contentId)), eq(accountsTable.ownerUserId, u.id)))
        .limit(1);
      if (!c) {
        res.status(403).json({ error: "无权引用该 contentId" });
        return;
      }
      safeContentId = c.id;
    }

    let safeAccountId: number | null = null;
    if (accountId) {
      const [a] = await db
        .select({ id: accountsTable.id })
        .from(accountsTable)
        .where(and(eq(accountsTable.id, Number(accountId)), eq(accountsTable.ownerUserId, u.id)))
        .limit(1);
      if (!a) {
        res.status(403).json({ error: "无权引用该 accountId" });
        return;
      }
      safeAccountId = a.id;
    }

    const [row] = await db
      .insert(noteTrackingTable)
      .values({
        ownerUserId: u.id,
        contentId: safeContentId,
        accountId: safeAccountId,
        xhsNoteId: noteId,
        xhsUrl,
        title: String(title || "").slice(0, 200),
        targetKeywords: cleanKeywords,
        region: region ?? null,
      })
      .onConflictDoUpdate({
        target: [noteTrackingTable.ownerUserId, noteTrackingTable.xhsNoteId],
        set: {
          xhsUrl,
          title: String(title || "").slice(0, 200),
          targetKeywords: cleanKeywords,
          region: region ?? null,
          archived: 0,
        },
      })
      .returning();

    // 立刻触发一次抓取（不阻塞响应）
    refreshTracking(row.id).catch(() => {});

    res.status(201).json(row);
  } catch (err: any) {
    req.log.error(err, "Failed to add tracking");
    res.status(500).json({ error: err?.message || "Internal server error" });
  }
});

router.get("/tracking/notes", async (req, res): Promise<void> => {
  try {
    const u = await ensureUser(req);
    if (!u) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const list = await db
      .select()
      .from(noteTrackingTable)
      .where(and(eq(noteTrackingTable.ownerUserId, u.id), eq(noteTrackingTable.archived, 0)))
      .orderBy(desc(noteTrackingTable.addedAt));

    if (list.length === 0) {
      res.json([]);
      return;
    }

    const ids = list.map((t) => t.id);
    const latestMetrics = await db
      .select()
      .from(noteMetricsDailyTable)
      .where(inArray(noteMetricsDailyTable.trackingId, ids))
      .orderBy(desc(noteMetricsDailyTable.date));

    const metricsByTracking = new Map<number, typeof latestMetrics[number]>();
    for (const m of latestMetrics) {
      if (!metricsByTracking.has(m.trackingId)) metricsByTracking.set(m.trackingId, m);
    }

    // 每个 tracking 取最新一天的所有关键词排名
    const latestRanksRaw = await db
      .select()
      .from(keywordRankingsDailyTable)
      .where(inArray(keywordRankingsDailyTable.trackingId, ids))
      .orderBy(desc(keywordRankingsDailyTable.date));

    const latestDateByTracking = new Map<number, string>();
    const ranksByTracking = new Map<number, typeof latestRanksRaw>();
    for (const r of latestRanksRaw) {
      if (!latestDateByTracking.has(r.trackingId)) {
        latestDateByTracking.set(r.trackingId, r.date);
      }
      if (latestDateByTracking.get(r.trackingId) !== r.date) continue;
      const arr = ranksByTracking.get(r.trackingId) || [];
      arr.push(r);
      ranksByTracking.set(r.trackingId, arr);
    }

    const result = list.map((t) => ({
      ...t,
      latestMetrics: metricsByTracking.get(t.id) || null,
      latestRanks: ranksByTracking.get(t.id) || [],
    }));

    res.json(result);
  } catch (err: any) {
    req.log.error(err, "Failed to list tracking");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/tracking/notes/:id", async (req, res): Promise<void> => {
  try {
    const u = await ensureUser(req);
    if (!u) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }

    const [t] = await db
      .select()
      .from(noteTrackingTable)
      .where(and(eq(noteTrackingTable.id, id), eq(noteTrackingTable.ownerUserId, u.id)))
      .limit(1);

    if (!t) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const metrics = await db
      .select()
      .from(noteMetricsDailyTable)
      .where(eq(noteMetricsDailyTable.trackingId, id))
      .orderBy(asc(noteMetricsDailyTable.date));

    const ranks = await db
      .select()
      .from(keywordRankingsDailyTable)
      .where(eq(keywordRankingsDailyTable.trackingId, id))
      .orderBy(asc(keywordRankingsDailyTable.date));

    res.json({ tracking: t, metrics, ranks });
  } catch (err: any) {
    req.log.error(err, "Failed to get tracking");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/tracking/notes/:id/refresh", async (req, res): Promise<void> => {
  try {
    const u = await ensureUser(req);
    if (!u) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const id = parseInt(req.params.id, 10);
    const [t] = await db
      .select()
      .from(noteTrackingTable)
      .where(and(eq(noteTrackingTable.id, id), eq(noteTrackingTable.ownerUserId, u.id)))
      .limit(1);
    if (!t) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const r = await refreshTracking(id);
    res.json(r);
  } catch (err: any) {
    req.log.error(err, "Failed to refresh tracking");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/tracking/notes/:id", async (req, res): Promise<void> => {
  try {
    const u = await ensureUser(req);
    if (!u) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const id = parseInt(req.params.id, 10);
    await db
      .update(noteTrackingTable)
      .set({ archived: 1 })
      .where(and(eq(noteTrackingTable.id, id), eq(noteTrackingTable.ownerUserId, u.id)));

    res.status(204).send();
  } catch (err: any) {
    req.log.error(err, "Failed to delete tracking");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/tracking/hot-topics", async (req, res): Promise<void> => {
  try {
    const niche = String(req.query.niche || "").trim();
    const region = String(req.query.region || "ALL").trim().toUpperCase();
    if (!niche) {
      res.status(400).json({ error: "niche query is required" });
      return;
    }
    const data = await getOrFetchHotTopics(niche, region);
    res.json(data);
  } catch (err: any) {
    req.log.error(err, "Failed to fetch hot topics");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
