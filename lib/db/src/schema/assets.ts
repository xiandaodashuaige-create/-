import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { accountsTable } from "./accounts";
import { usersTable } from "./users";

export const assetsTable = pgTable(
  "assets",
  {
    id: serial("id").primaryKey(),
    // 素材所有者：以 userId 做硬隔离（accountId 仅做可选归类）
    userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
    accountId: integer("account_id").references(() => accountsTable.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    filename: text("filename").notNull(),
    objectPath: text("object_path").notNull(),
    size: integer("size").notNull(),
    tags: text("tags").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("assets_user_id_idx").on(t.userId),
  })
);

export const insertAssetSchema = createInsertSchema(assetsTable).omit({ id: true, createdAt: true });
export type InsertAsset = z.infer<typeof insertAssetSchema>;
export type Asset = typeof assetsTable.$inferSelect;
