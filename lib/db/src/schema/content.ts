import { type AnyPgColumn, pgTable, text, serial, timestamp, integer, real, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { accountsTable } from "./accounts";
import { usersTable } from "./users";

export const contentTable = pgTable("content", {
  id: serial("id").primaryKey(),
  // 直接挂 owner，避免账号删除（accountId set null）后租户过滤失效导致历史内容"消失"
  ownerUserId: integer("owner_user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  accountId: integer("account_id").references(() => accountsTable.id, { onDelete: "set null" }),
  // platform 维度：默认 xhs，未来支持 tiktok/instagram/facebook
  platform: text("platform").notNull().default("xhs"),
  // 一稿多发的源头：A→B 派生时 B.parentContentId = A.id
  // 自引用 FK + onDelete: 'set null'，删父稿不再留下指向幽灵 ID 的孤儿子稿。
  parentContentId: integer("parent_content_id").references((): AnyPgColumn => contentTable.id, { onDelete: "set null" }),
  // 媒体类型：image | video | mixed（默认 image，与现有 xhs 图文笔记兼容）
  mediaType: text("media_type").notNull().default("image"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  originalReference: text("original_reference"),
  tags: text("tags").array().notNull().default([]),
  imageUrls: text("image_urls").array().notNull().default([]),
  videoUrl: text("video_url"),
  // TTS 配音音频地址（A 项目摘出来的 msedge-tts 能力，xhs 默认空）
  ttsAudioUrl: text("tts_audio_url"),
  status: text("status").notNull().default("draft"),
  sensitivityScore: real("sensitivity_score"),
  sensitivityIssues: text("sensitivity_issues").array().notNull().default([]),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  // 发布到第三方平台后的远端 ID（Ayrshare/Meta/TikTok 各自的 post id）
  remotePostId: text("remote_post_id"),
  remotePostUrl: text("remote_post_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => ({
  ownerIdx: index("content_owner_idx").on(t.ownerUserId),
}));

export const insertContentSchema = createInsertSchema(contentTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertContent = z.infer<typeof insertContentSchema>;
export type Content = typeof contentTable.$inferSelect;
