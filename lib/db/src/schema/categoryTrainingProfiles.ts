import { pgTable, text, integer, timestamp, jsonb, uniqueIndex, serial } from "drizzle-orm/pg-core";

/**
 * 多类目（platform × niche）全平台训练画像。
 * 跨用户聚合：所有用户已收集的 competitor_posts + 已发布 content 按 niche 维度沉淀，
 * 让每个新客户都能继承已有的"行业爆款规律"，越用越聪明。
 */
export const categoryTrainingProfilesTable = pgTable(
  "category_training_profiles",
  {
    id: serial("id").primaryKey(),
    platform: text("platform").notNull(),
    niche: text("niche").notNull(),
    // 高频/最热标签（去重，按出现次数 + 总互动量加权排序）
    topHashtags: jsonb("top_hashtags").$type<Array<{ tag: string; count: number; totalLikes: number }>>().notNull().default([]),
    // 高频钩子结构（标题模式分类，例：数字开头/反常识型/警告型）
    topTitlePatterns: jsonb("top_title_patterns").$type<Array<{ value: string; count: number }>>().notNull().default([]),
    // 优秀样本标题（按互动量 Top）
    topTitles: jsonb("top_titles").$type<Array<{ title: string; likes: number; views: number; source: string }>>().notNull().default([]),
    // 高频 BGM（视频类目）
    topMusic: jsonb("top_music").$type<Array<{ name: string; count: number }>>().notNull().default([]),
    // 平均时长（视频）/ 平均字数（图文）
    avgDuration: integer("avg_duration"),
    avgBodyLength: integer("avg_body_length"),
    avgTagCount: integer("avg_tag_count"),
    // 数据来源拆分（透明度）
    sampleSize: integer("sample_size").notNull().default(0),
    competitorPostsAnalyzed: integer("competitor_posts_analyzed").notNull().default(0),
    userContentAnalyzed: integer("user_content_analyzed").notNull().default(0),
    contributingUsers: integer("contributing_users").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    platformNicheUniq: uniqueIndex("category_training_platform_niche_uniq").on(t.platform, t.niche),
  }),
);

export type CategoryTrainingProfile = typeof categoryTrainingProfilesTable.$inferSelect;
