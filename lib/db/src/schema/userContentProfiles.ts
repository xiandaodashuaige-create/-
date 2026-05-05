import { pgTable, serial, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const userContentProfilesTable = pgTable("user_content_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }).notNull().unique(),
  favoriteTags: jsonb("favorite_tags").notNull().default([]),
  preferredTitlePatterns: jsonb("preferred_title_patterns").notNull().default([]),
  preferredOpenings: jsonb("preferred_openings").notNull().default([]),
  preferredEmojis: jsonb("preferred_emojis").notNull().default([]),
  avoidedPhrases: jsonb("avoided_phrases").notNull().default([]),
  preferredRegions: jsonb("preferred_regions").notNull().default([]),
  avgBodyLength: integer("avg_body_length").notNull().default(0),
  avgTagCount: integer("avg_tag_count").notNull().default(0),
  sampleSize: integer("sample_size").notNull().default(0),
  lastUpdated: timestamp("last_updated", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type UserContentProfile = typeof userContentProfilesTable.$inferSelect;
export type InsertUserContentProfile = typeof userContentProfilesTable.$inferInsert;
