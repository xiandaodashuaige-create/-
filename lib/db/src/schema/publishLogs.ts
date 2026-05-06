import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";

export const publishLogsTable = pgTable(
  "publish_logs",
  {
    id: serial("id").primaryKey(),
    scheduleId: integer("schedule_id"),
    contentId: integer("content_id"),
    accountId: integer("account_id"),
    platform: text("platform").notNull(),
    attempt: integer("attempt").notNull().default(1),
    status: text("status").notNull(),
    postId: text("post_id"),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scheduleIdx: index("publish_logs_schedule_idx").on(t.scheduleId),
    createdIdx: index("publish_logs_created_idx").on(t.createdAt),
  }),
);
