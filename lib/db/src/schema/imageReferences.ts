import { pgTable, serial, text, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const imageReferencesTable = pgTable("image_references", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  refImageUrl: text("ref_image_url").notNull(),
  analysisJson: jsonb("analysis_json"),
  generatedImageUrl: text("generated_image_url"),
  generatedObjectPath: text("generated_object_path"),
  promptUsed: text("prompt_used"),
  layout: text("layout").notNull().default("single"),
  mimicStrength: text("mimic_strength").notNull().default("partial"),
  provider: text("provider"),
  topic: text("topic"),
  rating: integer("rating"),
  accepted: boolean("accepted").notNull().default(false),
  feedbackText: text("feedback_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ImageReference = typeof imageReferencesTable.$inferSelect;
export type InsertImageReference = typeof imageReferencesTable.$inferInsert;
