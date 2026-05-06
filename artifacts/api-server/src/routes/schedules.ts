import { Router, type IRouter } from "express";
import { eq, and, sql, gte, lte, inArray, type SQL } from "drizzle-orm";
import { db, schedulesTable, contentTable, accountsTable } from "@workspace/db";
import {
  ListSchedulesQueryParams,
  ListSchedulesResponse,
  DeleteScheduleParams,
} from "@workspace/api-zod";
import { ensureUser } from "../middlewares/creditSystem";
import { isAccountReadyToPublish } from "../services/publishDispatcher.js";

// 校验某条 schedule 是否属于当前用户，返回 schedule（含 contentId / accountId）
async function loadOwnedSchedule(scheduleId: number, userId: number) {
  const [row] = await db
    .select({
      id: schedulesTable.id,
      contentId: schedulesTable.contentId,
      accountId: schedulesTable.accountId,
      status: schedulesTable.status,
      scheduledAt: schedulesTable.scheduledAt,
    })
    .from(schedulesTable)
    .innerJoin(accountsTable, eq(schedulesTable.accountId, accountsTable.id))
    .where(and(eq(schedulesTable.id, scheduleId), eq(accountsTable.ownerUserId, userId)));
  return row;
}

const router: IRouter = Router();

type PlanItemBody = {
  dayOffset: number;
  time: string;        // "HH:mm"
  title: string;
  body: string;
  tags?: string[];
  imagePrompt?: string;
};

// 把 (startDate, dayOffset, "HH:mm") 在指定时区下解析为 UTC Date。
// tz 默认 Asia/Shanghai（覆盖 CN/HK/SG/MY 主要市场，UTC+8）。
// 修复：旧实现用 base.setHours() 隐式按服务器本地时区解释 — 在 UTC 服务器上会
// 把用户输入的"上午10点"错误存为 10:00 UTC = 北京时间 18:00。
function combineDateTime(
  startDateIso: string,
  dayOffset: number,
  time: string,
  tz: string = "Asia/Shanghai",
): Date {
  const base = new Date(startDateIso);
  if (Number.isNaN(base.getTime())) throw new Error("invalid startDate");
  const [hhStr, mmStr] = time.split(":");
  const hh = parseInt(hhStr || "", 10);
  const mm = parseInt(mmStr || "0", 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    throw new Error("invalid time");
  }

  // Step 1: 在 tz 下取出 startDate 的 Y-M-D
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const partsBase = Object.fromEntries(
    fmt.formatToParts(base).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const y0 = parseInt(partsBase.year!, 10);
  const m0 = parseInt(partsBase.month!, 10);
  const d0 = parseInt(partsBase.day!, 10);

  // Step 2: 加 dayOffset（UTC 算术避免 DST 边界 glitch）
  const dayUtc = new Date(Date.UTC(y0, m0 - 1, d0));
  dayUtc.setUTCDate(dayUtc.getUTCDate() + dayOffset);
  const yy = dayUtc.getUTCFullYear();
  const mo = dayUtc.getUTCMonth() + 1;
  const dd = dayUtc.getUTCDate();

  // Step 3: 把 "yy-mo-dd hh:mm in tz" 转成正确的 UTC Date
  // 技巧：先按 UTC 构造一个"假"时间，再用 Intl 反查它在 tz 下读作几点，差值即为 tz 偏移。
  const naiveUtc = Date.UTC(yy, mo - 1, dd, hh, mm, 0);
  const tzFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const partsTz = Object.fromEntries(
    tzFmt.formatToParts(new Date(naiveUtc)).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const asTz = Date.UTC(
    parseInt(partsTz.year!, 10),
    parseInt(partsTz.month!, 10) - 1,
    parseInt(partsTz.day!, 10),
    parseInt(partsTz.hour!, 10),
    parseInt(partsTz.minute!, 10),
    parseInt(partsTz.second!, 10),
  );
  const tzOffsetMs = asTz - naiveUtc;
  return new Date(naiveUtc - tzOffsetMs);
}


const MAX_BULK_ITEMS = 20;

router.get("/schedules", async (req, res): Promise<void> => {
  try {
    const u = await ensureUser(req);
    if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }

    const query = ListSchedulesQueryParams.safeParse(req.query);
    const conditions: SQL[] = [sql`a.owner_user_id = ${u.id}`];

    if (query.success) {
      if (query.data.accountId) {
        conditions.push(sql`s.account_id = ${query.data.accountId}`);
      }
      if (query.data.startDate) {
        conditions.push(sql`s.scheduled_at >= ${query.data.startDate}`);
      }
      if (query.data.endDate) {
        conditions.push(sql`s.scheduled_at <= ${query.data.endDate}`);
      }
    }

    const whereClause = sql`WHERE ${sql.join(conditions, sql` AND `)}`;

    const rows = await db.execute(sql`
      SELECT s.*,
        c.title as content_title, c.status as content_status,
        a.nickname as account_nickname, a.region as account_region, a.platform as account_platform
      FROM schedules s
      INNER JOIN accounts a ON s.account_id = a.id
      LEFT JOIN content c ON s.content_id = c.id
      ${whereClause}
      ORDER BY s.scheduled_at ASC
    `);

    const result = (rows.rows as any[]).map((row: any) => ({
      id: row.id,
      contentId: row.content_id,
      accountId: row.account_id,
      scheduledAt: row.scheduled_at,
      status: row.status,
      errorMessage: row.error_message ?? null,
      createdAt: row.created_at,
      content: {
        id: row.content_id,
        title: row.content_title || "Untitled",
        status: row.content_status || "draft",
      },
      account: {
        id: row.account_id,
        platform: row.account_platform || "xhs",
        nickname: row.account_nickname || "Unknown",
        region: row.account_region || "SG",
      },
    }));

    res.json(ListSchedulesResponse.parse(result));
  } catch (err) {
    req.log.error(err, "Failed to list schedules");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/schedules/:id", async (req, res): Promise<void> => {
  try {
    const params = DeleteScheduleParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const u = await ensureUser(req);
    if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }

    // 验证归属（通过 schedule.account → account.ownerUserId）
    const [schedule] = await db
      .select({ id: schedulesTable.id, contentId: schedulesTable.contentId, accountId: schedulesTable.accountId })
      .from(schedulesTable)
      .innerJoin(accountsTable, eq(schedulesTable.accountId, accountsTable.id))
      .where(and(eq(schedulesTable.id, params.data.id), eq(accountsTable.ownerUserId, u.id)));

    if (!schedule) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }

    await db.delete(schedulesTable).where(eq(schedulesTable.id, params.data.id));

    await db
      .update(contentTable)
      .set({ status: "draft", scheduledAt: null })
      .where(eq(contentTable.id, schedule.contentId));

    res.sendStatus(204);
  } catch (err) {
    req.log.error(err, "Failed to delete schedule");
    res.status(500).json({ error: "Internal server error" });
  }
});

// 批量从 AI 计划草案创建 content + schedule
router.post("/schedules/bulk-create", async (req, res): Promise<void> => {
  try {
    const u = await ensureUser(req);
    if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { accountId, startDate, items, tz } = req.body as {
      accountId?: number;
      startDate?: string;
      items?: PlanItemBody[];
      tz?: string;
    };
    const userTz = typeof tz === "string" && tz.length > 0 ? tz : "Asia/Shanghai";

    if (!accountId || !startDate || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "accountId, startDate, items 必填" });
      return;
    }
    if (items.length > MAX_BULK_ITEMS) {
      res.status(400).json({ error: `单次最多 ${MAX_BULK_ITEMS} 条` });
      return;
    }

    // 预校验所有 items 时间合法
    const prepared: Array<{ item: PlanItemBody; scheduledAt: Date }> = [];
    for (const item of items) {
      try {
        const scheduledAt = combineDateTime(startDate, item.dayOffset, item.time, userTz);
        prepared.push({ item, scheduledAt });
      } catch {
        res.status(400).json({ error: `item 时间非法：dayOffset=${item.dayOffset} time=${item.time}` });
        return;
      }
    }

    // 验证账号归属
    const [account] = await db
      .select()
      .from(accountsTable)
      .where(and(eq(accountsTable.id, accountId), eq(accountsTable.ownerUserId, u.id)));
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    // T1：非 XHS 平台账号必须授权后才能批量建排期；防止后续 cron 必然失败
    if (!isAccountReadyToPublish(account)) {
      res.status(400).json({
        error: "account_not_authorized",
        message: `${account.platform} 账号尚未授权，无法批量排期。请先到「账号管理」完成授权。`,
        platform: account.platform,
      });
      return;
    }

    // 评审建议：幂等去重 — 已存在 (account, scheduledAt) 完全相同的 schedule 则跳过
    // 防止用户在 done 步骤连点 CTA、或当前 done 内容碰巧排到明天时撞日
    // 注：同请求并发场景仍需后续给 schedules(account_id, scheduled_at) 加唯一索引 + ON CONFLICT 才能彻底闭环
    const existingScheduledAt = await db
      .select({ scheduledAt: schedulesTable.scheduledAt })
      .from(schedulesTable)
      .where(eq(schedulesTable.accountId, account.id));
    const seenTimes = new Set(existingScheduledAt.map((r) => r.scheduledAt.getTime()));
    // 1) 跳过 DB 已有的；2) 同批 items 自身重复 scheduledAt 也只保留首条
    const filtered: typeof prepared = [];
    for (const item of prepared) {
      const t = item.scheduledAt.getTime();
      if (seenTimes.has(t)) continue;
      seenTimes.add(t);
      filtered.push(item);
    }
    const skipped = prepared.length - filtered.length;

    // 事务：失败整体回滚
    const created = await db.transaction(async (tx) => {
      const out: Array<{ contentId: number; scheduleId: number; scheduledAt: Date }> = [];
      for (const { item, scheduledAt } of filtered) {
        const [content] = await tx
          .insert(contentTable)
          .values({
            accountId: account.id,
            platform: account.platform,
            title: (item.title || "未命名").slice(0, 200),
            body: item.body || "",
            tags: Array.isArray(item.tags) ? item.tags.slice(0, 10) : [],
            imageUrls: [],
            status: "scheduled",
            scheduledAt,
          })
          .returning();
        const [schedule] = await tx
          .insert(schedulesTable)
          .values({
            contentId: content.id,
            accountId: account.id,
            platform: account.platform,
            scheduledAt,
          })
          .returning();
        out.push({ contentId: content.id, scheduleId: schedule.id, scheduledAt });
      }
      return out;
    });

    res.status(201).json({ created: created.length, skipped, items: created });
  } catch (err) {
    req.log.error(err, "Failed to bulk-create schedules");
    res.status(500).json({ error: "Internal server error" });
  }
});

// 把已有的一周计划复制到接下来 N 周（同样的星期/时间偏移，clone content）
router.post("/schedules/duplicate-weeks", async (req, res): Promise<void> => {
  try {
    const u = await ensureUser(req);
    if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { accountId, startDate, endDate, weeks } = req.body as {
      accountId?: number;
      startDate?: string;
      endDate?: string;
      weeks?: number;
    };

    if (!accountId || !startDate || !endDate || !weeks || weeks < 1) {
      res.status(400).json({ error: "accountId, startDate, endDate, weeks(>=1) 必填" });
      return;
    }
    const startD = new Date(startDate);
    const endD = new Date(endDate);
    if (Number.isNaN(startD.getTime()) || Number.isNaN(endD.getTime())) {
      res.status(400).json({ error: "startDate / endDate 格式非法" });
      return;
    }
    if (endD.getTime() <= startD.getTime()) {
      res.status(400).json({ error: "endDate 必须晚于 startDate" });
      return;
    }
    if (endD.getTime() - startD.getTime() > 8 * 24 * 60 * 60 * 1000) {
      res.status(400).json({ error: "源时间窗最大 8 天（应为单周）" });
      return;
    }
    const weeksClamped = Math.min(Math.max(1, Math.floor(weeks)), 5);

    const [account] = await db
      .select()
      .from(accountsTable)
      .where(and(eq(accountsTable.id, accountId), eq(accountsTable.ownerUserId, u.id)));
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    // 只取 pending 状态的源 schedule（已完成/失败不复制）
    const srcSchedules = await db
      .select()
      .from(schedulesTable)
      .where(and(
        eq(schedulesTable.accountId, account.id),
        eq(schedulesTable.status, "pending"),
        gte(schedulesTable.scheduledAt, startD),
        lte(schedulesTable.scheduledAt, endD),
      ))
      .orderBy(schedulesTable.scheduledAt);

    if (srcSchedules.length === 0) {
      res.status(400).json({ error: "源周区间内没有待发布计划可复制" });
      return;
    }

    // 拿对应 content
    const contentIds = Array.from(new Set(srcSchedules.map((s) => s.contentId)));
    const srcContents = await db
      .select()
      .from(contentTable)
      .where(inArray(contentTable.id, contentIds));
    const contentMap = new Map(srcContents.map((c) => [c.id, c]));

    // 幂等：拿目标整段时间窗内已有 schedule（包含 parentContentId 的克隆来源）
    const targetEnd = new Date(srcSchedules[srcSchedules.length - 1].scheduledAt.getTime() + weeksClamped * 7 * 24 * 60 * 60 * 1000 + 60_000);
    const existingTargets = await db
      .select({ scheduledAt: schedulesTable.scheduledAt })
      .from(schedulesTable)
      .where(and(
        eq(schedulesTable.accountId, account.id),
        gte(schedulesTable.scheduledAt, new Date(startD.getTime() + 7 * 24 * 60 * 60 * 1000)),
        lte(schedulesTable.scheduledAt, targetEnd),
      ));
    const existingTimes = new Set(existingTargets.map((s) => s.scheduledAt.getTime()));

    const totalCreated = await db.transaction(async (tx) => {
      let n = 0;
      for (let w = 1; w <= weeksClamped; w++) {
        const offsetMs = w * 7 * 24 * 60 * 60 * 1000;
        for (const sch of srcSchedules) {
          const src = contentMap.get(sch.contentId);
          if (!src) continue;
          const newScheduledAt = new Date(sch.scheduledAt.getTime() + offsetMs);
          if (existingTimes.has(newScheduledAt.getTime())) continue; // 幂等去重

          const [newContent] = await tx
            .insert(contentTable)
            .values({
              accountId: src.accountId,
              platform: src.platform,
              parentContentId: src.id,
              mediaType: src.mediaType,
              title: src.title,
              body: src.body,
              originalReference: src.originalReference,
              tags: src.tags,
              imageUrls: src.imageUrls,
              videoUrl: src.videoUrl,
              status: "scheduled",
              scheduledAt: newScheduledAt,
            })
            .returning();
          await tx.insert(schedulesTable).values({
            contentId: newContent.id,
            accountId: sch.accountId,
            platform: sch.platform,
            scheduledAt: newScheduledAt,
          });
          existingTimes.add(newScheduledAt.getTime());
          n++;
        }
      }
      return n;
    });

    res.status(201).json({ created: totalCreated, weeks: weeksClamped });
  } catch (err) {
    req.log.error(err, "Failed to duplicate schedule weeks");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====== 月度概览 ======
router.get("/schedules/summary", async (req, res): Promise<void> => {
  try {
    const u = await ensureUser(req);
    if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }

    const month = (req.query.month as string) || new Date().toISOString().slice(0, 7); // YYYY-MM
    const m = /^(\d{4})-(\d{2})$/.exec(month);
    if (!m) { res.status(400).json({ error: "month 格式应为 YYYY-MM" }); return; }
    const year = parseInt(m[1], 10);
    const mon = parseInt(m[2], 10) - 1;
    const start = new Date(Date.UTC(year, mon, 1));
    const end = new Date(Date.UTC(year, mon + 1, 1));

    const rows = await db.execute(sql`
      SELECT s.status, s.scheduled_at, a.platform
      FROM schedules s
      INNER JOIN accounts a ON s.account_id = a.id
      WHERE a.owner_user_id = ${u.id}
        AND s.scheduled_at >= ${start}
        AND s.scheduled_at < ${end}
    `);

    const counts = { total: 0, pending: 0, paused: 0, published: 0, failed: 0 };
    const byDayMap = new Map<string, number>();
    const byPlatform = new Map<string, number>();
    for (const r of rows.rows as any[]) {
      counts.total++;
      const st = r.status || "pending";
      if (st === "pending") counts.pending++;
      else if (st === "paused") counts.paused++;
      else if (st === "published" || st === "completed") counts.published++;
      else if (st === "failed") counts.failed++;
      const day = new Date(r.scheduled_at).toISOString().slice(0, 10);
      byDayMap.set(day, (byDayMap.get(day) || 0) + 1);
      const pf = r.platform || "xhs";
      byPlatform.set(pf, (byPlatform.get(pf) || 0) + 1);
    }
    const byDay = Array.from(byDayMap.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([date, count]) => ({ date, count }));
    const platforms = Array.from(byPlatform.entries()).map(([platform, count]) => ({ platform, count }));

    res.json({ month, ...counts, byDay, platforms });
  } catch (err) {
    req.log.error(err, "Failed to get schedule summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====== 单条修改：时间 / 内容（不影响其他条目） ======
router.patch("/schedules/:id", async (req, res): Promise<void> => {
  try {
    const u = await ensureUser(req);
    if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) { res.status(400).json({ error: "invalid id" }); return; }

    const { scheduledAt, title, body, tags, imageUrls, status } = req.body as {
      scheduledAt?: string;
      title?: string;
      body?: string;
      tags?: string[];
      imageUrls?: string[];
      status?: "pending" | "paused";
    };

    const owned = await loadOwnedSchedule(id, u.id);
    if (!owned) { res.status(404).json({ error: "Schedule not found" }); return; }
    if (owned.status === "published" || owned.status === "completed") {
      res.status(400).json({ error: "已发布的计划无法修改" }); return;
    }

    // 更新 schedule（时间 / 状态）
    const sUpdate: Record<string, unknown> = {};
    if (scheduledAt) {
      const dt = new Date(scheduledAt);
      if (Number.isNaN(dt.getTime())) { res.status(400).json({ error: "scheduledAt 非法" }); return; }
      sUpdate.scheduledAt = dt;
    }
    if (status === "pending" || status === "paused") {
      sUpdate.status = status;
    }
    if (Object.keys(sUpdate).length > 0) {
      await db.update(schedulesTable).set(sUpdate).where(eq(schedulesTable.id, id));
    }

    // 更新 content（仅修改本条对应的 content，原本是 bulk-create 时一对一的克隆，所以不会影响其它条目）
    const cUpdate: Record<string, unknown> = {};
    if (typeof title === "string") cUpdate.title = title.slice(0, 200);
    if (typeof body === "string") cUpdate.body = body;
    if (Array.isArray(tags)) cUpdate.tags = tags.slice(0, 10);
    if (Array.isArray(imageUrls)) cUpdate.imageUrls = imageUrls.slice(0, 9);
    if (sUpdate.scheduledAt) cUpdate.scheduledAt = sUpdate.scheduledAt;
    if (Object.keys(cUpdate).length > 0) {
      await db.update(contentTable).set(cUpdate).where(eq(contentTable.id, owned.contentId));
    }

    res.json({ ok: true, id });
  } catch (err) {
    req.log.error(err, "Failed to patch schedule");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====== 暂停 / 恢复（语义封装，便于前端按钮） ======
router.post("/schedules/:id/pause", async (req, res): Promise<void> => {
  try {
    const u = await ensureUser(req);
    if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }
    const id = Number(req.params.id);
    const owned = await loadOwnedSchedule(id, u.id);
    if (!owned) { res.status(404).json({ error: "Schedule not found" }); return; }
    if (owned.status !== "pending") { res.status(400).json({ error: `当前状态 ${owned.status} 不可暂停` }); return; }
    await db.update(schedulesTable).set({ status: "paused" }).where(eq(schedulesTable.id, id));
    res.json({ ok: true, id, status: "paused" });
  } catch (err) {
    req.log.error(err, "Failed to pause schedule");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/schedules/:id/retry", async (req, res): Promise<void> => {
  try {
    const u = await ensureUser(req);
    if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }
    const id = Number(req.params.id);
    const owned = await loadOwnedSchedule(id, u.id);
    if (!owned) { res.status(404).json({ error: "Schedule not found" }); return; }
    if (owned.status !== "failed") { res.status(400).json({ error: `当前状态 ${owned.status} 不可重试` }); return; }
    // 立即重发：scheduledAt 设为现在 - 5 秒，errorMessage 清空，retry_count 重置为 0（否则人工重试一两次又秒标 failed），下一次 cron tick (≤60s) 拾取
    await db.update(schedulesTable)
      .set({ status: "pending", errorMessage: null, retryCount: 0, scheduledAt: new Date(Date.now() - 5_000) })
      .where(eq(schedulesTable.id, id));
    res.json({ ok: true, id, status: "pending" });
  } catch (err) {
    req.log.error(err, "Failed to retry schedule");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/schedules/:id/resume", async (req, res): Promise<void> => {
  try {
    const u = await ensureUser(req);
    if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }
    const id = Number(req.params.id);
    const owned = await loadOwnedSchedule(id, u.id);
    if (!owned) { res.status(404).json({ error: "Schedule not found" }); return; }
    if (owned.status !== "paused") { res.status(400).json({ error: `当前状态 ${owned.status} 不可恢复` }); return; }
    await db.update(schedulesTable).set({ status: "pending" }).where(eq(schedulesTable.id, id));
    res.json({ ok: true, id, status: "pending" });
  } catch (err) {
    req.log.error(err, "Failed to resume schedule");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====== 批量动作 ======
router.post("/schedules/bulk-action", async (req, res): Promise<void> => {
  try {
    const u = await ensureUser(req);
    if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }
    const { ids, action } = req.body as { ids?: number[]; action?: "pause" | "resume" | "delete" };
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200) {
      res.status(400).json({ error: "ids 必填，1~200 条" }); return;
    }
    if (!["pause", "resume", "delete"].includes(action || "")) {
      res.status(400).json({ error: "action 必须是 pause / resume / delete" }); return;
    }
    // 限定到当前用户的 schedule
    const owned = await db
      .select({ id: schedulesTable.id, contentId: schedulesTable.contentId, status: schedulesTable.status })
      .from(schedulesTable)
      .innerJoin(accountsTable, eq(schedulesTable.accountId, accountsTable.id))
      .where(and(inArray(schedulesTable.id, ids), eq(accountsTable.ownerUserId, u.id)));
    const ownedIds = owned.map((o) => o.id);
    if (ownedIds.length === 0) { res.json({ ok: true, affected: 0 }); return; }

    let affected = 0;
    if (action === "delete") {
      await db.delete(schedulesTable).where(inArray(schedulesTable.id, ownedIds));
      const cIds = owned.map((o) => o.contentId);
      if (cIds.length > 0) {
        await db.update(contentTable).set({ status: "draft", scheduledAt: null }).where(inArray(contentTable.id, cIds));
      }
      affected = ownedIds.length;
    } else if (action === "pause") {
      const targets = owned.filter((o) => o.status === "pending").map((o) => o.id);
      if (targets.length > 0) {
        await db.update(schedulesTable).set({ status: "paused" }).where(inArray(schedulesTable.id, targets));
      }
      affected = targets.length;
    } else if (action === "resume") {
      const targets = owned.filter((o) => o.status === "paused").map((o) => o.id);
      if (targets.length > 0) {
        await db.update(schedulesTable).set({ status: "pending" }).where(inArray(schedulesTable.id, targets));
      }
      affected = targets.length;
    }
    res.json({ ok: true, affected });
  } catch (err) {
    req.log.error(err, "Failed bulk-action");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
