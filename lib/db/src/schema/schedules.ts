import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { contentTable } from "./content";
import { accountsTable } from "./accounts";

export const schedulesTable = pgTable("schedules", {
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertScheduleSchema = createInsertSchema(schedulesTable).omit({ id: true, createdAt: true });
export type InsertSchedule = z.infer<typeof insertScheduleSchema>;
export type Schedule = typeof schedulesTable.$inferSelect;
