import { db, contentTable, accountsTable, userContentProfilesTable } from "@workspace/db";
import type { UserContentProfile } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const MAX_SAMPLES = 50;

function topN(items: string[], n: number): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  const repr = new Map<string, string>();
  for (const item of items) {
    if (typeof item !== "string") continue;
    const key = item.toLowerCase().trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
    if (!repr.has(key)) repr.set(key, item.trim());
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, c]) => ({ value: repr.get(k)!, count: c }))
    .filter((x) => x.value);
}

// 启发式提取标题公式
function detectTitlePattern(title: string): string | null {
  if (!title) return null;
  const t = title.trim();
  if (/^[\d¥$￥]/.test(t) || /^\d+[岁天周月年个]/.test(t)) return "数字开头";
  if (/[?？！!]$/.test(t)) return "提问/感叹结尾";
  if (/(别|千万别|不要|绝不|后悔|踩雷|避坑)/.test(t)) return "警告/避坑型";
  if (/(对比|测评|VS|vs|横评)/.test(t)) return "对比测评型";
  if (/(攻略|清单|大全|合集|盘点|tips|Tips|TIPS)/.test(t)) return "干货清单型";
  if (/(亲测|实测|真实|记录|日记|分享)/.test(t)) return "真实体验型";
  if (/(反常识|没想到|惊呆|颠覆|原来)/.test(t)) return "反常识型";
  return "陈述型";
}

// 提取所有 emoji
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu;
function extractEmojis(text: string): string[] {
  if (!text) return [];
  return text.match(EMOJI_RE) || [];
}

// 提取每篇正文的开头第一句（前 30 字）
function extractOpening(body: string): string | null {
  if (!body) return null;
  const cleaned = body.replace(EMOJI_RE, "").trim();
  const firstLine = cleaned.split(/[\n。！？!?]/)[0];
  if (!firstLine || firstLine.length < 4) return null;
  return firstLine.slice(0, 30);
}

/**
 * 重新计算并持久化指定用户的"内容风格画像"
 * 数据源：该用户保存过的 content（非草稿优先，否则全量）
 */
export async function recomputeUserContentProfile(userId: number): Promise<void> {
  // 多租户隔离：只统计本用户名下 account 关联的 content。
  // accounts.owner_user_id IS NULL 的旧账号（迁移前数据）一律不参与画像，避免跨用户污染。
  const rows = await db.execute(sql`
    SELECT c.title, c.body, c.tags, c.image_urls, c.status, a.region
    FROM content c
    INNER JOIN accounts a ON c.account_id = a.id
    WHERE a.owner_user_id = ${userId}
    ORDER BY c.created_at DESC
    LIMIT ${MAX_SAMPLES}
  `);

  const samples = rows.rows as Array<{
    title: string;
    body: string;
    tags: string[];
    image_urls: string[];
    status: string;
    region: string | null;
  }>;

  if (samples.length === 0) {
    await db
      .insert(userContentProfilesTable)
      .values({ userId, sampleSize: 0 })
      .onConflictDoUpdate({
        target: userContentProfilesTable.userId,
        set: { sampleSize: 0 },
      });
    return;
  }

  const allTags: string[] = [];
  const allTitlePatterns: string[] = [];
  const allOpenings: string[] = [];
  const allEmojis: string[] = [];
  const allRegions: string[] = [];
  let totalBodyLen = 0;
  let totalTagCount = 0;

  for (const s of samples) {
    if (Array.isArray(s.tags)) {
      for (const t of s.tags) allTags.push(String(t).replace(/^#/, ""));
      totalTagCount += s.tags.length;
    }
    const tp = detectTitlePattern(s.title);
    if (tp) allTitlePatterns.push(tp);
    const op = extractOpening(s.body);
    if (op) allOpenings.push(op);
    allEmojis.push(...extractEmojis(s.title || ""));
    allEmojis.push(...extractEmojis(s.body || ""));
    if (s.region) allRegions.push(s.region);
    totalBodyLen += (s.body || "").length;
  }

  const profile = {
    userId,
    favoriteTags: topN(allTags, 20),
    preferredTitlePatterns: topN(allTitlePatterns, 5),
    preferredOpenings: topN(allOpenings, 8),
    preferredEmojis: topN(allEmojis, 10),
    avoidedPhrases: [], // 预留：未来用 AI diff 用户改稿来填充
    preferredRegions: topN(allRegions, 3),
    avgBodyLength: Math.round(totalBodyLen / samples.length),
    avgTagCount: Math.round(totalTagCount / samples.length),
    sampleSize: samples.length,
  };

  await db
    .insert(userContentProfilesTable)
    .values(profile)
    .onConflictDoUpdate({
      target: userContentProfilesTable.userId,
      set: {
        favoriteTags: profile.favoriteTags,
        preferredTitlePatterns: profile.preferredTitlePatterns,
        preferredOpenings: profile.preferredOpenings,
        preferredEmojis: profile.preferredEmojis,
        avoidedPhrases: profile.avoidedPhrases,
        preferredRegions: profile.preferredRegions,
        avgBodyLength: profile.avgBodyLength,
        avgTagCount: profile.avgTagCount,
        sampleSize: profile.sampleSize,
      },
    });
}

/** Fire-and-forget — 给路由 handler 用，永远不抛错 */
export function triggerContentProfileRecompute(userId: number | null | undefined): void {
  if (!userId) return;
  recomputeUserContentProfile(userId).catch((err) => {
    logger.warn({ err: err?.message, userId }, "recomputeUserContentProfile failed (non-fatal)");
  });
}

export async function loadUserContentProfile(userId: number): Promise<UserContentProfile | null> {
  const rows = await db
    .select()
    .from(userContentProfilesTable)
    .where(eq(userContentProfilesTable.userId, userId))
    .limit(1);
  return rows[0] || null;
}

/**
 * 把画像渲染成可注入 prompt 的中文片段。
 * 当 sampleSize < 3 时返回空字符串（样本太少，不喂噪音给 AI）。
 */
export function renderContentProfileForPrompt(p: UserContentProfile | null): string {
  if (!p || p.sampleSize < 3) return "";

  const fmtCount = (arr: any[]) =>
    arr.slice(0, 8).map((x: any) => `${x.value}(${x.count}次)`).join("、") || "（无）";

  const favTags = (p.favoriteTags as Array<{ value: string; count: number }>) || [];
  const titlePatterns = (p.preferredTitlePatterns as Array<{ value: string; count: number }>) || [];
  const openings = (p.preferredOpenings as Array<{ value: string; count: number }>) || [];
  const emojis = (p.preferredEmojis as Array<{ value: string; count: number }>) || [];

  const topTagsForPrompt = favTags.slice(0, 10).map((t) => `#${t.value}`).join(" ");
  const topEmojisForPrompt = emojis.slice(0, 6).map((e) => e.value).join("");

  return `

🧬【该客户的历史风格画像】（基于过去 ${p.sampleSize} 篇笔记自动学习，**生成方案时务必延续这些个人偏好，让客户感觉"AI 越来越懂我"**）

- 客户惯用标题公式：${fmtCount(titlePatterns)} —— 至少 1 套方案沿用最常用的那种
- 客户常用开头风格示例（直接摘自历史笔记）：
${openings.slice(0, 4).map((o, i) => `   ${i + 1}. "${o.value}…"`).join("\n") || "   （样本不足）"}
- 客户高频标签（**生成 tags 时优先沿用，与爆款标签池取交集最佳**）：${topTagsForPrompt || "（无）"}
- 客户偏爱的 emoji：${topEmojisForPrompt || "（无）"}  —— body 里 emoji 选用风格请向这些靠拢
- 客户笔记平均字数：${p.avgBodyLength} 字 —— 新方案 body 字数控制在 ${Math.max(300, p.avgBodyLength - 100)}-${p.avgBodyLength + 150} 字之间
- 客户平均每篇标签数：${p.avgTagCount} 个 —— 不要严重偏离

⚠️ 注意：上面的"个人偏好"必须和"爆款规律"融合，**不是盖过爆款规律**。优先级：爆款规律 > 个人偏好 > 通用建议。`;
}
