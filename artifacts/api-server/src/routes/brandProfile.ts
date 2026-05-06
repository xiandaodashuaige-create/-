import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { z } from "zod/v4";
import { db, brandProfilesTable } from "@workspace/db";
import { ensureUser } from "../middlewares/creditSystem";

const router: IRouter = Router();

const PLATFORMS = ["xhs", "tiktok", "instagram", "facebook"] as const;
type Platform = (typeof PLATFORMS)[number];
function isPlatform(x: unknown): x is Platform {
  return typeof x === "string" && (PLATFORMS as readonly string[]).includes(x);
}

const upsertSchema = z.object({
  platform: z.enum(PLATFORMS),
  category: z.string().max(100).nullable().optional(),
  products: z.string().max(2000).nullable().optional(),
  targetAudience: z.string().max(500).nullable().optional(),
  priceRange: z.string().max(100).nullable().optional(),
  tone: z.string().max(200).nullable().optional(),
  forbiddenClaims: z.array(z.string().max(100)).max(50).optional(),
  conversionGoal: z.string().max(200).nullable().optional(),
  region: z.string().max(20).nullable().optional(),
  language: z.string().max(20).nullable().optional(),
  extras: z.record(z.string(), z.unknown()).optional(),
});

// GET /api/brand-profile?platform=xhs → 单条；不传 platform 返回当前用户全部
router.get("/brand-profile", async (req, res): Promise<void> => {
  const user = await ensureUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const platform = req.query.platform;
  if (typeof platform === "string") {
    if (!isPlatform(platform)) { res.status(400).json({ error: "invalid platform" }); return; }
    const [row] = await db
      .select()
      .from(brandProfilesTable)
      .where(and(eq(brandProfilesTable.ownerUserId, user.id), eq(brandProfilesTable.platform, platform)));
    res.json(row ?? null);
    return;
  }
  const rows = await db.select().from(brandProfilesTable).where(eq(brandProfilesTable.ownerUserId, user.id));
  res.json(rows);
});

// PUT /api/brand-profile → upsert（platform 唯一）
router.put("/brand-profile", async (req, res): Promise<void> => {
  const user = await ensureUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const data = parsed.data;
  // 原子 upsert：依赖 schema 上 `(owner_user_id, platform)` 唯一约束，
  // 避免 SELECT-then-INSERT 的并发 race（之前快速点保存会偶发 unique constraint 500）。
  const values = {
    ownerUserId: user.id,
    platform: data.platform,
    category: data.category ?? null,
    products: data.products ?? null,
    targetAudience: data.targetAudience ?? null,
    priceRange: data.priceRange ?? null,
    tone: data.tone ?? null,
    forbiddenClaims: data.forbiddenClaims ?? [],
    conversionGoal: data.conversionGoal ?? null,
    region: data.region ?? null,
    language: data.language ?? null,
    extras: data.extras ?? {},
  };
  const [row] = await db
    .insert(brandProfilesTable)
    .values(values)
    .onConflictDoUpdate({
      target: [brandProfilesTable.ownerUserId, brandProfilesTable.platform],
      set: {
        category: values.category,
        products: values.products,
        targetAudience: values.targetAudience,
        priceRange: values.priceRange,
        tone: values.tone,
        forbiddenClaims: values.forbiddenClaims,
        conversionGoal: values.conversionGoal,
        region: values.region,
        language: values.language,
        extras: values.extras,
      },
    })
    .returning();
  res.json(row);
});

// DELETE /api/brand-profile?platform=xhs
router.delete("/brand-profile", async (req, res): Promise<void> => {
  const user = await ensureUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const platform = req.query.platform;
  if (!isPlatform(platform)) { res.status(400).json({ error: "invalid platform" }); return; }
  await db
    .delete(brandProfilesTable)
    .where(and(eq(brandProfilesTable.ownerUserId, user.id), eq(brandProfilesTable.platform, platform)));
  res.sendStatus(204);
});

export default router;
