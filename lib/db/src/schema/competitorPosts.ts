import { pgTable, text, serial, integer, timestamp, jsonb, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { competitorProfilesTable } from "./competitorProfiles";

// 多平台竞品内容（视频/帖子/笔记）
export const competitorPostsTable = pgTable(
  "competitor_posts",
  {
    id: serial("id").primaryKey(),
    competitorId: integer("competitor_id").notNull().references(() => competitorProfilesTable.id, { onDelete: "cascade" }),
    platform: text("platform").notNull().default("tiktok"),
    // 平台原生 ID（视频id / 帖子id / 笔记id）
    externalId: text("external_id").notNull(),
    mediaType: text("media_type").notNull().default("video"), // video | image | text | mixed
    title: text("title"),
    description: text("description"),
    coverUrl: text("cover_url"),
    mediaUrl: text("media_url"), // 主媒体（视频 url / 第一张图）
    mediaUrls: text("media_urls").array().notNull().default([]),
    postUrl: text("post_url"),
    viewCount: integer("view_count").notNull().default(0),
    likeCount: integer("like_count").notNull().default(0),
    commentCount: integer("comment_count").notNull().default(0),
    shareCount: integer("share_count").notNull().default(0),
    duration: integer("duration"),
    musicName: text("music_name"),
    musicAuthor: text("music_author"),
    hashtags: text("hashtags").array().notNull().default([]),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    isViral: boolean("is_viral").notNull().default(false),
    transcript: text("transcript"),
    analysisJson: jsonb("analysis_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    competitorExternalUniq: uniqueIndex("competitor_posts_competitor_external_uniq").on(
      t.competitorId,
      t.externalId,
    ),
  }),
);

export const insertCompetitorPostSchema = createInsertSchema(competitorPostsTable).omit({ id: true, createdAt: true });
export type InsertCompetitorPost = z.infer<typeof insertCompetitorPostSchema>;
export type CompetitorPost = typeof competitorPostsTable.$inferSelect;
