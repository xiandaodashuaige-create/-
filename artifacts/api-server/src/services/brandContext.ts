import { db, brandProfilesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

/**
 * 品牌画像公共加载器 — 把 brand_profiles 的 (category/products/audience/priceRange/tone/
 * forbiddenClaims/conversionGoal) 拼成 prompt 片段,供所有 AI 端点统一注入。
 *
 * 设计原则:
 *   - 失败/空配置返回 `{ promptBlock: "", forbiddenClaims: [], brand: null }` —— 永不阻断主流程
 *   - promptBlock 1500 字截断,防超长品牌资料挤掉 prompt 主体或被模型当指令
 *   - forbiddenClaims 同时单独返回,方便调用方做"绝对禁止"二次提醒
 *   - 与 strategyGenerator.buildBrandProfileBlock / generate-weekly-plan 内联实现保持完全一致
 */
export type BrandContext = {
  promptBlock: string;
  forbiddenClaims: string[];
  brand: {
    category: string | null;
    products: string | null;
    targetAudience: string | null;
    priceRange: string | null;
    tone: string | null;
    conversionGoal: string | null;
  } | null;
};

const EMPTY: BrandContext = { promptBlock: "", forbiddenClaims: [], brand: null };

export async function loadBrandContext(
  userId: number,
  platform: string | null | undefined,
): Promise<BrandContext> {
  if (!userId || !platform) return EMPTY;
  try {
    const [brand] = await db
      .select()
      .from(brandProfilesTable)
      .where(and(
        eq(brandProfilesTable.ownerUserId, userId),
        eq(brandProfilesTable.platform, platform),
      ));
    if (!brand) return EMPTY;

    const lines: string[] = [];
    if (brand.category) lines.push(`类目：${brand.category}`);
    if (brand.products) lines.push(`商品：${brand.products}`);
    if (brand.targetAudience) lines.push(`目标受众：${brand.targetAudience}`);
    if (brand.priceRange) lines.push(`价位带：${brand.priceRange}`);
    if (brand.tone) lines.push(`品牌调性：${brand.tone}`);
    if (brand.conversionGoal) lines.push(`转化目标：${brand.conversionGoal}`);
    const forbidden = Array.isArray(brand.forbiddenClaims)
      ? brand.forbiddenClaims.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : [];
    if (forbidden.length > 0) {
      lines.push(`【禁用宣称】（绝对不能出现，包括同义词/暗示/反问）：${forbidden.join("、")}`);
    }

    if (lines.length === 0) return EMPTY;

    const body = lines.join("\n").slice(0, 1500);
    const promptBlock = `\n\n[品牌画像 — 必须严格遵守]\n${body}`;
    return {
      promptBlock,
      forbiddenClaims: forbidden,
      brand: {
        category: brand.category,
        products: brand.products,
        targetAudience: brand.targetAudience,
        priceRange: brand.priceRange,
        tone: brand.tone,
        conversionGoal: brand.conversionGoal,
      },
    };
  } catch {
    return EMPTY;
  }
}

/**
 * 输出后置校验:扫描 LLM 返回的文本是否命中 forbiddenClaims(中文不区分大小写,半角全角等价对待)。
 *
 * - 之所以做这道:`forbiddenClaims` 在 prompt 里只是 "软" 约束,模型仍可能引用"避开它"反而把禁词写进结果(architect Medium)
 * - 命中后由调用方决定:返回里附 `{ flagged: true, terms: [...] }` 让前端红字标记 / 后台埋点 / 让用户手改
 * - **不阻断、不重写**(避免烧重试积分 + 增加延迟),只标记 — 真要阻断由前端弹窗确认
 * - 性能:O(n × m) 简单 includes,n=输出长度 m=禁词数,实测 ms 级
 */
// NFKC 归一化:把全角 ABC123、半角混排、各种相容字符统一,防"全角A"绕过"半角A"
// 例:"最Ｗ效果" .normalize("NFKC") → "最W效果",再 lower → "最w效果",
// 命中 forbidden "最W效果" 也能 hit (architect Medium #3)
function norm(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

export function checkForbidden(text: string | null | undefined, claims: string[]): { hit: string[] } {
  if (!text || claims.length === 0) return { hit: [] };
  const normalized = norm(text);
  const hit: string[] = [];
  for (const raw of claims) {
    const c = raw.trim();
    if (!c || c.length < 2) continue; // 忽略 1 字符防误命中"的/了/吗"等高频字
    if (normalized.includes(norm(c))) {
      hit.push(c);
    }
  }
  return { hit };
}

/**
 * 把多段文本一次性扫描(数组/字符串混合),用于 textOverlay/subtitleSegments 这种数组结构。
 * 返回去重后的命中列表。
 */
export function checkForbiddenMany(texts: Array<string | null | undefined>, claims: string[]): { hit: string[] } {
  if (claims.length === 0) return { hit: [] };
  const set = new Set<string>();
  for (const t of texts) {
    for (const h of checkForbidden(t, claims).hit) set.add(h);
  }
  return { hit: Array.from(set) };
}

/**
 * 给 generate-image 基础版用的轻量 styleHint —— 根据 tone/priceRange 替换硬编码的
 * "小红书爆款封面/温暖治愈"。其他端点用 promptBlock 即可,不要重复用这个。
 */
export function brandStyleHint(brand: BrandContext["brand"]): string {
  if (!brand) return "";
  const bits: string[] = [];
  if (brand.tone) bits.push(`整体调性贴合：${brand.tone}`);
  if (brand.priceRange) bits.push(`体现价位感：${brand.priceRange}`);
  if (brand.targetAudience) bits.push(`目标受众视觉偏好：${brand.targetAudience}`);
  return bits.length > 0 ? `\n【品牌视觉要求】${bits.join("；")}` : "";
}
