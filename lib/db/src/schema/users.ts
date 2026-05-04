import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email"),
  nickname: text("nickname"),
  avatarUrl: text("avatar_url"),
  role: text("role").notNull().default("user"),
  plan: text("plan").notNull().default("free"),
  credits: integer("credits").notNull().default(20),
  totalCreditsUsed: integer("total_credits_used").notNull().default(0),
  language: text("language").notNull().default("zh"),
  onboardingCompleted: integer("onboarding_completed").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
