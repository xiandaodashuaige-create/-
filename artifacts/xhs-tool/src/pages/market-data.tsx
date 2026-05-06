import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePlatform } from "@/lib/platform-context";
import { PLATFORMS, PLATFORM_LIST, type PlatformId } from "@/lib/platform-meta";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BarChart3, TrendingUp, Megaphone, Clock, Loader2, Heart, Eye, MessageCircle, Info, ArrowRight } from "lucide-react";
import { useLocation } from "wouter";
import { setReturnToFlow } from "@/lib/return-to-flow";
import { proxyXhsImage } from "@/lib/image-proxy";

function formatCount(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// 数据可信度三档徽标：绿=真实抓取 / 黄=回退到行业经验值 / 灰=未配置只能 mock
function SourceBadge({ source }: { source?: string }) {
  if (!source) return null;
  const s = String(source);
  // 真实数据：tikhub / graph / real / xhs / competitor_posts → 绿
  // ⚠️ 之前漏写 "xhs" 和 "competitor_posts"，导致 XHS 真实搜索结果 + FB/IG 同行库聚合都被错标成"示例数据"
  if (s === "real" || s === "tikhub" || s === "graph" || s === "xhs" || s === "competitor_posts") {
    return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300 hover:bg-emerald-100" title="真实抓取数据">● 真实数据</Badge>;
  }
  // 回退：fallback / cached → 黄
  if (s === "fallback" || s === "cached") {
    return <Badge className="bg-amber-100 text-amber-700 border-amber-300 hover:bg-amber-100" title="样本不足或 API 暂不可用，已回退到经验值">◐ 经验回退</Badge>;
  }
  // mock / 其他 → 灰
  return <Badge variant="outline" className="text-muted-foreground" title="未配置数据源，使用示例数据">○ 示例数据</Badge>;
}

export default function MarketDataPage() {
  const { activePlatform } = usePlatform();
  const [keyword, setKeyword] = useState("beauty");
  const [region, setRegion] = useState("MY");
  const [, setLocation] = useLocation();

  const trendingQ = useQuery({
    queryKey: ["market-trending", activePlatform, keyword, region],
    queryFn: () => api.marketData.trending(activePlatform, keyword, region),
  });

  const adsQ = useQuery({
    queryKey: ["market-ads", keyword, region],
    queryFn: () => api.marketData.ads(keyword, region),
  });

  const bestTimesQ = useQuery({
    queryKey: ["market-besttimes"],
    queryFn: () => api.marketData.bestTimes(),
    staleTime: 60_000 * 30,
  });

  const platformMeta = PLATFORMS[activePlatform as PlatformId];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">市场数据</h1>
          <p className="text-sm text-muted-foreground">查看 {platformMeta.name} 当前热门内容、Meta 广告库、最佳发布时间</p>
        </div>
      </div>

      <Card className="p-4 flex flex-wrap items-center gap-2">
        <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="关键词" className="flex-1 min-w-48" />
        <Input value={region} onChange={(e) => setRegion(e.target.value.toUpperCase())} placeholder="地区代码 MY/CN/US" className="w-40" />
        <Button onClick={() => { trendingQ.refetch(); adsQ.refetch(); }}>
          搜索
        </Button>
      </Card>

      <Tabs defaultValue="trending">
        <TabsList>
          <TabsTrigger value="trending"><TrendingUp className="h-4 w-4 mr-1" />热门内容</TabsTrigger>
          <TabsTrigger value="ads"><Megaphone className="h-4 w-4 mr-1" />广告库</TabsTrigger>
          <TabsTrigger value="times"><Clock className="h-4 w-4 mr-1" />最佳时间</TabsTrigger>
        </TabsList>

        <TabsContent value="trending" className="mt-4">
          {trendingQ.isLoading ? (
            <div className="py-12 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
                数据源: <SourceBadge source={trendingQ.data?.source} />
              </div>
              {trendingQ.data?.source === "mock" && (
                <Card className="p-3 mb-3 border-amber-300 bg-amber-50/60 flex items-start gap-3">
                  <Info className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-sm flex-1">
                    <div className="font-medium text-amber-900">当前显示示例数据</div>
                    <div className="text-xs text-amber-800/80 mt-0.5">
                      {activePlatform === "tiktok"
                        ? "TikTok 真实热门数据需要 TikHub API key（已可用）。如仍是示例数据，可能因为关键词无结果或地区不支持，换一组试试。"
                        : `${platformMeta.name} 当前没有官方公开热门接口，建议在「同行库」追踪 5–10 个目标账号，AI 会基于他们的历史爆款给你更准的策略。`}
                    </div>
                    {activePlatform !== "tiktok" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 h-7 text-xs"
                        onClick={() => { setLocation("/competitors"); }}
                      >
                        去同行库追踪 <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    )}
                  </div>
                </Card>
              )}
              {/* 真实数据源但 0 条结果：明确告诉用户为什么空，避免"点搜索没反应"的错觉 */}
              {trendingQ.data && trendingQ.data.source !== "mock" && (trendingQ.data.items?.length ?? 0) === 0 && (
                <Card className="p-6 mb-3 border-dashed text-center space-y-2">
                  <Info className="h-8 w-8 text-muted-foreground/60 mx-auto" />
                  <div className="font-medium">「{keyword}」在 {region} 区暂无 {platformMeta.shortName} 真实数据</div>
                  <div className="text-xs text-muted-foreground max-w-md mx-auto">
                    数据源已连通(显示"真实数据"徽标),但当前关键词在该地区返回 0 条结果。
                    建议:换更通用的关键词(如 "skincare" / "护肤" / "makeup"),或切换地区(US / SG / GLOBAL),或换平台 tab 试试。
                  </div>
                  <div className="flex gap-2 justify-center pt-1">
                    {["skincare", "fashion", "fitness", "food"].map((kw) => (
                      <Button
                        key={kw}
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => setKeyword(kw)}
                      >
                        {kw}
                      </Button>
                    ))}
                  </div>
                </Card>
              )}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                {(trendingQ.data?.items ?? []).map((it: any) => (
                  <a key={it.id} href={it.mediaUrl || "#"} target="_blank" rel="noreferrer" className="block group">
                    <img
                      src={proxyXhsImage(it.thumbnailUrl) || it.thumbnailUrl}
                      alt=""
                      className="w-full aspect-[3/4] object-cover rounded border bg-muted"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        const img = e.currentTarget;
                        if (img.dataset.fallback === "1") return;
                        img.dataset.fallback = "1";
                        img.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 160'><rect width='120' height='160' fill='%23f1f5f9'/><text x='60' y='85' text-anchor='middle' fill='%2394a3b8' font-size='12' font-family='sans-serif'>无封面</text></svg>";
                      }}
                    />
                    <div className="mt-1.5 text-xs line-clamp-2 group-hover:text-primary">{it.title}</div>
                    <div className="flex gap-1.5 mt-1 text-[10px] text-muted-foreground">
                      <span className="inline-flex items-center gap-0.5"><Eye className="h-3 w-3" />{formatCount(it.views)}</span>
                      <span className="inline-flex items-center gap-0.5"><Heart className="h-3 w-3" />{formatCount(it.likes)}</span>
                      <span className="inline-flex items-center gap-0.5"><MessageCircle className="h-3 w-3" />{formatCount(it.comments)}</span>
                    </div>
                  </a>
                ))}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="ads" className="mt-4">
          {adsQ.isLoading ? (
            <div className="py-12 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
                数据源: <SourceBadge source={adsQ.data?.source} />
              </div>
              {!adsQ.data?.configured && (
                <Card className="p-3 mb-3 border-amber-300 bg-amber-50/60 flex items-start gap-3">
                  <Info className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-sm flex-1">
                    <div className="font-medium text-amber-900">Meta 广告库未连接 — 当前为示例数据</div>
                    <div className="text-xs text-amber-800/80 mt-0.5">
                      授权一个 Facebook 主页后，系统会自动用你的访问令牌拉取 Meta 公开广告库（无需额外 API key）。
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 h-7 text-xs"
                      onClick={() => {
                        setReturnToFlow("/market-data");
                        setLocation("/accounts");
                      }}
                    >
                      去授权 Facebook → <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </div>
                </Card>
              )}
              {/* Meta 广告库已连通但 0 条:同样给空状态提示,避免误以为按钮坏了 */}
              {adsQ.data?.configured && (adsQ.data.items?.length ?? 0) === 0 && (
                <Card className="p-6 mb-3 border-dashed text-center space-y-2">
                  <Info className="h-8 w-8 text-muted-foreground/60 mx-auto" />
                  <div className="font-medium">「{keyword}」在 {region} 区 Meta 广告库无投放记录</div>
                  <div className="text-xs text-muted-foreground max-w-md mx-auto">
                    Meta 广告库已连通,但该关键词在该地区当前无活跃广告。换关键词或地区试试。
                  </div>
                </Card>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {(adsQ.data?.items ?? []).map((ad: any) => (
                  <Card key={ad.id} className="p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-medium text-sm">{ad.advertiserName}</div>
                      <div className="flex gap-1">
                        {(ad.platforms ?? []).map((p: string) => (
                          <Badge key={p} variant="outline" className="text-[10px]">{p}</Badge>
                        ))}
                      </div>
                    </div>
                    {ad.mediaUrl && (
                      <img
                        src={proxyXhsImage(ad.mediaUrl) || ad.mediaUrl}
                        alt=""
                        className="w-full h-32 object-cover rounded mb-2 bg-muted"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          const img = e.currentTarget;
                          if (img.dataset.fallback === "1") { img.style.display = "none"; return; }
                          img.dataset.fallback = "1";
                          img.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 128'><rect width='320' height='128' fill='%23f1f5f9'/><text x='160' y='68' text-anchor='middle' fill='%2394a3b8' font-size='12' font-family='sans-serif'>素材加载失败</text></svg>";
                        }}
                      />
                    )}
                    <div className="text-xs line-clamp-3 text-muted-foreground">{ad.caption}</div>
                    <div className="text-[10px] text-muted-foreground mt-2">投放开始: {ad.startDate}</div>
                  </Card>
                ))}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="times" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {PLATFORM_LIST.map((p) => {
              const data = bestTimesQ.data?.[p.id];
              if (!data) return null;
              return (
                <Card key={p.id} className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <p.icon className={`h-5 w-5 ${p.textClass}`} />
                    <h3 className="font-semibold">{p.name}</h3>
                    <SourceBadge source={data.source} />
                  </div>
                  <div className="space-y-2 text-sm">
                    <div><strong>最佳日期:</strong> <span className="text-muted-foreground">{data.bestDays.join(", ")}</span></div>
                    <div><strong>最佳时段:</strong> <span className="text-muted-foreground">{data.bestHours.map((h: number) => `${h}:00`).join(", ")}</span></div>
                    <div className="text-xs italic text-muted-foreground border-l-2 pl-2 mt-2">{data.insight}</div>
                  </div>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
