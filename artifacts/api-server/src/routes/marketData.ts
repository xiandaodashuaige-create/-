import { Router, type IRouter } from "express";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { db, competitorPostsTable, competitorProfilesTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { fetchTrendingHashtagVideos, isTikHubConfigured } from "../services/tikhubScraper";
import { searchXhsNotes, isXhsHotTopicsConfigured } from "../services/hotTopics";
import { ensureUser } from "../middlewares/creditSystem";

// 市场数据探索：跨平台热门内容、广告库、最佳发布时间
const router: IRouter = Router();

// FB/IG 热门数据兜底：聚合用户已添加的同行账号最近爆款帖子
async function fetchCompetitorTrending(
  userId: number,
  platform: "facebook" | "instagram",
  keyword: string,
): Promise<any[] | null> {
  // 找用户在该平台的同行账号
  const profiles = await db
    .select()
    .from(competitorProfilesTable)
    .where(and(
      eq(competitorProfilesTable.userId, userId),
      eq(competitorProfilesTable.platform, platform),
    ));
  if (profiles.length === 0) return null;

  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const posts = await db
    .select()
    .from(competitorPostsTable)
    .where(and(
      eq(competitorPostsTable.platform, platform),
      inArray(competitorPostsTable.competitorId, profiles.map((p) => p.id)),
    ))
    .orderBy(desc(competitorPostsTable.likeCount))
    .limit(40);

  if (posts.length === 0) return null;

  // 关键词过滤（弱过滤，避免一关键词过滤掉所有数据）
  const kw = keyword.trim().toLowerCase();
  const filtered = kw && kw.length >= 2
    ? posts.filter((p) => {
        const hay = [p.title, p.description, (p.hashtags ?? []).join(" ")].join(" ").toLowerCase();
        return hay.includes(kw);
      })
    : posts;
  const finalPosts = filtered.length >= 3 ? filtered : posts;

  return finalPosts.slice(0, 20).map((p) => {
    const profile = profileById.get(p.competitorId);
    return {
      id: `competitor_${p.id}`,
      platform,
      title: (p.title || p.description || "").slice(0, 100) || `@${profile?.handle ?? ""} 的帖子`,
      description: p.description ?? "",
      thumbnailUrl: p.coverUrl ?? p.mediaUrl ?? "",
      mediaUrl: p.postUrl ?? p.mediaUrl ?? "",
      likes: p.likeCount,
      views: p.viewCount,
      comments: p.commentCount,
      shares: p.shareCount,
      hashtags: p.hashtags ?? [],
      duration: p.duration ?? 0,
      author: profile?.handle ?? null,
    };
  });
}

// ── GET /api/market-data/trending?platform=tiktok&keyword=美容&region=MY ──
router.get("/market-data/trending", async (req, res): Promise<void> => {
  const platform = (req.query.platform as string) || "tiktok";
  const keyword = ((req.query.keyword as string) || "beauty").trim();
  const region = ((req.query.region as string) || "MY").trim();

  if (platform === "tiktok") {
    if (!isTikHubConfigured()) { res.json({ platform, source: "mock", items: getMockTrending(platform, keyword) }); return; }
    try {
      const videos = await fetchTrendingHashtagVideos(keyword, region, 20);
      res.json({
        platform, keyword, region, source: "tikhub",
        // 0 条时带 note,前端展示"无结果"提示卡而不是误以为按钮坏了
        note: videos.length === 0 ? "no_results" : undefined,
        items: videos.map(v => ({
          id: v.externalId, platform: "tiktok",
          title: v.description, description: v.description,
          thumbnailUrl: v.coverUrl, mediaUrl: v.videoUrl,
          likes: v.likeCount, views: v.viewCount, comments: v.commentCount, shares: v.shareCount,
          hashtags: v.hashtags, duration: v.duration,
          musicName: v.musicName,
        })),
      });
    } catch (err: any) {
      logger.error({ err: err.message, keyword, region }, "market-data/trending tiktok failed");
      res.json({ platform, keyword, region, source: "mock", items: getMockTrending(platform, keyword) });
    }
    return;
  }

  if (platform === "xhs") {
    if (!isXhsHotTopicsConfigured()) {
      res.json({ platform, keyword, region, source: "mock", items: getMockTrending(platform, keyword) });
      return;
    }
    try {
      const notes = await searchXhsNotes(keyword, region, 20);
      if (!notes.length) {
        res.json({ platform, keyword, region, source: "xhs", items: [], note: "no_results" });
        return;
      }
      res.json({
        platform, keyword, region, source: "xhs",
        items: notes.map(n => ({
          id: n.id, platform: "xhs",
          title: n.title || n.desc.slice(0, 60),
          description: n.desc,
          thumbnailUrl: n.cover_url,
          mediaUrl: n.note_url || `https://www.xiaohongshu.com/explore/${n.id}`,
          likes: n.liked_count,
          views: 0,
          comments: n.comment_count ?? 0,
          shares: n.share_count ?? 0,
          hashtags: n.tags,
        })),
      });
    } catch (err: any) {
      logger.error({ err: err.message, keyword, region }, "market-data/trending xhs failed");
      res.json({ platform, keyword, region, source: "mock", items: getMockTrending(platform, keyword) });
    }
    return;
  }

  // FB/IG：先从用户已添加的同行库聚合真实爆款；空才回退 mock
  if (platform === "facebook" || platform === "instagram") {
    const user = await ensureUser(req);
    if (user) {
      try {
        const items = await fetchCompetitorTrending(user.id, platform, keyword);
        if (items && items.length > 0) {
          res.json({ platform, keyword, region, source: "competitor_posts", items });
          return;
        }
      } catch (err: any) {
        logger.error({ err: err.message, platform, userId: user.id }, "market-data/trending competitor aggregate failed");
      }
    }
    res.json({
      platform, keyword, region,
      source: "mock",
      sourceConfidence: "low",
      hint: `${platform} 没有官方公开热门接口；建议在「同行库」追加 5-10 个目标账号后，本接口将自动聚合真实爆款。`,
      items: getMockTrending(platform, keyword),
    });
    return;
  }

  res.json({ platform, keyword, region, source: "mock", items: getMockTrending(platform, keyword) });
});

// ── GET /api/market-data/ads?keyword=beauty&country=MY ───────────────
// Meta 广告库（需要 FACEBOOK_ACCESS_TOKEN）
router.get("/market-data/ads", async (req, res): Promise<void> => {
  const keyword = ((req.query.keyword as string) || "beauty").trim();
  const country = ((req.query.country as string) || "MY").trim();
  const token = process.env.FACEBOOK_ACCESS_TOKEN;
  if (!token) { res.json({ source: "mock", configured: false, items: getMockAds(keyword) }); return; }
  try {
    const url = new URL("https://graph.facebook.com/v19.0/ads_archive");
    url.searchParams.set("search_terms", keyword);
    url.searchParams.set("ad_reached_countries", `["${country}"]`);
    url.searchParams.set("ad_type", "ALL");
    url.searchParams.set("fields", "id,page_name,ad_creative_body,ad_snapshot_url,ad_delivery_start_time,publisher_platforms");
    url.searchParams.set("limit", "20");
    url.searchParams.set("access_token", token);
    const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    const data = await resp.json() as any;
    if (!resp.ok || !data?.data) { res.json({ source: "mock", configured: true, items: getMockAds(keyword) }); return; }
    const ads = (data.data as any[]).map((ad) => ({
      id: String(ad.id ?? ""), advertiserName: String(ad.page_name ?? "Unknown"),
      caption: String(ad.ad_creative_body ?? ""),
      mediaUrl: String(ad.ad_snapshot_url ?? ""),
      startDate: String(ad.ad_delivery_start_time ?? ""),
      platforms: Array.isArray(ad.publisher_platforms) ? ad.publisher_platforms : ["facebook"],
    }));
    res.json({ source: "graph", configured: true, items: ads });
  } catch (err: any) {
    logger.error({ err: err.message }, "market-data/ads failed");
    res.json({ source: "mock", configured: true, items: getMockAds(keyword) });
  }
});

// ── GET /api/market-data/best-times ──────────────────────────────────
// source 字段：
//   - "real"     : 用户已收集的真实同行 published_at 聚合（>=10 条样本）
//   - "fallback" : 样本不足，回退到行业经验常量
//   - "mock"     : 用户未登录或没任何同行数据
const BEST_TIMES_FALLBACK: Record<string, { bestDays: string[]; bestHours: number[]; insight: string }> = {
  xhs: { bestDays: ["Wednesday", "Friday", "Saturday", "Sunday"], bestHours: [12, 19, 22], insight: "20:00-22:00 流量峰值，周末白天表现更稳（行业经验值）" },
  tiktok: { bestDays: ["Tuesday", "Thursday", "Friday"], bestHours: [19, 20, 21], insight: "晚间 19-21 完播率高 2 倍（行业经验值）" },
  instagram: { bestDays: ["Monday", "Tuesday", "Wednesday", "Friday"], bestHours: [6, 12, 19], insight: "Reels 在 6am 或 7pm 表现 +23%（行业经验值）" },
  facebook: { bestDays: ["Tuesday", "Wednesday", "Thursday"], bestHours: [9, 13, 15], insight: "工作日下午 1-3 点互动 +18%（行业经验值）" },
};

const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// region → IANA 时区映射（HK/MY 用户看 best-times 时按本地时区分桶，避免被 SGT 误导）
const REGION_TZ: Record<string, string> = {
  SG: "Asia/Singapore",
  HK: "Asia/Hong_Kong",
  MY: "Asia/Kuala_Lumpur",
  CN: "Asia/Shanghai",
  GLOBAL: "Asia/Singapore",
};
const TZ_LABELS: Record<string, string> = {
  "Asia/Singapore": "SGT",
  "Asia/Hong_Kong": "HKT",
  "Asia/Kuala_Lumpur": "MYT",
  "Asia/Shanghai": "CST",
};
// 严格白名单，防止 SQL 注入（sql.raw 用）
const ALLOWED_TZ = new Set(Object.values(REGION_TZ));

async function aggregatePerPlatform(userId: number, platform: string, tz: string) {
  // 拉用户在该平台的同行 ID 列表
  const profiles = await db
    .select({ id: competitorProfilesTable.id })
    .from(competitorProfilesTable)
    .where(and(eq(competitorProfilesTable.userId, userId), eq(competitorProfilesTable.platform, platform)));
  if (profiles.length === 0) return null;
  const ids = profiles.map((p) => p.id);

  // 按用户本地时区聚合（HK/MY/SG/CN 用对应 IANA 时区）
  const safeTz = ALLOWED_TZ.has(tz) ? tz : "Asia/Singapore";
  const rows = await db.execute(sql`
    SELECT
      EXTRACT(HOUR  FROM (published_at AT TIME ZONE ${safeTz}))::int AS hour,
      EXTRACT(DOW   FROM (published_at AT TIME ZONE ${safeTz}))::int AS dow,
      COUNT(*)::int AS posts,
      SUM(COALESCE(view_count,0) + COALESCE(like_count,0)*5 + COALESCE(comment_count,0)*10)::bigint AS score
    FROM competitor_posts
    WHERE platform = ${platform}
      AND competitor_id = ANY(${ids})
      AND published_at IS NOT NULL
      AND published_at > NOW() - INTERVAL '120 days'
    GROUP BY 1, 2
  `);
  const buckets = (rows as any).rows ?? [];
  const totalPosts = buckets.reduce((s: number, r: any) => s + Number(r.posts), 0);
  if (totalPosts < 10) return null; // 样本太少，不可信

  // 时段：取 score 最高的前 3 个小时
  const byHour = new Map<number, number>();
  const byDow = new Map<number, number>();
  for (const r of buckets) {
    const h = Number(r.hour); const d = Number(r.dow); const s = Number(r.score);
    byHour.set(h, (byHour.get(h) ?? 0) + s);
    byDow.set(d, (byDow.get(d) ?? 0) + s);
  }
  const bestHours = [...byHour.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h]) => h).sort((a, b) => a - b);
  const bestDays = [...byDow.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([d]) => DOW_NAMES[d]);
  const tzLabel = TZ_LABELS[safeTz] ?? safeTz;
  const insight = `基于您 ${profiles.length} 位 ${platform} 同行的 ${totalPosts} 条作品聚合（近 120 天，${tzLabel} 时区）`;
  return { bestDays, bestHours, insight };
}

router.get("/market-data/best-times", async (req, res): Promise<void> => {
  // 未登录也能看：直接返回常量 fallback（保留向后兼容）
  const user = await ensureUser(req).catch(() => null);
  // 显式 ?tz= 优先；否则按 user.region 推；都没有兜底 SGT
  const queryTz = typeof req.query.tz === "string" ? req.query.tz : "";
  const userTz = user?.region ? (REGION_TZ[user.region.toUpperCase()] ?? "") : "";
  const tz = ALLOWED_TZ.has(queryTz) ? queryTz : (userTz || "Asia/Singapore");
  const out: Record<string, { bestDays: string[]; bestHours: number[]; insight: string; source: "real" | "fallback" | "mock" }> = {};
  for (const platform of ["xhs", "tiktok", "instagram", "facebook"] as const) {
    if (!user) {
      out[platform] = { ...BEST_TIMES_FALLBACK[platform], source: "mock" };
      continue;
    }
    try {
      const real = await aggregatePerPlatform(user.id, platform, tz);
      if (real) {
        out[platform] = { ...real, source: "real" };
      } else {
        out[platform] = { ...BEST_TIMES_FALLBACK[platform], source: "fallback" };
      }
    } catch (e: any) {
      logger.warn({ err: e?.message, platform, userId: user.id, tz }, "best-times aggregate failed, using fallback");
      out[platform] = { ...BEST_TIMES_FALLBACK[platform], source: "fallback" };
    }
  }
  res.json(out);
});

function getMockTrending(platform: string, keyword: string) {
  return Array.from({ length: 6 }, (_, i) => ({
    id: `mock_${platform}_${i}`, platform,
    title: `${keyword} 热门示例 ${i + 1}（mock，配置 API key 后显示真实数据）`,
    description: "示例内容",
    thumbnailUrl: `https://picsum.photos/seed/${platform}${keyword}${i}/300/400`,
    likes: 50000 + i * 12000, views: 500000 + i * 80000, comments: 1200 + i * 200, shares: 800,
    hashtags: [`#${keyword}`, "#viral", "#mock"], duration: 30,
  }));
}

function getMockAds(keyword: string) {
  return [
    { id: "ad_001", advertiserName: `${keyword} Studio`, caption: `🌟 ${keyword} 服务首单 8 折，今日预约即享！`, mediaUrl: "https://picsum.photos/seed/ad1/400/300", startDate: "2026-04-15", platforms: ["facebook", "instagram"] },
    { id: "ad_002", advertiserName: `Premium ${keyword}`, caption: `✨ 新店开业，${keyword} 体验装免费送！`, mediaUrl: "https://picsum.photos/seed/ad2/400/300", startDate: "2026-04-10", platforms: ["facebook"] },
    { id: "ad_003", advertiserName: `${keyword} 馆`, caption: `💅 专业 ${keyword}，平价享受。立即拨打预约`, mediaUrl: "https://picsum.photos/seed/ad3/400/300", startDate: "2026-04-25", platforms: ["facebook", "instagram"] },
  ];
}

export default router;
