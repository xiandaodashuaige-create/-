import { Mint } from "mint-filter";
import politicalText from "../data/sensitive-words/political.txt";
import pornText from "../data/sensitive-words/porn.txt";
import generalText from "../data/sensitive-words/general.txt";

// 广告法违禁词（极限词、医疗夸大、虚假承诺）—— 内置常用 100+，
// 用户可在 sensitive_words 表里补充自定义
const AD_LAW_WORDS = [
  "最佳", "最好", "最大", "最小", "最高", "最低", "最优", "最先进",
  "最便宜", "最贵", "最便利", "最舒适", "最强", "最快", "最新", "第一",
  "唯一", "顶级", "顶尖", "极致", "完美", "万能", "神效", "奇迹",
  "国家级", "世界级", "宇宙级", "全球级", "百分百", "100%", "纯天然",
  "全天然", "无副作用", "包治百病", "根治", "治愈", "药到病除", "彻底治愈",
  "限时抢购", "限时秒杀", "今日特价", "首发", "首选", "驰名", "殿堂级",
  "永久", "永远", "祖传", "秘方", "权威", "王牌", "老字号", "正宗",
  "抢爆", "抢购", "马上抢", "立即拥有", "前无古人", "史无前例", "空前绝后",
  "绝无仅有", "独一无二", "天下第一", "举世无双", "万里挑一", "无人能及",
  "无与伦比", "盖世无双", "登峰造极", "出神入化", "绝对", "肯定", "保证",
  "100%有效", "包赚", "稳赚", "零风险", "投资无风险", "暴利", "一夜暴富",
  "月入过万", "日赚千元", "躺赚", "免费", "免单", "送", "白拿",
  "零成本", "零门槛", "无需本金",
];

// 词库格式不统一（cjh0613 词库每行带尾逗号 `习近平,`），需要剥掉尾部标点
// 否则 Mint 严格按整词匹配会漏检（`Mint(['习近平,']).filter('习近平')` 不命中）
function loadList(text: string): string[] {
  const set = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const w = raw.replace(/[,，;；、\s]+$/g, "").trim();
    if (!w || w.startsWith("#")) continue;
    set.add(w);
  }
  return Array.from(set);
}

type Cat = "political" | "porn" | "general" | "adsLaw";

const CATEGORY_META: Record<Cat, { label: string; severity: "low" | "medium" | "high"; reason: string }> = {
  political: { label: "涉政", severity: "high", reason: "涉及政治敏感词，平台高风险违禁" },
  porn:      { label: "涉黄", severity: "high", reason: "涉黄词，平台严打" },
  general:   { label: "违禁", severity: "medium", reason: "公开维护违禁词库命中" },
  adsLaw:    { label: "广告法", severity: "high", reason: "违反《广告法》极限用语 / 虚假承诺" },
};

const FILTERS: Record<Cat, Mint> = {
  political: new Mint(loadList(politicalText)),
  porn:      new Mint(loadList(pornText)),
  general:   new Mint(loadList(generalText)),
  adsLaw:    new Mint(AD_LAW_WORDS),
};

export type LocalHit = {
  word: string;
  category: Cat;
  categoryLabel: string;
  reason: string;
  severity: "low" | "medium" | "high";
  suggestion: string;
};

export type LocalScanResult = {
  hits: LocalHit[];
  hasHighSeverity: boolean;
  score: number; // 0-100
};

const SUGGESTIONS: Record<Cat, string> = {
  political: "请删除该词或换成中性表达",
  porn:      "请删除或换成隐晦表达",
  general:   "建议替换为更安全的同义词",
  adsLaw:    "改为相对表达，如「优秀/口碑好/受欢迎」",
};

export type CustomWordRow = { word: string; severity?: "low" | "medium" | "high" | null; category?: string | null };

/** 本地 DFA 扫描——毫秒级，无网络、不扣积分 */
export function localScan(text: string, customWords: CustomWordRow[] = []): LocalScanResult {
  const hits: LocalHit[] = [];
  const seen = new Set<string>();

  for (const cat of Object.keys(FILTERS) as Cat[]) {
    const r = FILTERS[cat].filter(text);
    if (r.words?.length) {
      for (const w of r.words) {
        const key = `${w}|${cat}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const meta = CATEGORY_META[cat];
        hits.push({
          word: w,
          category: cat,
          categoryLabel: meta.label,
          reason: meta.reason,
          severity: meta.severity,
          suggestion: SUGGESTIONS[cat],
        });
      }
    }
  }

  // 用户自定义词（来自 sensitive_words 表）—— 保留每条的真实 severity
  if (customWords.length) {
    const wordToRow = new Map(customWords.map((c) => [c.word, c]));
    const userFilter = new Mint(customWords.map((c) => c.word));
    const r = userFilter.filter(text);
    if (r.words?.length) {
      for (const w of r.words) {
        const key = `${w}|custom`;
        if (seen.has(key)) continue;
        seen.add(key);
        const row = wordToRow.get(w);
        const sev = (row?.severity as "low" | "medium" | "high" | undefined) ?? "medium";
        hits.push({
          word: w,
          category: "general",
          categoryLabel: row?.category ? `自定义·${row.category}` : "自定义",
          reason: "命中你的自定义敏感词库",
          severity: sev,
          suggestion: "建议替换或删除",
        });
      }
    }
  }

  const hasHigh = hits.some((h) => h.severity === "high");
  const hasMed = hits.some((h) => h.severity === "medium");
  const score = hasHigh ? 90 : hasMed ? 60 : hits.length ? 40 : 0;

  return { hits, hasHighSeverity: hasHigh, score };
}
