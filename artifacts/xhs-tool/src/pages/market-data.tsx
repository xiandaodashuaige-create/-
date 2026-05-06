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

function formatCount(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
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
                数据源: <Badge variant="outline">{trendingQ.data?.source}</Badge>
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
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                {(trendingQ.data?.items ?? []).map((it: any) => (
                  <a key={it.id} href={it.mediaUrl || "#"} target="_blank" rel="noreferrer" className="block group">
                    <img src={it.thumbnailUrl} alt="" className="w-full aspect-[3/4] object-cover rounded border" loading="lazy" />
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
                数据源: <Badge variant="outline">{adsQ.data?.source}</Badge>
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
                    {ad.mediaUrl && <img src={ad.mediaUrl} alt="" className="w-full h-32 object-cover rounded mb-2" />}
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
