import { pgTable, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// 视频生成异步任务持久化（替代之前的进程内 Map + queue）
// 进程重启后 cron poll pending/running 任务继续执行，避免用户钱被吞
export const videoJobsTable = pgTable(
  "video_jobs",
  {
    id: text("id").primaryKey(), // uuid
    ownerUserId: integer("owner_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"), // queued | planning | generating | composing | uploading | succeeded | failed
    progress: integer("progress").notNull().default(0),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    plan: jsonb("plan").$type<Record<string, unknown> | null>(),
    result: jsonb("result").$type<Record<string, unknown> | null>(),
    error: text("error"),
    creditsRefunded: integer("credits_refunded").notNull().default(0),
    // 该任务实际扣的积分（写入与扣费同事务）。退款时读这个字段，避免 dedup hit / 漏扣 时盲目退款导致负余额造币
    chargedAmount: integer("charged_amount").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_video_jobs_status").on(t.status),
    index("idx_video_jobs_owner").on(t.ownerUserId),
  ],
);

export type VideoJobRow = typeof videoJobsTable.$inferSelect;
export type InsertVideoJobRow = typeof videoJobsTable.$inferInsert;
