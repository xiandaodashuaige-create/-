import { pgTable, text, serial, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// 多平台竞品账号库（xhs / tiktok / instagram / facebook）
export const competitorProfilesTable = pgTable(
  "competitor_profiles",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    platform: text("platform").notNull().default("tiktok"),
    handle: text("handle").notNull(),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    bio: text("bio"),
    followerCount: integer("follower_count").notNull().default(0),
    followingCount: integer("following_count").notNull().default(0),
    postCount: integer("post_count").notNull().default(0),
    category: text("category"),
    region: text("region"),
    profileUrl: text("profile_url"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    userPlatformHandleUniq: uniqueIndex("competitor_profiles_user_platform_handle_uniq").on(
      t.userId,
      t.platform,
      t.handle,
    ),
  }),
);

export const insertCompetitorProfileSchema = createInsertSchema(competitorProfilesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCompetitorProfile = z.infer<typeof insertCompetitorProfileSchema>;
export type CompetitorProfile = typeof competitorProfilesTable.$inferSelect;
