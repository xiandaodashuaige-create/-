import { pgTable, text, serial, timestamp, integer, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { contentTable } from "./content";
import { accountsTable } from "./accounts";

export const noteTrackingTable = pgTable(
  "note_tracking",
  {
    id: serial("id").primaryKey(),
    ownerUserId: integer("owner_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    contentId: integer("content_id").references(() => contentTable.id, { onDelete: "set null" }),
    accountId: integer("account_id").references(() => accountsTable.id, { onDelete: "set null" }),
    xhsNoteId: text("xhs_note_id").notNull(),
    xhsUrl: text("xhs_url").notNull(),
    title: text("title").notNull().default(""),
    targetKeywords: jsonb("target_keywords").$type<string[]>().notNull().default([]),
    region: text("region"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    archived: integer("archived").notNull().default(0),
  },
  (t) => ({
    userNoteUq: uniqueIndex("note_tracking_user_note_uq").on(t.ownerUserId, t.xhsNoteId),
  }),
);

export const noteMetricsDailyTable = pgTable(
  "note_metrics_daily",
  {
    id: serial("id").primaryKey(),
    trackingId: integer("tracking_id").notNull().references(() => noteTrackingTable.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    likedCount: integer("liked_count").notNull().default(0),
    collectedCount: integer("collected_count").notNull().default(0),
    commentCount: integer("comment_count").notNull().default(0),
    sharedCount: integer("shared_count").notNull().default(0),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    trackDateUq: uniqueIndex("note_metrics_daily_uq").on(t.trackingId, t.date),
  }),
);

export const keywordRankingsDailyTable = pgTable(
  "keyword_rankings_daily",
  {
    id: serial("id").primaryKey(),
    trackingId: integer("tracking_id").notNull().references(() => noteTrackingTable.id, { onDelete: "cascade" }),
    keyword: text("keyword").notNull(),
    date: text("date").notNull(),
    rank: integer("rank"),
    found: integer("found").notNull().default(0),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    trackKeywordDateUq: uniqueIndex("keyword_rankings_daily_uq").on(t.trackingId, t.keyword, t.date),
  }),
);

export const hotTopicsCacheTable = pgTable(
  "hot_topics_cache",
  {
    id: serial("id").primaryKey(),
    niche: text("niche").notNull(),
    region: text("region").notNull().default("ALL"),
    date: text("date").notNull(),
    topics: jsonb("topics").$type<Array<{ tag: string; count: number; sampleTitle?: string; sampleNoteId?: string; sampleCover?: string; topLikes?: number }>>().notNull().default([]),
    samplesAnalyzed: integer("samples_analyzed").notNull().default(0),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nicheRegionDateUq: uniqueIndex("hot_topics_cache_uq").on(t.niche, t.region, t.date),
  }),
);

export type NoteTracking = typeof noteTrackingTable.$inferSelect;
export type NoteMetricsDaily = typeof noteMetricsDailyTable.$inferSelect;
export type KeywordRankingsDaily = typeof keywordRankingsDailyTable.$inferSelect;
export type HotTopicsCache = typeof hotTopicsCacheTable.$inferSelect;
