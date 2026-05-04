import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sensitiveWordsTable = pgTable("sensitive_words", {
  id: serial("id").primaryKey(),
  word: text("word").notNull(),
  category: text("category").notNull(),
  severity: text("severity").notNull().default("medium"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSensitiveWordSchema = createInsertSchema(sensitiveWordsTable).omit({ id: true, createdAt: true });
export type InsertSensitiveWord = z.infer<typeof insertSensitiveWordSchema>;
export type SensitiveWord = typeof sensitiveWordsTable.$inferSelect;
