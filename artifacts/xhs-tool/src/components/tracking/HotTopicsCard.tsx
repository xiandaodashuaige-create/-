import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Flame, Search } from "lucide-react";

const PRESETS = ["美食", "穿搭", "旅行", "护肤", "母婴", "健身"];

export default function HotTopicsCard() {
  const [niche, setNiche] = useState("美食");
  const [region, setRegion] = useState("ALL");
  const [active, setActive] = useState({ niche: "美食", region: "ALL" });

  const { data, isLoading } = useQuery({
    queryKey: ["hot-topics", active.niche, active.region],
    queryFn: () => api.tracking.hotTopics(active.niche, active.region),
    staleTime: 6 * 60 * 60 * 1000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Flame className="h-5 w-5 text-orange-500" />
          热点话题日历
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => { setNiche(p); setActive({ niche: p, region }); }}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${active.niche === p ? "bg-orange-500 text-white border-orange-500" : "border-border hover:border-orange-300"}`}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <Input
            placeholder="自定义赛道..."
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            className="text-sm"
          />
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="text-sm border rounded px-2 bg-white"
          >
            <option value="ALL">全部</option>
            <option value="SG">新加坡</option>
            <option value="HK">香港</option>
            <option value="MY">马来西亚</option>
          </select>
          <Button size="sm" onClick={() => setActive({ niche: niche.trim() || "美食", region })}>
            <Search className="h-3.5 w-3.5" />
          </Button>
        </div>

        {isLoading && <p className="text-xs text-muted-foreground py-4">加载中…</p>}
        {data && data.topics.length === 0 && (
          <p className="text-xs text-muted-foreground py-4">暂无热点（试试换个赛道）</p>
        )}
        <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
          {data?.topics.map((t: any, i: number) => (
            <a
              key={t.tag}
              href={t.sampleNoteId ? `https://www.xiaohongshu.com/explore/${t.sampleNoteId}` : "#"}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 p-2 rounded hover:bg-orange-50 transition-colors block"
            >
              <span className="text-xs font-bold text-orange-500 w-5">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">#{t.tag}</div>
                {t.sampleTitle && <div className="text-xs text-muted-foreground truncate">{t.sampleTitle}</div>}
              </div>
              <Badge variant="outline" className="text-[10px] shrink-0">出现 {t.count} 次</Badge>
            </a>
          ))}
        </div>
        {data && (
          <p className="text-[10px] text-muted-foreground text-center">
            分析了 {data.samplesAnalyzed} 篇笔记 · {data.cached ? "今日已缓存" : "刚刚刷新"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
