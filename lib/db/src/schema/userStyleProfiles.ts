import { pgTable, serial, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const userStyleProfilesTable = pgTable("user_style_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }).notNull().unique(),
  dominantColors: jsonb("dominant_colors").notNull().default([]),
  preferredLayouts: jsonb("preferred_layouts").notNull().default([]),
  preferredFonts: jsonb("preferred_fonts").notNull().default([]),
  preferredEmojis: jsonb("preferred_emojis").notNull().default([]),
  preferredMoods: jsonb("preferred_moods").notNull().default([]),
  sampleSize: integer("sample_size").notNull().default(0),
  lastUpdated: timestamp("last_updated", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type UserStyleProfile = typeof userStyleProfilesTable.$inferSelect;
export type InsertUserStyleProfile = typeof userStyleProfilesTable.$inferInsert;
