import { Router, type IRouter, type Request } from "express";
import { eq, and } from "drizzle-orm";
import { db, accountsTable } from "@workspace/db";
import * as MetaOAuth from "../lib/oauth/meta.js";
import * as TikTokOAuth from "../lib/oauth/tiktok.js";
import * as Ayrshare from "../lib/oauth/ayrshare.js";
import { ensureUser } from "../middlewares/creditSystem.js";
import { requireAuth } from "../middlewares/requireAuth.js";

// 仅 OAuth 回调路由（必须 public，浏览器跳转回来时无 Clerk 头）
export const oauthPublicRouter: IRouter = Router();
// 其他 OAuth 路由（status / connect / disconnect / sync）必须先过 requireAuth
const router: IRouter = Router();

function getBaseUrl(_req: Request): string {
  const domains = process.env["REPLIT_DOMAINS"];
  if (domains) return `https://${domains.split(",")[0].trim()}`;
  const dev = process.env["REPLIT_DEV_DOMAIN"];
  if (dev) return `https://${dev}`;
  return "http://localhost:80";
}

function htmlClose(title: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:system-ui;padding:40px;text-align:center">
${body}
<p style="color:#888;margin-top:24px">此页面将自动关闭…</p>
<script>setTimeout(()=>{try{window.opener&&window.opener.postMessage({type:'oauth-done'},'*')}catch(e){};window.close()},2500)</script>
</body></html>`;
}

async function upsertOAuthAccount(args: {
  ownerUserId: number;
  platform: "tiktok" | "facebook" | "instagram";
  platformAccountId: string;
  nickname: string;
  avatarUrl?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  region?: string;
}) {
  // 原子 UPSERT — 依赖 accounts_owner_platform_account_id_uniq 唯一索引
  const [row] = await db
    .insert(accountsTable)
    .values({
      ownerUserId: args.ownerUserId,
      platform: args.platform,
      platformAccountId: args.platformAccountId,
      region: args.region ?? "GLOBAL",
      nickname: args.nickname,
      avatarUrl: args.avatarUrl ?? null,
      oauthAccessToken: args.accessToken,
      oauthRefreshToken: args.refreshToken ?? null,
      oauthExpiresAt: args.expiresAt ?? null,
      authStatus: "authorized",
      status: "active",
    })
    .onConflictDoUpdate({
      target: [accountsTable.ownerUserId, accountsTable.platform, accountsTable.platformAccountId],
      set: {
        nickname: args.nickname,
        avatarUrl: args.avatarUrl ?? null,
        oauthAccessToken: args.accessToken,
        oauthRefreshToken: args.refreshToken ?? null,
        oauthExpiresAt: args.expiresAt ?? null,
        authStatus: "authorized",
        status: "active",
      },
    })
    .returning({ id: accountsTable.id });
  return row.id;
}

router.get("/oauth/status", async (req, res) => {
  const u = await ensureUser(req);
  if (!u) {
    res.json({
      authenticated: false,
      configured: { meta: MetaOAuth.isConfigured(), tiktok: TikTokOAuth.isConfigured(), ayrshare: Ayrshare.isConfigured() },
      connected: {},
    });
    return;
  }
  const rows = await db
    .select({
      id: accountsTable.id,
      platform: accountsTable.platform,
      nickname: accountsTable.nickname,
      platformAccountId: accountsTable.platformAccountId,
      authStatus: accountsTable.authStatus,
      oauthExpiresAt: accountsTable.oauthExpiresAt,
      ayrshareProfileKey: accountsTable.ayrshareProfileKey,
    })
    .from(accountsTable)
    .where(eq(accountsTable.ownerUserId, u.id));

  res.json({
    authenticated: true,
    configured: {
      meta: MetaOAuth.isConfigured(),
      tiktok: TikTokOAuth.isConfigured(),
      ayrshare: Ayrshare.isConfigured(),
      ayrshareDashboardUrl: Ayrshare.getDashboardUrl(),
    },
    connected: {
      facebook: rows.filter((r) => r.platform === "facebook" && r.authStatus === "authorized"),
      instagram: rows.filter((r) => r.platform === "instagram" && r.authStatus === "authorized"),
      tiktok: rows.filter((r) => r.platform === "tiktok" && r.authStatus === "authorized"),
    },
  });
});

router.get("/oauth/facebook/connect", async (req, res) => {
  const u = await ensureUser(req);
  if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const redirectUri = `${getBaseUrl(req)}/api/oauth/facebook/callback`;
    const state = MetaOAuth.generateOAuthState(u.id);
    const authUrl = MetaOAuth.buildAuthUrl(redirectUri, state);
    if (req.query["json"] === "1") { res.json({ authUrl, redirectUri }); return; }
    res.redirect(authUrl);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

oauthPublicRouter.get("/oauth/facebook/callback", async (req, res) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  if (error) { res.send(htmlClose("授权取消", `<h2>授权取消</h2><p>${error}</p>`)); return; }
  if (!code || !state) { res.status(400).send(htmlClose("缺参数", "<h2>缺少参数</h2>")); return; }
  const userId = MetaOAuth.consumeOAuthState(state);
  if (!userId) { res.status(400).send(htmlClose("过期", "<h2>授权已过期，请重新连接</h2>")); return; }

  try {
    const redirectUri = `${getBaseUrl(req)}/api/oauth/facebook/callback`;
    const { access_token: shortToken } = await MetaOAuth.exchangeCodeForToken(code, redirectUri);
    const longToken = await MetaOAuth.getLongLivedToken(shortToken);
    const pages = await MetaOAuth.getUserPages(longToken);

    const saved: string[] = [];
    for (const page of pages) {
      await upsertOAuthAccount({
        ownerUserId: userId,
        platform: "facebook",
        platformAccountId: page.id,
        nickname: page.name,
        accessToken: page.access_token,
      });
      saved.push(`Facebook: ${page.name}`);

      if (page.instagram_business_account?.id) {
        const igInfo = await MetaOAuth.getInstagramAccount(page.id, page.access_token);
        const igName = igInfo?.username ?? igInfo?.name ?? `ig_${page.instagram_business_account.id}`;
        await upsertOAuthAccount({
          ownerUserId: userId,
          platform: "instagram",
          platformAccountId: page.instagram_business_account.id,
          nickname: igName,
          accessToken: page.access_token,
        });
        saved.push(`Instagram: @${igName}`);
      }
    }
    res.send(htmlClose("授权成功", `<h2>✅ 授权成功！</h2><ul style="list-style:none;padding:0">${saved.map((s) => `<li>✅ ${s}</li>`).join("")}</ul>`));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Facebook OAuth callback failed");
    res.status(500).send(htmlClose("失败", `<h2>授权失败</h2><pre>${msg}</pre>`));
  }
});

router.get("/oauth/tiktok/connect", async (req, res) => {
  const u = await ensureUser(req);
  if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const redirectUri = `${getBaseUrl(req)}/api/oauth/tiktok/callback`;
    const state = TikTokOAuth.generateOAuthState(u.id);
    const authUrl = TikTokOAuth.buildAuthUrl(redirectUri, state);
    if (req.query["json"] === "1") { res.json({ authUrl, redirectUri }); return; }
    res.redirect(authUrl);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

oauthPublicRouter.get("/oauth/tiktok/callback", async (req, res) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  if (error) { res.send(htmlClose("取消", `<h2>授权取消</h2><p>${error}</p>`)); return; }
  if (!code || !state) { res.status(400).send(htmlClose("缺参数", "<h2>缺少参数</h2>")); return; }
  const userId = TikTokOAuth.consumeOAuthState(state);
  if (!userId) { res.status(400).send(htmlClose("过期", "<h2>授权已过期，请重新连接</h2>")); return; }

  try {
    const redirectUri = `${getBaseUrl(req)}/api/oauth/tiktok/callback`;
    const tokenData = await TikTokOAuth.exchangeCodeForToken(code, redirectUri);
    const userInfo = await TikTokOAuth.getUserInfo(tokenData.access_token);
    await upsertOAuthAccount({
      ownerUserId: userId,
      platform: "tiktok",
      platformAccountId: tokenData.open_id,
      nickname: userInfo.display_name,
      avatarUrl: userInfo.avatar_url,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
    });
    res.send(htmlClose("成功", `<h2>✅ TikTok 授权成功！</h2><p>已连接：<strong>@${userInfo.display_name}</strong></p>`));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "TikTok OAuth callback failed");
    res.status(500).send(htmlClose("失败", `<h2>TikTok 授权失败</h2><pre>${msg}</pre>`));
  }
});

router.post("/oauth/disconnect", async (req, res): Promise<void> => {
  const u = await ensureUser(req);
  if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { accountId } = req.body as { accountId?: number };
  if (!accountId) { res.status(400).json({ error: "accountId required" }); return; }
  await db
    .update(accountsTable)
    .set({
      oauthAccessToken: null,
      oauthRefreshToken: null,
      oauthExpiresAt: null,
      authStatus: "unauthorized",
    })
    .where(and(eq(accountsTable.id, accountId), eq(accountsTable.ownerUserId, u.id)));
  res.json({ success: true });
});

router.post("/oauth/ayrshare/sync", async (req, res): Promise<void> => {
  const u = await ensureUser(req);
  if (!u) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!Ayrshare.isConfigured()) { res.status(503).json({ error: "AYRSHARE_API_KEY 未配置" }); return; }
  const status = await Ayrshare.getLinkedPlatforms();
  const synced: string[] = [];
  for (const p of ["facebook", "instagram", "tiktok"] as const) {
    if (!status[p]) continue;
    const info = status.displayNames.find((d) => d.platform === p);
    const nickname = info?.displayName || info?.username || `${p} Account`;
    const platformAccountId = `ayrshare_${p}`;
    await upsertOAuthAccount({
      ownerUserId: u.id,
      platform: p,
      platformAccountId,
      nickname,
      avatarUrl: info?.userImage,
      accessToken: "ayrshare",
    });
    // mark ayrshareProfileKey="default" so dispatcher knows to route via Ayrshare
    await db
      .update(accountsTable)
      .set({ ayrshareProfileKey: "default" })
      .where(
        and(
          eq(accountsTable.ownerUserId, u.id),
          eq(accountsTable.platform, p),
          eq(accountsTable.platformAccountId, platformAccountId),
        ),
      );
    synced.push(`${p}: ${nickname}`);
  }
  res.json({ synced: synced.length, accounts: synced, dashboardUrl: Ayrshare.getDashboardUrl() });
});

// 给 status / connect / disconnect / sync 加上认证（防止匿名滥用）
router.use(requireAuth);
export default router;
