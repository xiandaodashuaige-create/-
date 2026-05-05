import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import { fetchTrendingHashtagVideos, isTikHubConfigured } from "../services/tikhubScraper";

// 市场数据探索：跨平台热门内容、广告库、最佳发布时间
const router: IRouter = Router();

// ── GET /api/market-data/trending?platform=tiktok&keyword=美容&region=MY ──
router.get("/market-data/trending", async (req, res): Promise<void> => {
  const platform = (req.query.platform as string) || "tiktok";
  const keyword = ((req.query.keyword as string) || "beauty").trim();
  const region = ((req.query.region as string) || "MY").trim();

  if (platform === "tiktok") {
    if (!isTikHubConfigured()) { res.json({ platform, source: "mock", items: getMockTrending(platform, keyword) }); return; }
    const videos = await fetchTrendingHashtagVideos(keyword, region, 20);
    res.json({
      platform, keyword, region, source: "tikhub",
      items: videos.map(v => ({
        id: v.externalId, platform: "tiktok",
        title: v.description, description: v.description,
        thumbnailUrl: v.coverUrl, mediaUrl: v.videoUrl,
        likes: v.likeCount, views: v.viewCount, comments: v.commentCount, shares: v.shareCount,
        hashtags: v.hashtags, duration: v.duration,
        musicName: v.musicName,
      })),
    });
    return;
  }
  // FB/IG/XHS 走 mock（XHS 在 workflow 内有专门的 RapidAPI 抓取）
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
router.get("/market-data/best-times", async (_req, res): Promise<void> => {
  res.json({
    xhs: { bestDays: ["Wednesday", "Friday", "Saturday", "Sunday"], bestHours: [12, 19, 22], insight: "20:00-22:00 流量峰值，周末白天表现更稳" },
    tiktok: { bestDays: ["Tuesday", "Thursday", "Friday"], bestHours: [19, 20, 21], insight: "晚间 19-21 完播率高 2 倍" },
    instagram: { bestDays: ["Monday", "Tuesday", "Wednesday", "Friday"], bestHours: [6, 12, 19], insight: "Reels 在 6am 或 7pm 表现 +23%" },
    facebook: { bestDays: ["Tuesday", "Wednesday", "Thursday"], bestHours: [9, 13, 15], insight: "工作日下午 1-3 点互动 +18%" },
  });
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
