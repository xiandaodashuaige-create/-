import { Router, type IRouter } from "express";
import { eq, and, type SQL } from "drizzle-orm";
import { db, accountsTable } from "@workspace/db";
import { ensureUser } from "../middlewares/creditSystem";
import {
  CreateAccountBody,
  GetAccountParams,
  GetAccountResponse,
  ListAccountsQueryParams,
  ListAccountsResponse,
  UpdateAccountParams,
  UpdateAccountBody,
  UpdateAccountResponse,
  DeleteAccountParams,
} from "@workspace/api-zod";
import { logActivity } from "../lib/activity";

const router: IRouter = Router();

// 把 DB 行映射成 API Account（剥离 oauth token 等敏感字段）
function toAccountResponse(a: typeof accountsTable.$inferSelect) {
  return {
    id: a.id,
    platform: a.platform,
    nickname: a.nickname,
    region: a.region,
    avatarUrl: a.avatarUrl,
    status: a.status,
    notes: a.notes,
    xhsId: a.xhsId,
    platformAccountId: a.platformAccountId,
    authStatus: a.authStatus,
    ayrshareProfileKey: a.ayrshareProfileKey,
    contentCount: a.contentCount,
    lastActiveAt: a.lastActiveAt,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

router.get("/accounts", async (req, res): Promise<void> => {
  try {
    const u = await ensureUser(req);
    if (!u) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const query = ListAccountsQueryParams.safeParse(req.query);
    const conditions: SQL[] = [eq(accountsTable.ownerUserId, u.id)];

    if (query.success) {
      if (query.data.platform && query.data.platform !== "ALL") {
        conditions.push(eq(accountsTable.platform, query.data.platform));
      }
      if (query.data.region && query.data.region !== "ALL") {
        conditions.push(eq(accountsTable.region, query.data.region));
      }
      if (query.data.status && query.data.status !== "all") {
        conditions.push(eq(accountsTable.status, query.data.status));
      }
    }

    const accounts = await db
      .select()
      .from(accountsTable)
      .where(and(...conditions))
      .orderBy(accountsTable.createdAt);

    res.json(ListAccountsResponse.parse(accounts.map(toAccountResponse)));
  } catch (err) {
    req.log.error(err, "Failed to list accounts");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/accounts", async (req, res): Promise<void> => {
  try {
    const parsed = CreateAccountBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const u = await ensureUser(req);
    if (!u) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const platform = parsed.data.platform || "xhs";
    const [account] = await db
      .insert(accountsTable)
      .values({
        ...parsed.data,
        platform,
        ownerUserId: u.id,
      })
      .returning();
    await logActivity("account_added", `Added ${platform} account: ${account.nickname} (${account.region})`, undefined, account.id);
    res.status(201).json(GetAccountResponse.parse(toAccountResponse(account)));
  } catch (err) {
    req.log.error(err, "Failed to create account");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/accounts/:id", async (req, res): Promise<void> => {
  try {
    const params = GetAccountParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const u = await ensureUser(req);
    if (!u) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const [account] = await db
      .select()
      .from(accountsTable)
      .where(and(eq(accountsTable.id, params.data.id), eq(accountsTable.ownerUserId, u.id)));

    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    res.json(GetAccountResponse.parse(toAccountResponse(account)));
  } catch (err) {
    req.log.error(err, "Failed to get account");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/accounts/:id", async (req, res): Promise<void> => {
  try {
    const params = UpdateAccountParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const parsed = UpdateAccountBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const u = await ensureUser(req);
    if (!u) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const [account] = await db
      .update(accountsTable)
      .set(parsed.data)
      .where(and(eq(accountsTable.id, params.data.id), eq(accountsTable.ownerUserId, u.id)))
      .returning();

    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    res.json(UpdateAccountResponse.parse(toAccountResponse(account)));
  } catch (err) {
    req.log.error(err, "Failed to update account");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/accounts/:id", async (req, res): Promise<void> => {
  try {
    const params = DeleteAccountParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const u = await ensureUser(req);
    if (!u) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const [account] = await db
      .delete(accountsTable)
      .where(and(eq(accountsTable.id, params.data.id), eq(accountsTable.ownerUserId, u.id)))
      .returning();

    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    res.sendStatus(204);
  } catch (err) {
    req.log.error(err, "Failed to delete account");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
