import { pgTable, text, serial, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { contentTable } from "./content";

// AI 策略卡：综合账号画像 + 同行真实数据 → 推送主题/钩子/剧本/BGM/标签
export const strategiesTable = pgTable("strategies", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  platform: text("platform").notNull().default("tiktok"),
  // draft | approved | published | failed
  status: text("status").notNull().default("draft"),
  region: text("region"),
  niche: text("niche"),
  competitorPostIds: integer("competitor_post_ids").array().notNull().default([]),
  accountIds: integer("account_ids").array().notNull().default([]),
  inputContextJson: jsonb("input_context_json"),
  // 完整策略卡 JSON：theme/hookFormula/scriptOutline/voiceoverScript/bgmStyle/hashtags 等
  strategyJson: jsonb("strategy_json").notNull(),
  // approve 后写入对应 content draft id（绑定后续 workflow 编辑/发布）
  contentId: integer("content_id").references(() => contentTable.id, { onDelete: "set null" }),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertStrategySchema = createInsertSchema(strategiesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStrategy = z.infer<typeof insertStrategySchema>;
export type Strategy = typeof strategiesTable.$inferSelect;
