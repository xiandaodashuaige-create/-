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
