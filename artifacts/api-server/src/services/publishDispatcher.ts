import { sql } from "drizzle-orm";
import { db, publishLogsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import * as MetaOAuth from "../lib/oauth/meta.js";
import * as TikTokOAuth from "../lib/oauth/tiktok.js";
import * as Ayrshare from "../lib/oauth/ayrshare.js";
import { decryptToken, encryptToken } from "../lib/crypto.js";

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

// 把每次发布尝试（成功 / 失败）落到独立 publish_logs 表，便于历史查询和分析
async function writePublishLog(args: {
  scheduleId: number;
  contentId: number | null;
  accountId: number | null;
  platform: string;
  attempt: number;
  status: "success" | "failed";
  postId?: string | null;
  errorMessage?: string | null;
  durationMs?: number;
}) {
  try {
    await db.insert(publishLogsTable).values({
      scheduleId: args.scheduleId,
      contentId: args.contentId ?? null,
      accountId: args.accountId ?? null,
      platform: args.platform,
      attempt: args.attempt,
      status: args.status,
      postId: args.postId ?? null,
      errorMessage: args.errorMessage ?? null,
      durationMs: args.durationMs ?? null,
    });
  } catch (e) {
    logger.warn({ err: e, scheduleId: args.scheduleId }, "publish_logs insert failed (non-fatal)");
  }
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

// 复用的账号"是否可以真发布"判定。XHS 走"标记已发"语义不需要 OAuth；
// 其他平台必须有 ayrshare profileKey 或 (authStatus=authorized + access_token)。
export interface AccountAuthShape {
  platform: string;
  authStatus?: string | null;
  oauthAccessToken?: string | null;
  ayrshareProfileKey?: string | null;
}
export function isAccountReadyToPublish(account: AccountAuthShape): boolean {
  if (account.platform === "xhs") return true;
  if (account.ayrshareProfileKey && account.ayrshareProfileKey.length > 0) return true;
  return account.authStatus === "authorized" && !!account.oauthAccessToken;
}

// 抽出"真正调外部 provider"的纯逻辑，cron dispatcher 和 manual /content/:id/publish 路由共用。
// 不读不写 schedules / content / publish_logs 表，调用方负责状态维护和日志。
export interface DispatchInput {
  platform: string;
  accountId: number;
  title: string;
  body: string;
  imageUrls: string[] | null;
  videoUrl: string | null;
  oauthAccessToken: string | null;
  oauthRefreshToken: string | null;
  oauthExpiresAt: Date | string | null;
  platformAccountId: string | null;
  ayrshareProfileKey: string | null;
}
export type DispatchResult =
  | { success: true; postId: string }
  | { success: false; errorMessage: string };

// 把相对路径（/api/storage/...）补成绝对 https URL，否则 TT/FB/IG 拉不到媒体。
// 优先用 REPLIT_DOMAINS 第一个域名（生产 / preview 都是 https）；本地 dev 时降级到 localhost（仅日志告警，外部 API 一定失败）。
function toAbsoluteUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  const host = (process.env.REPLIT_DOMAINS ?? "").split(",")[0]?.trim();
  if (!host) {
    logger.warn({ url: u }, "REPLIT_DOMAINS 未设置，无法将相对媒体 URL 转绝对，外部 API 必然失败");
    return u; // 让外部 API 报真错，不偷偷吞
  }
  const path = u.startsWith("/") ? u : `/${u}`;
  return `https://${host}${path}`;
}

export async function dispatchContentToProvider(input: DispatchInput): Promise<DispatchResult> {
  const useAyrshare = !!input.ayrshareProfileKey && Ayrshare.isConfigured();
  const absVideoUrl = toAbsoluteUrl(input.videoUrl);
  const absImageUrls = input.imageUrls ? input.imageUrls.map(toAbsoluteUrl).filter((u): u is string => !!u) : null;
  const mediaUrl = absVideoUrl || (absImageUrls && absImageUrls[0]) || null;
  const isVideo = !!absVideoUrl;
  const caption = input.title ? `${input.title}\n\n${input.body}` : input.body;

  try {
    if (useAyrshare) {
      if (!mediaUrl) return { success: false, errorMessage: "无媒体（视频或图片）可发布" };
      const result = await Ayrshare.publishToSocial({
        platforms: [input.platform as Ayrshare.AyrsharePlatform],
        mediaUrls: [mediaUrl],
        caption,
        isVideo,
        profileKey:
          input.ayrshareProfileKey && input.ayrshareProfileKey !== "default"
            ? input.ayrshareProfileKey
            : undefined,
      });
      if (!result.success) return { success: false, errorMessage: result.errorMessage || "Ayrshare publish failed" };
      return { success: true, postId: result.postId || "ayrshare" };
    }

    if (input.platform === "tiktok") {
      if (!input.oauthAccessToken) return { success: false, errorMessage: "TikTok 未授权 (oauth_access_token 为空)" };
      if (!absVideoUrl) return { success: false, errorMessage: "TikTok 必须有视频 URL" };
      let accessToken = decryptToken(input.oauthAccessToken);
      if (!accessToken) return { success: false, errorMessage: "TikTok access_token 解密失败" };
      const refreshTokenPlain = decryptToken(input.oauthRefreshToken);
      const expiresAt = input.oauthExpiresAt ? new Date(input.oauthExpiresAt).getTime() : 0;
      if (refreshTokenPlain && expiresAt > 0 && expiresAt - Date.now() < 5 * 60 * 1000) {
        try {
          const refreshed = await TikTokOAuth.refreshAccessToken(refreshTokenPlain);
          accessToken = refreshed.access_token;
          await db.execute(sql`
            UPDATE accounts
            SET oauth_access_token=${encryptToken(refreshed.access_token)},
                oauth_refresh_token=${encryptToken(refreshed.refresh_token)},
                oauth_expires_at=${new Date(Date.now() + refreshed.expires_in * 1000)}
            WHERE id=${input.accountId}
          `);
          logger.info({ accountId: input.accountId }, "TikTok token refreshed before publish");
        } catch (e) {
          logger.warn({ err: e, accountId: input.accountId }, "TikTok token refresh failed, trying with stale token");
        }
      }
      const result = await TikTokOAuth.publishVideoToTikTok(accessToken, absVideoUrl, input.title);
      return { success: true, postId: result.publish_id };
    }

    if (input.platform === "facebook") {
      if (!input.oauthAccessToken || !input.platformAccountId) return { success: false, errorMessage: "Facebook 未授权（缺少 token 或 page id）" };
      const fbToken = decryptToken(input.oauthAccessToken);
      if (!fbToken) return { success: false, errorMessage: "Facebook access_token 解密失败" };
      const img = absImageUrls && absImageUrls[0];
      const result = await MetaOAuth.publishToFacebookPage(
        input.platformAccountId,
        fbToken,
        caption,
        img || undefined,
      );
      return { success: true, postId: result.id };
    }

    if (input.platform === "instagram") {
      if (!input.oauthAccessToken || !input.platformAccountId) return { success: false, errorMessage: "Instagram 未授权（缺少 token 或 ig user id）" };
      const igToken = decryptToken(input.oauthAccessToken);
      if (!igToken) return { success: false, errorMessage: "Instagram access_token 解密失败" };
      const img = absImageUrls && absImageUrls[0];
      if (!img && !absVideoUrl) return { success: false, errorMessage: "Instagram 必须有至少 1 张图片或 1 个视频 URL" };
      const result = await MetaOAuth.publishToInstagram(
        input.platformAccountId,
        igToken,
        caption,
        absVideoUrl ? { videoUrl: absVideoUrl } : { imageUrl: img! },
      );
      return { success: true, postId: result.id };
    }

    return { success: false, errorMessage: `不支持的平台: ${input.platform}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, errorMessage: msg };
  }
}

async function publishOne(row: DueRow): Promise<void> {
  const startedAt = Date.now();
  const attempt = (row.retry_count ?? 0) + 1;

  const result = await dispatchContentToProvider({
    platform: row.platform,
    accountId: row.account_id,
    title: row.title,
    body: row.body,
    imageUrls: row.image_urls,
    videoUrl: row.video_url,
    oauthAccessToken: row.oauth_access_token,
    oauthRefreshToken: row.oauth_refresh_token,
    oauthExpiresAt: row.oauth_expires_at,
    platformAccountId: row.platform_account_id,
    ayrshareProfileKey: row.ayrshare_profile_key,
  });

  if (result.success) {
    await markPublished(row.schedule_id, row.content_id, result.postId);
    await writePublishLog({
      scheduleId: row.schedule_id, contentId: row.content_id, accountId: row.account_id,
      platform: row.platform, attempt, status: "success", postId: result.postId,
      durationMs: Date.now() - startedAt,
    });
    logger.info({ scheduleId: row.schedule_id, platform: row.platform, postId: result.postId }, "Published");
  } else {
    logger.error({ err: result.errorMessage, scheduleId: row.schedule_id, platform: row.platform, retryCount: row.retry_count }, "Publish failed");
    await markFailed(row.schedule_id, row.retry_count ?? 0, result.errorMessage);
    await writePublishLog({
      scheduleId: row.schedule_id, contentId: row.content_id, accountId: row.account_id,
      platform: row.platform, attempt, status: "failed", errorMessage: result.errorMessage,
      durationMs: Date.now() - startedAt,
    });
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
