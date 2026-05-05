import { db, imageReferencesTable, userStyleProfilesTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import type { UserStyleProfile as PromptStyleProfile } from "./imagePipeline.js";

const MAX_SAMPLES = 50;

function topN<T>(items: T[], n: number): T[] {
  const counts = new Map<string, number>();
  const repr = new Map<string, T>();
  for (const item of items) {
    const key = String(item).toLowerCase().trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
    if (!repr.has(key)) repr.set(key, item);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => repr.get(k)!)
    .filter(Boolean);
}

/**
 * Recompute and persist a user's style profile from their accepted image references.
 */
export async function recomputeUserStyleProfile(userId: number): Promise<void> {
  const rows = await db
    .select()
    .from(imageReferencesTable)
    .where(and(eq(imageReferencesTable.userId, userId), eq(imageReferencesTable.accepted, true)))
    .orderBy(desc(imageReferencesTable.createdAt))
    .limit(MAX_SAMPLES);

  if (rows.length === 0) {
    await db
      .insert(userStyleProfilesTable)
      .values({
        userId,
        dominantColors: [],
        preferredLayouts: [],
        preferredFonts: [],
        preferredEmojis: [],
        preferredMoods: [],
        sampleSize: 0,
      })
      .onConflictDoUpdate({
        target: userStyleProfilesTable.userId,
        set: {
          dominantColors: [],
          preferredLayouts: [],
          preferredFonts: [],
          preferredEmojis: [],
          preferredMoods: [],
          sampleSize: 0,
        },
      });
    return;
  }

  const colors: string[] = [];
  const layouts: string[] = [];
  const fonts: string[] = [];
  const emojis: string[] = [];
  const moods: string[] = [];

  for (const row of rows) {
    const a: any = row.analysisJson || {};
    if (Array.isArray(a.mainColors)) colors.push(...a.mainColors);
    if (typeof a.layoutType === "string") layouts.push(a.layoutType);
    if (row.layout) layouts.push(row.layout);
    if (typeof a.textStyleDetail === "string" && a.textStyleDetail) fonts.push(a.textStyleDetail);
    if (Array.isArray(a.emojis)) emojis.push(...a.emojis);
    if (typeof a.mood === "string" && a.mood) moods.push(a.mood);
  }

  const profile = {
    userId,
    dominantColors: topN(colors, 5),
    preferredLayouts: topN(layouts, 5),
    preferredFonts: topN(fonts, 3),
    preferredEmojis: topN(emojis, 8),
    preferredMoods: topN(moods, 3),
    sampleSize: rows.length,
  };

  await db
    .insert(userStyleProfilesTable)
    .values(profile)
    .onConflictDoUpdate({
      target: userStyleProfilesTable.userId,
      set: {
        dominantColors: profile.dominantColors,
        preferredLayouts: profile.preferredLayouts,
        preferredFonts: profile.preferredFonts,
        preferredEmojis: profile.preferredEmojis,
        preferredMoods: profile.preferredMoods,
        sampleSize: profile.sampleSize,
      },
    });
}

/**
 * Load a user's style profile in the shape expected by imagePipeline.
 */
export async function loadStyleProfileForPrompt(userId: number): Promise<PromptStyleProfile | null> {
  const rows = await db
    .select()
    .from(userStyleProfilesTable)
    .where(eq(userStyleProfilesTable.userId, userId))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    dominantColors: (r.dominantColors as string[]) || [],
    preferredLayouts: (r.preferredLayouts as string[]) || [],
    preferredFonts: (r.preferredFonts as string[]) || [],
    preferredEmojis: (r.preferredEmojis as string[]) || [],
    preferredMoods: (r.preferredMoods as string[]) || [],
    sampleSize: r.sampleSize || 0,
  };
}
