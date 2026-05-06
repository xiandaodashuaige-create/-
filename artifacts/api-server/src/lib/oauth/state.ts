import { sql } from "drizzle-orm";
import { db, oauthStatesTable } from "@workspace/db";
import { logger } from "../logger.js";

const STATE_TTL_MS = 10 * 60 * 1000;

export async function generateState(userId: number, platform: string): Promise<string> {
  const state = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + STATE_TTL_MS);
  await db.insert(oauthStatesTable).values({ state, ownerUserId: userId, platform, expiresAt });
  return state;
}

// 一次性消费：原子 UPDATE ... WHERE consumed_at IS NULL AND expires_at > NOW() RETURNING owner_user_id
// 防重放（同一个 state 第二次调用返回 null）+ 防过期
export async function consumeState(state: string, platform: string): Promise<number | null> {
  try {
    const res = await db.execute(sql`
      UPDATE oauth_states
      SET consumed_at = NOW()
      WHERE state = ${state}
        AND platform = ${platform}
        AND consumed_at IS NULL
        AND expires_at > NOW()
      RETURNING owner_user_id
    `);
    const row = (res.rows as Array<{ owner_user_id: number }>)[0];
    return row?.owner_user_id ?? null;
  } catch (err) {
    logger.error({ err, state, platform }, "consumeState failed");
    return null;
  }
}

// 周期性清理已过期 state（cron 调用）
export async function cleanupExpiredStates(): Promise<number> {
  const res = await db.execute(sql`
    DELETE FROM oauth_states WHERE expires_at < NOW() - INTERVAL '1 hour'
  `);
  return res.rowCount ?? 0;
}
