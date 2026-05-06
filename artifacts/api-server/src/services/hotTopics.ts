import { db, hotTopicsCacheTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const TIKHUB_API_KEY = process.env.TIKHUB_API_KEY || "";
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || "";
const RAPIDAPI_HOST = "xiaohongshu-all-api.p.rapidapi.com";

const REGION_KEYWORD: Record<string, string> = {
  SG: "新加坡",
  HK: "香港",
  MY: "马来西亚",
  ALL: "",
};

interface RawNote {
  id: string;
  title: string;
  desc: string;
  liked_count: number;
  cover_url: string;
  tags: string[];
  // 可选附加字段（从 provider 直接拿到时填充，否则前端兜底）
  comment_count?: number;
  share_count?: number;
  view_count?: number;
  note_url?: string;
}

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fetchNotesForKeyword(keyword: string): Promise<RawNote[]> {
  // 优先 TikHub
  if (TIKHUB_API_KEY) {
    try {
      const url = new URL("https://api.tikhub.io/api/v1/xiaohongshu/web_v3/fetch_search_notes");
      url.searchParams.set("keyword", keyword);
      url.searchParams.set("page", "1");
      url.searchParams.set("sort", "general");
      url.searchParams.set("note_type", "0");
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${TIKHUB_API_KEY}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const j: any = await res.json();
        const items = j?.data?.data?.items || j?.data?.items || [];
        const mapped = (items as any[]).map((it) => {
          const note = it.noteCard || it.note_card || it.note || it;
          const ii = note.interactInfo || note.interact_info || {};
          const desc = note.desc || note.displayTitle || note.title || "";
          const id = it.id || note.note_id || note.id || "";
          return {
            id,
            title: note.displayTitle || note.display_title || note.title || "",
            desc,
            liked_count: parseInt(ii.likedCount || ii.liked_count || "0", 10) || 0,
            comment_count: parseInt(ii.commentCount || ii.comment_count || "0", 10) || 0,
            share_count: parseInt(ii.shareCount || ii.share_count || "0", 10) || 0,
            cover_url: note.cover?.urlDefault || note.cover?.url || "",
            note_url: id ? `https://www.xiaohongshu.com/explore/${id}` : "",
            tags: (desc.match(/#[^\s#\[]+/g) || []).map((t: string) => t.replace("#", "").trim()).filter(Boolean),
          };
        }).filter((x) => x.id);
        if (mapped.length) return mapped;
      }
    } catch (e: any) {
      logger.warn({ err: e.message, keyword }, "hotTopics TikHub failed");
    }
  }

  if (RAPIDAPI_KEY) {
    try {
      const url = new URL(`https://${RAPIDAPI_HOST}/api/xiaohongshu/search-note/v2`);
      url.searchParams.set("keyword", keyword);
      url.searchParams.set("page", "1");
      const res = await fetch(url, {
        headers: { "x-rapidapi-host": RAPIDAPI_HOST, "x-rapidapi-key": RAPIDAPI_KEY },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const j: any = await res.json();
        const items = j?.data?.items || [];
        return (items as any[]).map((it) => {
          const n = it.note || it;
          const desc = n.desc || n.title || "";
          const likedRaw = n.liked_count ?? n.likes ?? "0";
          const commentRaw = n.comment_count ?? n.comments ?? 0;
          const shareRaw = n.share_count ?? n.shares ?? 0;
          const firstImage = n.images_list?.[0] || n.image_list?.[0];
          const id = n.id || "";
          return {
            id,
            title: n.title || n.display_title || "",
            desc,
            liked_count: typeof likedRaw === "string" ? parseInt(likedRaw, 10) || 0 : likedRaw,
            comment_count: typeof commentRaw === "string" ? parseInt(commentRaw, 10) || 0 : commentRaw,
            share_count: typeof shareRaw === "string" ? parseInt(shareRaw, 10) || 0 : shareRaw,
            cover_url: firstImage?.url || n.cover?.url || "",
            note_url: id ? `https://www.xiaohongshu.com/explore/${id}` : "",
            tags: (desc.match(/#[^\s#\[]+/g) || []).map((t: string) => t.replace("#", "").trim()).filter(Boolean),
          };
        }).filter((x) => x.id);
      }
    } catch (e: any) {
      logger.warn({ err: e.message, keyword }, "hotTopics RapidAPI failed");
    }
  }

  return [];
}

export async function fetchHotTopics(niche: string, region: string = "ALL"): Promise<{ topics: any[]; samplesAnalyzed: number }> {
  const regionKw = REGION_KEYWORD[region] || "";
  const queries = [niche, regionKw ? `${regionKw} ${niche}` : ""].filter(Boolean);

  const allNotes: RawNote[] = [];
  for (const q of queries) {
    const notes = await fetchNotesForKeyword(q);
    allNotes.push(...notes);
  }

  // 去重 by id
  const uniq = new Map<string, RawNote>();
  for (const n of allNotes) {
    const existing = uniq.get(n.id);
    if (!existing || n.liked_count > existing.liked_count) uniq.set(n.id, n);
  }
  const notes = Array.from(uniq.values()).sort((a, b) => b.liked_count - a.liked_count);

  // 聚合标签
  const tagAgg = new Map<string, { count: number; topLikes: number; sampleNote: RawNote }>();
  for (const n of notes) {
    for (const t of n.tags) {
      const tag = t.toLowerCase();
      if (!tag || tag.length > 20) continue;
      const cur = tagAgg.get(tag);
      if (cur) {
        cur.count++;
        if (n.liked_count > cur.topLikes) {
          cur.topLikes = n.liked_count;
          cur.sampleNote = n;
        }
      } else {
        tagAgg.set(tag, { count: 1, topLikes: n.liked_count, sampleNote: n });
      }
    }
  }

  const topics = Array.from(tagAgg.entries())
    .map(([tag, info]) => ({
      tag,
      count: info.count,
      topLikes: info.topLikes,
      sampleTitle: info.sampleNote.title,
      sampleNoteId: info.sampleNote.id,
      sampleCover: info.sampleNote.cover_url,
    }))
    .filter((t) => t.count >= 2)
    .sort((a, b) => b.count * 1000 + b.topLikes - (a.count * 1000 + a.topLikes))
    .slice(0, 20);

  return { topics, samplesAnalyzed: notes.length };
}

/**
 * 直接搜小红书笔记（带地区前缀），按点赞数倒排去重
 * 给 /api/market-data/trending?platform=xhs 使用
 */
export async function searchXhsNotes(keyword: string, region: string = "ALL", limit = 20): Promise<RawNote[]> {
  const regionKw = REGION_KEYWORD[region] || "";
  const queries = [keyword, regionKw ? `${regionKw} ${keyword}` : ""].filter(Boolean);

  const all: RawNote[] = [];
  for (const q of queries) {
    const ns = await fetchNotesForKeyword(q);
    all.push(...ns);
  }
  const uniq = new Map<string, RawNote>();
  for (const n of all) {
    const e = uniq.get(n.id);
    if (!e || n.liked_count > e.liked_count) uniq.set(n.id, n);
  }
  return Array.from(uniq.values())
    .sort((a, b) => b.liked_count - a.liked_count)
    .slice(0, limit);
}

export function isXhsHotTopicsConfigured(): boolean {
  return Boolean(TIKHUB_API_KEY || RAPIDAPI_KEY);
}

export async function getOrFetchHotTopics(niche: string, region: string = "ALL"): Promise<{ topics: any[]; samplesAnalyzed: number; cached: boolean; date: string }> {
  const date = todayDateStr();
  const [cached] = await db
    .select()
    .from(hotTopicsCacheTable)
    .where(and(eq(hotTopicsCacheTable.niche, niche), eq(hotTopicsCacheTable.region, region), eq(hotTopicsCacheTable.date, date)))
    .limit(1);

  if (cached) {
    return { topics: cached.topics || [], samplesAnalyzed: cached.samplesAnalyzed, cached: true, date };
  }

  const { topics, samplesAnalyzed } = await fetchHotTopics(niche, region);
  if (topics.length > 0) {
    await db
      .insert(hotTopicsCacheTable)
      .values({ niche, region, date, topics, samplesAnalyzed })
      .onConflictDoUpdate({
        target: [hotTopicsCacheTable.niche, hotTopicsCacheTable.region, hotTopicsCacheTable.date],
        set: { topics, samplesAnalyzed, fetchedAt: new Date() },
      });
  }
  return { topics, samplesAnalyzed, cached: false, date };
}
