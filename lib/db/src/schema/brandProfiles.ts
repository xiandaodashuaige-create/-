import { pgTable, text, serial, timestamp, integer, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const brandProfilesTable = pgTable(
  "brand_profiles",
  {
    id: serial("id").primaryKey(),
    ownerUserId: integer("owner_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    category: text("category"),
    products: text("products"),
    targetAudience: text("target_audience"),
    priceRange: text("price_range"),
    tone: text("tone"),
    forbiddenClaims: jsonb("forbidden_claims").$type<string[]>().default([]).notNull(),
    conversionGoal: text("conversion_goal"),
    region: text("region"),
    language: text("language"),
    extras: jsonb("extras").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    ownerPlatformUniq: uniqueIndex("brand_profiles_owner_platform_uniq").on(t.ownerUserId, t.platform),
  }),
);

export const insertBrandProfileSchema = createInsertSchema(brandProfilesTable).omit({
  id: true, createdAt: true, updatedAt: true, ownerUserId: true,
});
export type InsertBrandProfile = z.infer<typeof insertBrandProfileSchema>;
export type BrandProfile = typeof brandProfilesTable.$inferSelect;
