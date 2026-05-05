import { db, noteTrackingTable, noteMetricsDailyTable, keywordRankingsDailyTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const TIKHUB_API_KEY = process.env.TIKHUB_API_KEY || "";
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || "";
const RAPIDAPI_HOST = "xiaohongshu-all-api.p.rapidapi.com";

export interface NoteMetrics {
  likedCount: number;
  collectedCount: number;
  commentCount: number;
  sharedCount: number;
  title?: string;
}

export interface KeywordRankResult {
  keyword: string;
  rank: number | null;
  found: boolean;
}

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 在搜索结果里查找指定 noteId 的位置（1-based）。仅查前 3 页。
 * rank 用累计偏移计算，避免各页返回条数不一致导致排名错位。
 */
export async function checkKeywordRank(noteId: string, keyword: string): Promise<KeywordRankResult> {
  const MAX_PAGES = 3;
  let offset = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const items = await searchNotes(keyword, page);
    if (!items.length) break;

    for (let i = 0; i < items.length; i++) {
      if (items[i].id === noteId) {
        return { keyword, rank: offset + i + 1, found: true };
      }
    }
    offset += items.length;
    // 翻页之间限速，避免触发供应商 QPS 限制
    if (page < MAX_PAGES) await sleep(300);
  }

  return { keyword, rank: null, found: false };
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * 拉一篇笔记的当前公开互动数据。
 * 策略：用笔记 title 作为关键词搜索 → 在结果中匹配 noteId → 取得最新 metric。
 * 如果没 title，用 noteId 前 8 位作模糊搜索（鸡肋，但聊胜于无）。
 */
export async function fetchNoteMetrics(
  noteId: string,
  hintTitle?: string,
  fallbackKeywords: string[] = [],
): Promise<NoteMetrics | null> {
  const queries: string[] = [];
  if (hintTitle && hintTitle.trim()) queries.push(hintTitle.slice(0, 30));
  for (const k of fallbackKeywords) {
    if (k && k.trim()) queries.push(k.trim());
  }
  const seen = new Set<string>();
  const uniq = queries.filter((q) => (seen.has(q) ? false : (seen.add(q), true))).slice(0, 4);

  for (const q of uniq) {
    for (let page = 1; page <= 2; page++) {
      const items = await searchNotes(q, page);
      const hit = items.find((it) => it.id === noteId);
      if (hit) {
        return {
          likedCount: hit.liked_count || 0,
          collectedCount: hit.collected_count || 0,
          commentCount: hit.comment_count || 0,
          sharedCount: hit.shared_count || 0,
          title: hit.title,
        };
      }
      await sleep(300);
    }
  }

  return null;
}

interface SearchItem {
  id: string;
  title: string;
  liked_count: number;
  collected_count: number;
  comment_count: number;
  shared_count: number;
}

async function searchNotes(keyword: string, page: number): Promise<SearchItem[]> {
  // 优先 TikHub
  if (TIKHUB_API_KEY) {
    try {
      const url = new URL("https://api.tikhub.io/api/v1/xiaohongshu/web_v3/fetch_search_notes");
      url.searchParams.set("keyword", keyword);
      url.searchParams.set("page", String(page));
      url.searchParams.set("sort", "general");
      url.searchParams.set("note_type", "0");
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${TIKHUB_API_KEY}`, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const j: any = await res.json();
        const items = j?.data?.data?.items || j?.data?.items || [];
        const mapped = (items as any[])
          .map((it) => {
            const note = it.noteCard || it.note_card || it.note || it;
            const ii = note.interactInfo || note.interact_info || {};
            return {
              id: it.id || note.note_id || note.id || "",
              title: note.displayTitle || note.display_title || note.title || "",
              liked_count: parseInt(ii.likedCount || ii.liked_count || "0", 10) || 0,
              collected_count: parseInt(ii.collectedCount || ii.collected_count || "0", 10) || 0,
              comment_count: parseInt(ii.commentCount || ii.comment_count || "0", 10) || 0,
              shared_count: parseInt(ii.sharedCount || ii.share_count || "0", 10) || 0,
            };
          })
          .filter((x) => x.id);
        if (mapped.length) return mapped;
      }
    } catch (e: any) {
      logger.warn({ err: e.message, keyword, page }, "TikHub searchNotes failed, will try RapidAPI");
    }
  }

  // 降级 RapidAPI
  if (RAPIDAPI_KEY) {
    try {
      const url = new URL(`https://${RAPIDAPI_HOST}/api/xiaohongshu/search-note/v2`);
      url.searchParams.set("keyword", keyword);
      url.searchParams.set("page", String(page));
      const res = await fetch(url, {
        headers: { "x-rapidapi-host": RAPIDAPI_HOST, "x-rapidapi-key": RAPIDAPI_KEY },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const j: any = await res.json();
        if (j.code === 0) {
          const items = j?.data?.items || [];
          return (items as any[])
            .map((it) => {
              const n = it.note || it;
              const likedRaw = n.liked_count ?? n.likes ?? "0";
              return {
                id: n.id || "",
                title: n.title || n.display_title || "",
                liked_count: typeof likedRaw === "string" ? parseInt(likedRaw, 10) || 0 : likedRaw,
                collected_count: n.collected_count || n.collects || 0,
                comment_count: n.comments_count || n.comment_count || 0,
                shared_count: n.shared_count || 0,
              };
            })
            .filter((x) => x.id);
        }
      }
    } catch (e: any) {
      logger.warn({ err: e.message, keyword, page }, "RapidAPI searchNotes failed");
    }
  }

  return [];
}

/**
 * 对单条 tracking 跑一次完整刷新（互动数 + 全部 keyword 排名）
 */
export async function refreshTracking(trackingId: number): Promise<{ ok: boolean; metricsUpdated: boolean; ranksUpdated: number }> {
  const [t] = await db.select().from(noteTrackingTable).where(eq(noteTrackingTable.id, trackingId)).limit(1);
  if (!t) return { ok: false, metricsUpdated: false, ranksUpdated: 0 };

  const date = todayDateStr();
  let metricsUpdated = false;
  let ranksUpdated = 0;

  // 1. 互动数
  try {
    const m = await fetchNoteMetrics(t.xhsNoteId, t.title, t.targetKeywords || []);
    if (m) {
      await db
        .insert(noteMetricsDailyTable)
        .values({
          trackingId: t.id,
          date,
          likedCount: m.likedCount,
          collectedCount: m.collectedCount,
          commentCount: m.commentCount,
          sharedCount: m.sharedCount,
        })
        .onConflictDoUpdate({
          target: [noteMetricsDailyTable.trackingId, noteMetricsDailyTable.date],
          set: {
            likedCount: m.likedCount,
            collectedCount: m.collectedCount,
            commentCount: m.commentCount,
            sharedCount: m.sharedCount,
            fetchedAt: new Date(),
          },
        });
      metricsUpdated = true;
      // 同步回填 title（首次抓不到，后续能补）
      if (m.title && !t.title) {
        await db.update(noteTrackingTable).set({ title: m.title }).where(eq(noteTrackingTable.id, t.id));
      }
    }
  } catch (e: any) {
    logger.warn({ err: e.message, trackingId }, "fetchNoteMetrics failed");
  }

  // 2. 关键词排名
  for (const keyword of t.targetKeywords || []) {
    try {
      const r = await checkKeywordRank(t.xhsNoteId, keyword);
      await db
        .insert(keywordRankingsDailyTable)
        .values({ trackingId: t.id, keyword, date, rank: r.rank, found: r.found ? 1 : 0 })
        .onConflictDoUpdate({
          target: [keywordRankingsDailyTable.trackingId, keywordRankingsDailyTable.keyword, keywordRankingsDailyTable.date],
          set: { rank: r.rank, found: r.found ? 1 : 0, fetchedAt: new Date() },
        });
      ranksUpdated++;
    } catch (e: any) {
      logger.warn({ err: e.message, trackingId, keyword }, "checkKeywordRank failed");
    }
  }

  await db.update(noteTrackingTable).set({ lastCheckedAt: new Date() }).where(eq(noteTrackingTable.id, t.id));
  return { ok: true, metricsUpdated, ranksUpdated };
}

/**
 * 全量定时任务：扫所有未归档的 tracking 并刷新。串行避免触发限流。
 */
export async function runDailyTrackingJob(): Promise<{ scanned: number; succeeded: number }> {
  const list = await db.select().from(noteTrackingTable).where(eq(noteTrackingTable.archived, 0));
  let succeeded = 0;
  for (const t of list) {
    try {
      const r = await refreshTracking(t.id);
      if (r.ok) succeeded++;
      // 简单限速：每条间隔 500ms
      await new Promise((res) => setTimeout(res, 500));
    } catch (e: any) {
      logger.warn({ err: e.message, trackingId: t.id }, "refreshTracking failed");
    }
  }
  logger.info({ scanned: list.length, succeeded }, "Daily tracking job done");
  return { scanned: list.length, succeeded };
}

/**
 * 从小红书 URL 中解析 noteId。
 * 支持：https://www.xiaohongshu.com/explore/{id}?xsec_token=...
 *       https://www.xiaohongshu.com/discovery/item/{id}
 *       https://xhslink.com/...（短链不解析，让用户手动解）
 */
export function parseNoteIdFromUrl(url: string): string | null {
  if (!url) return null;
  const m = url.match(/\/(?:explore|discovery\/item)\/([a-f0-9]{20,})/i);
  return m?.[1] || null;
}

export function parseXsecTokenFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.searchParams.get("xsec_token");
  } catch {
    return null;
  }
}
