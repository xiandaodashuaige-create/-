import { pgTable, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const oauthStatesTable = pgTable(
  "oauth_states",
  {
    state: text("state").primaryKey(),
    ownerUserId: integer("owner_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_oauth_states_expires").on(t.expiresAt)],
);

export type OAuthState = typeof oauthStatesTable.$inferSelect;
