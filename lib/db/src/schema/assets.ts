import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { accountsTable } from "./accounts";

export const assetsTable = pgTable("assets", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").references(() => accountsTable.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  filename: text("filename").notNull(),
  objectPath: text("object_path").notNull(),
  size: integer("size").notNull(),
  tags: text("tags").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAssetSchema = createInsertSchema(assetsTable).omit({ id: true, createdAt: true });
export type InsertAsset = z.infer<typeof insertAssetSchema>;
export type Asset = typeof assetsTable.$inferSelect;
