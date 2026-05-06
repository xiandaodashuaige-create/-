import { pgTable, text, serial, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { contentTable } from "./content";
import { accountsTable } from "./accounts";

export const schedulesTable = pgTable(
  "schedules",
  {
    id: serial("id").primaryKey(),
    contentId: integer("content_id").notNull().references(() => contentTable.id, { onDelete: "cascade" }),
    accountId: integer("account_id").notNull().references(() => accountsTable.id, { onDelete: "cascade" }),
    // platform 维度（默认 xhs，向后兼容）；cron dispatcher 据此分流到 manual / ayrshare / meta_direct / tiktok_direct
    platform: text("platform").notNull().default("xhs"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("pending"),
    // 第三方平台返回的远端 post id（如 ayrsharePostId / meta post id），cron 真发布后写回
    remotePostId: text("remote_post_id"),
    errorMessage: text("error_message"),
    // 真正的重试计数（之前用 error_message LIKE 'retry=N' 比较，与写入的时间戳不匹配，会无限重试）
    retryCount: integer("retry_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // 状态变更时自动更新（重试 / 标记成功 / 标记失败 都会触发）
    // 用 $onUpdate 在 ORM 写入时自动 set；同时 .defaultNow() 兜底已有行
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    // 同一账号同一时刻只能有一条排程；bulk-create 跨请求并发的硬性闭环（配合 onConflictDoNothing）
    uniqueIndex("schedules_account_scheduled_at_uniq").on(t.accountId, t.scheduledAt),
  ],
);

export const insertScheduleSchema = createInsertSchema(schedulesTable).omit({ id: true, createdAt: true });
export type InsertSchedule = z.infer<typeof insertScheduleSchema>;
export type Schedule = typeof schedulesTable.$inferSelect;
