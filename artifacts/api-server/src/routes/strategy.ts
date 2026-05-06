import { Router, type IRouter } from "express";
import { eq, and, inArray, desc } from "drizzle-orm";
import {
  db,
  strategiesTable,
  competitorProfilesTable,
  competitorPostsTable,
  accountsTable,
  contentTable,
} from "@workspace/db";
import { ensureUser } from "../middlewares/creditSystem";
import { logger } from "../lib/logger";
import { generateStrategyCard } from "../services/strategyGenerator";
import { logActivity } from "../lib/activity";

const router: IRouter = Router();
type Platform = "xhs" | "tiktok" | "instagram" | "facebook";
function isValidPlatform(p: string): p is Platform {
  return ["xhs", "tiktok", "instagram", "facebook"].includes(p);
}

// ── POST /api/strategy/generate ───────────────────────────────────────
router.post("/strategy/generate", async (req, res): Promise<void> => {
  const user = await ensureUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const {
    platform: rawPlatform,
    region,
    niche,
    competitorPostIds = [],
    accountIds = [],
    customRequirements,
  } = req.body as {
    platform?: string; region?: string; niche?: string;
    competitorPostIds?: number[]; accountIds?: number[]; customRequirements?: string;
  };
  const platform = (rawPlatform && isValidPlatform(rawPlatform)) ? rawPlatform : "tiktok";

  // 加载用户授权账号上下文
  let accounts: any[] = [];
  if (Array.isArray(accountIds) && accountIds.length > 0) {
    accounts = await db.select().from(accountsTable).where(and(
      inArray(accountsTable.id, accountIds),
      eq(accountsTable.ownerUserId, user.id),
    ));
  } else {
    accounts = await db.select().from(accountsTable).where(and(
      eq(accountsTable.ownerUserId, user.id),
      eq(accountsTable.platform, platform),
    )).limit(5);
  }

  // 加载候选同行内容
  let candidatePosts: any[] = [];
  let candidateProfiles: any[] = [];
  if (Array.isArray(competitorPostIds) && competitorPostIds.length > 0) {
    candidatePosts = await db.select().from(competitorPostsTable)
      .where(inArray(competitorPostsTable.id, competitorPostIds))
      .orderBy(desc(competitorPostsTable.likeCount)).limit(60);
    const cIds = Array.from(new Set(candidatePosts.map(p => p.competitorId)));
    if (cIds.length > 0) {
      candidateProfiles = await db.select().from(competitorProfilesTable)
        .where(and(
          inArray(competitorProfilesTable.id, cIds),
          eq(competitorProfilesTable.userId, user.id),
        ));
    }
  } else {
    candidateProfiles = await db.select().from(competitorProfilesTable).where(and(
      eq(competitorProfilesTable.userId, user.id),
      eq(competitorProfilesTable.platform, platform),
    ));
    if (candidateProfiles.length > 0) {
      candidatePosts = await db.select().from(competitorPostsTable)
        .where(inArray(competitorPostsTable.competitorId, candidateProfiles.map(p => p.id)))
        .orderBy(desc(competitorPostsTable.likeCount)).limit(80);
    }
  }

  try {
    const result = await generateStrategyCard({
      platform, region, niche,
      competitorPosts: candidatePosts,
      competitorProfiles: candidateProfiles,
      accounts, customRequirements,
    });

    const [strategy] = await db.insert(strategiesTable).values({
      userId: user.id, platform, status: "draft",
      region: region ?? null, niche: niche ?? null,
      competitorPostIds: result.filteredPostIds,
      accountIds: accounts.map(a => a.id),
      inputContextJson: result.meta,
      strategyJson: result.card,
    }).returning();

    await logActivity("strategy.generated", `生成 ${platform} 策略卡 #${strategy.id}（${result.meta.dataMode}）`);

    res.json({
      id: strategy.id,
      status: strategy.status,
      platform,
      strategy: result.card,
      meta: result.meta,
    });
  } catch (err: any) {
    logger.error({ err: err.message, stack: err.stack }, "strategy generate failed");
    res.status(500).json({ error: "internal_error", message: err.message });
  }
});

// ── GET /api/strategy/:id ─────────────────────────────────────────────
router.get("/strategy/:id", async (req, res): Promise<void> => {
  const user = await ensureUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "invalid_id" }); return; }
  const [s] = await db.select().from(strategiesTable).where(eq(strategiesTable.id, id));
  if (!s) { res.status(404).json({ error: "not_found" }); return; }
  if (s.userId !== user.id) { res.status(403).json({ error: "forbidden" }); return; }
  res.json(s);
});

// ── GET /api/strategy?platform=tiktok ─────────────────────────────────
router.get("/strategy", async (req, res): Promise<void> => {
  const user = await ensureUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const platform = req.query.platform as string | undefined;
  const where = platform && isValidPlatform(platform)
    ? and(eq(strategiesTable.userId, user.id), eq(strategiesTable.platform, platform))
    : eq(strategiesTable.userId, user.id);
  const list = await db.select().from(strategiesTable).where(where).orderBy(desc(strategiesTable.createdAt)).limit(50);
  res.json(list);
});

// ── POST /api/strategy/:id/approve ────────────────────────────────────
// 用户批准 → 自动创建 content draft（可在 workflow 继续编辑/发布）
router.post("/strategy/:id/approve", async (req, res): Promise<void> => {
  const user = await ensureUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "invalid_id" }); return; }

  const [s] = await db.select().from(strategiesTable).where(eq(strategiesTable.id, id));
  if (!s) { res.status(404).json({ error: "not_found" }); return; }
  if (s.userId !== user.id) { res.status(403).json({ error: "forbidden" }); return; }
  if (s.status === "approved" && s.contentId) {
    res.json({ id: s.id, status: s.status, contentId: s.contentId, message: "已批准" });
    return;
  }

  const card: any = s.strategyJson;
  // 优先使用策略生成时用户明确选定的"业务身份"（s.accountIds[0]），
  // 严格校验属主+平台一致；只在策略未显式绑定时才回落到该平台第一个账号。
  // 这样 autopilot 多账号场景下，用户在 setup 步骤选的 A 不会被 approve 默默落到 B。
  const persistedAccountIds = Array.isArray(s.accountIds) ? (s.accountIds as number[]) : [];
  let acc: typeof accountsTable.$inferSelect | undefined;
  if (persistedAccountIds.length > 0) {
    const [byId] = await db.select().from(accountsTable).where(and(
      eq(accountsTable.id, persistedAccountIds[0]!),
      eq(accountsTable.ownerUserId, user.id),
      eq(accountsTable.platform, s.platform),
    )).limit(1);
    acc = byId;
  }
  if (!acc) {
    const [fallback] = await db.select().from(accountsTable).where(and(
      eq(accountsTable.ownerUserId, user.id),
      eq(accountsTable.platform, s.platform),
    )).limit(1);
    acc = fallback;
  }

  if (!acc) {
    res.status(400).json({
      error: "no_account",
      message: `批准失败：当前用户尚未绑定任何 ${s.platform} 平台账号。请先到 /accounts 绑定账号后再批准策略。`,
      platform: s.platform,
    });
    return;
  }

  const mediaType = s.platform === "tiktok" ? "video" : "image";
  const title = card?.theme ?? `策略 #${s.id}`;
  const body = card?.bodyDraft || card?.voiceoverScript || card?.scriptOutline?.map((sc: any) => sc.dialogue).join("\n") || "";
  const tags = Array.isArray(card?.hashtags) ? card.hashtags.map((h: string) => h.replace(/^#/, "")) : [];

  const [content] = await db.insert(contentTable).values({
    ownerUserId: user.id,
    accountId: acc.id,
    platform: s.platform,
    mediaType,
    title: title.slice(0, 200),
    body,
    originalReference: JSON.stringify({ source: "strategy", strategyId: s.id }),
    tags,
    imageUrls: [],
    status: "draft",
    sensitivityScore: 0,
    sensitivityIssues: [],
  } as any).returning();

  const [updated] = await db.update(strategiesTable)
    .set({ status: "approved", contentId: content.id, updatedAt: new Date() })
    .where(eq(strategiesTable.id, id)).returning();

  await logActivity("strategy.approved", `批准策略 #${id} → 草稿 #${content.id}`, content.id, acc.id);
  res.json({ id: updated.id, status: updated.status, contentId: content.id });
});

export default router;
