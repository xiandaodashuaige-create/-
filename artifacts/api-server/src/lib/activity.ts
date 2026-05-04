import { db, activityLogTable } from "@workspace/db";

export async function logActivity(
  type: string,
  description: string,
  contentId?: number,
  accountId?: number
): Promise<void> {
  await db.insert(activityLogTable).values({
    type,
    description,
    contentId: contentId ?? null,
    accountId: accountId ?? null,
  });
}
