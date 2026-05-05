import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const accountsTable = pgTable("accounts", {
  id: serial("id").primaryKey(),
  ownerUserId: integer("owner_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  // platform 维度：xhs | tiktok | instagram | facebook（默认 xhs，向后兼容）
  platform: text("platform").notNull().default("xhs"),
  nickname: text("nickname").notNull(),
  region: text("region").notNull(),
  avatarUrl: text("avatar_url"),
  xhsId: text("xhs_id"),
  // 平台账号唯一标识（小红书继续用 xhsId；其他平台用 platformAccountId）
  platformAccountId: text("platform_account_id"),
  authStatus: text("auth_status").notNull().default("unauthorized"),
  // OAuth 凭证（仅 tiktok/meta 等支持 API 发布的平台使用，小红书留空）
  oauthAccessToken: text("oauth_access_token"),
  oauthRefreshToken: text("oauth_refresh_token"),
  oauthExpiresAt: timestamp("oauth_expires_at", { withTimezone: true }),
  // 第三方发布服务的账号 ID（如 ayrsharePostProfileKey），便于 Ayrshare 多账号管理
  ayrshareProfileKey: text("ayrshare_profile_key"),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  contentCount: integer("content_count").notNull().default(0),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAccountSchema = createInsertSchema(accountsTable).omit({ id: true, createdAt: true, updatedAt: true, contentCount: true, ownerUserId: true });
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accountsTable.$inferSelect;
