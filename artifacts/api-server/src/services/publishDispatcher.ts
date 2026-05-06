import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "../lib/logger.js";
import * as MetaOAuth from "../lib/oauth/meta.js";
import * as TikTokOAuth from "../lib/oauth/tiktok.js";
import * as Ayrshare from "../lib/oauth/ayrshare.js";

interface DueRow {
  schedule_id: number;
  platform: string;
  account_id: number;
  content_id: number;
  title: string;
  body: string;
  image_urls: string[] | null;
  video_url: string | null;
  oauth_access_token: string | null;
  oauth_refresh_token: string | null;
  oauth_expires_at: string | null;
  platform_account_id: string | null;
  ayrshare_profile_key: string | null;
  retry_count: number;
}

const MAX_RETRIES = 3;

async function findDueSchedules(): Promise<DueRow[]> {
  // 原子认领：把到期 pending 行翻成 publishing，防止下一个 cron tick（IG 视频可能轮询 5 分钟）重复发布
  const rows = await db.execute(sql`
    WITH due AS (
      SELECT id FROM schedules
      WHERE status = 'pending'
        AND scheduled_at <= NOW()
        AND platform IN ('tiktok','instagram','facebook')
      ORDER BY scheduled_at ASC
      LIMIT 20
      FOR UPDATE SKIP LOCKED
    ),
    claimed AS (
      UPDATE schedules SET status = 'publishing'
      WHERE id IN (SELECT id FROM due)
      RETURNING id
    )
    SELECT
      s.id AS schedule_id, s.platform, s.account_id, s.content_id, s.retry_count,
      c.title, c.body, c.image_urls, c.video_url,
      a.oauth_access_token, a.oauth_refresh_token, a.oauth_expires_at,
      a.platform_account_id, a.ayrshare_profile_key
    FROM schedules s
    INNER JOIN content c ON s.content_id = c.id
    INNER JOIN accounts a ON s.account_id = a.id
    WHERE s.id IN (SELECT id FROM claimed)
    ORDER BY s.scheduled_at ASC
  `);
  return rows.rows as unknown as DueRow[];
}

async function markPublished(scheduleId: number, contentId: number, remotePostId: string) {
  // 状态护栏：只允许从 'publishing' 翻到 'published'。防止"远端已发成功 + content UPDATE 失败"
  // 后被外层 catch → markFailed 覆盖回 pending 触发重复发布
  await db.execute(sql`
    UPDATE schedules SET status='published', remote_post_id=${remotePostId}, error_message=NULL
    WHERE id=${scheduleId} AND status='publishing'
  `);
  await db.execute(sql`UPDATE content SET status='published' WHERE id=${contentId}`);
}

async function markFailed(scheduleId: number, _currentRetryCount: number, errorMessage: string) {
  // 状态护栏 + 原子自增：retry_count = retry_count + 1，用 DB 端的 CASE 判定 failed/pending
  // 不再依赖应用层读出的 currentRetryCount，避免多实例 / 重入时丢计数
  // 状态护栏：只对 'publishing' 行回滚，防止覆盖已经被 markPublished 提升为 'published' 的行
  await db.execute(sql`
    UPDATE schedules
    SET retry_count = retry_count + 1,
        status = CASE WHEN retry_count + 1 >= ${MAX_RETRIES} THEN 'failed' ELSE 'pending' END,
        error_message = ${errorMessage}
    WHERE id = ${scheduleId} AND status = 'publishing'
  `);
}

async function publishOne(row: DueRow): Promise<void> {
  const useAyrshare = !!row.ayrshare_profile_key && Ayrshare.isConfigured();

  // Pick first available media URL (prefer video for TikTok)
  const mediaUrl = row.video_url || (row.image_urls && row.image_urls[0]) || null;
  const isVideo = !!row.video_url;
  const caption = row.title ? `${row.title}\n\n${row.body}` : row.body;

  try {
    if (useAyrshare) {
      if (!mediaUrl) throw new Error("无媒体（视频或图片）可发布");
      const result = await Ayrshare.publishToSocial({
        platforms: [row.platform as Ayrshare.AyrsharePlatform],
        mediaUrls: [mediaUrl],
        caption,
        isVideo,
        // 多账号场景必须透传 profileKey，否则 Ayrshare 会发到默认 profile
        profileKey: row.ayrshare_profile_key ?? undefined,
      });
      if (!result.success) throw new Error(result.errorMessage || "Ayrshare publish failed");
      await markPublished(row.schedule_id, row.content_id, result.postId || "ayrshare");
      logger.info({ scheduleId: row.schedule_id, platform: row.platform, postId: result.postId }, "Published via Ayrshare");
      return;
    }

    if (row.platform === "tiktok") {
      if (!row.oauth_access_token) throw new Error("TikTok 未授权 (oauth_access_token 为空)");
      if (!row.video_url) throw new Error("TikTok 必须有视频 URL");
      // 自动刷新即将过期的 token（剩余 < 5 分钟）
      let accessToken = row.oauth_access_token;
      const expiresAt = row.oauth_expires_at ? new Date(row.oauth_expires_at).getTime() : 0;
      if (row.oauth_refresh_token && expiresAt > 0 && expiresAt - Date.now() < 5 * 60 * 1000) {
        try {
          const refreshed = await TikTokOAuth.refreshAccessToken(row.oauth_refresh_token);
          accessToken = refreshed.access_token;
          await db.execute(sql`
            UPDATE accounts
            SET oauth_access_token=${refreshed.access_token},
                oauth_refresh_token=${refreshed.refresh_token},
                oauth_expires_at=${new Date(Date.now() + refreshed.expires_in * 1000)}
            WHERE id=${row.account_id}
          `);
          logger.info({ accountId: row.account_id }, "TikTok token refreshed before publish");
        } catch (e) {
          logger.warn({ err: e, accountId: row.account_id }, "TikTok token refresh failed, trying with stale token");
        }
      }
      const result = await TikTokOAuth.publishVideoToTikTok(accessToken, row.video_url, row.title);
      await markPublished(row.schedule_id, row.content_id, result.publish_id);
      logger.info({ scheduleId: row.schedule_id, mode: result.mode, publishId: result.publish_id }, "TikTok publish initiated");
      return;
    }

    if (row.platform === "facebook") {
      if (!row.oauth_access_token || !row.platform_account_id) throw new Error("Facebook 未授权");
      const img = row.image_urls && row.image_urls[0];
      const result = await MetaOAuth.publishToFacebookPage(
        row.platform_account_id,
        row.oauth_access_token,
        caption,
        img || undefined,
      );
      await markPublished(row.schedule_id, row.content_id, result.id);
      logger.info({ scheduleId: row.schedule_id, postId: result.id }, "Facebook published");
      return;
    }

    if (row.platform === "instagram") {
      if (!row.oauth_access_token || !row.platform_account_id) throw new Error("Instagram 未授权");
      const img = row.image_urls && row.image_urls[0];
      if (!img && !row.video_url) throw new Error("Instagram 必须有至少 1 张图片或 1 个视频 URL");
      const result = await MetaOAuth.publishToInstagram(
        row.platform_account_id,
        row.oauth_access_token,
        caption,
        row.video_url ? { videoUrl: row.video_url } : { imageUrl: img },
      );
      await markPublished(row.schedule_id, row.content_id, result.id);
      logger.info({ scheduleId: row.schedule_id, postId: result.id }, "Instagram published");
      return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg, scheduleId: row.schedule_id, platform: row.platform, retryCount: row.retry_count }, "Publish failed");
    await markFailed(row.schedule_id, row.retry_count ?? 0, msg);
  }
}

// 释放 stale 'publishing' 行（服务器在发布中崩溃时遗留）：>15 分钟翻回 pending，让下一 tick 重试
async function recoverStalePublishing(): Promise<void> {
  await db.execute(sql`
    UPDATE schedules
    SET status='pending',
        error_message=COALESCE(error_message,'') || ' | recovered_from_publishing_at=' || extract(epoch from now())::text
    WHERE status='publishing'
      AND scheduled_at < NOW() - INTERVAL '15 minutes'
  `);
}

let isRunning = false;
export async function runPublishDispatcher(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  const startedAt = Date.now();
  try { await recoverStalePublishing(); } catch (e) { logger.warn({ err: e }, "recoverStalePublishing failed"); }
  try {
    const due = await findDueSchedules();
    if (due.length === 0) return;
    logger.info({ count: due.length }, "Publish dispatcher tick");
    for (const row of due) {
      await publishOne(row);
    }
  } catch (e: unknown) {
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "Publish dispatcher error");
  } finally {
    isRunning = false;
    logger.debug({ durationMs: Date.now() - startedAt }, "Publish dispatcher done");
  }
}
