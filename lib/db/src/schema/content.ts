import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { accountsTable } from "./accounts";

export const contentTable = pgTable("content", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").references(() => accountsTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  originalReference: text("original_reference"),
  tags: text("tags").array().notNull().default([]),
  imageUrls: text("image_urls").array().notNull().default([]),
  videoUrl: text("video_url"),
  status: text("status").notNull().default("draft"),
  sensitivityScore: real("sensitivity_score"),
  sensitivityIssues: text("sensitivity_issues").array().notNull().default([]),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertContentSchema = createInsertSchema(contentTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertContent = z.infer<typeof insertContentSchema>;
export type Content = typeof contentTable.$inferSelect;
