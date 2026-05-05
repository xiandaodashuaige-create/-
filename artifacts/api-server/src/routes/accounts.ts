import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
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

router.get("/accounts", async (req, res): Promise<void> => {
  try {
    const query = ListAccountsQueryParams.safeParse(req.query);
    const conditions = [];

    if (query.success) {
      if (query.data.region && query.data.region !== "ALL") {
        conditions.push(eq(accountsTable.region, query.data.region));
      }
      if (query.data.status && query.data.status !== "all") {
        conditions.push(eq(accountsTable.status, query.data.status));
      }
    }

    let accounts;
    if (conditions.length > 0) {
      accounts = await db
        .select()
        .from(accountsTable)
        .where(conditions.length === 1 ? conditions[0] : and(...conditions))
        .orderBy(accountsTable.createdAt);
    } else {
      accounts = await db.select().from(accountsTable).orderBy(accountsTable.createdAt);
    }

    res.json(ListAccountsResponse.parse(accounts));
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
    const [account] = await db
      .insert(accountsTable)
      .values({ ...parsed.data, ownerUserId: u?.id ?? null })
      .returning();
    await logActivity("account_added", `Added account: ${account.nickname} (${account.region})`, undefined, account.id);
    res.status(201).json(GetAccountResponse.parse(account));
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

    const [account] = await db
      .select()
      .from(accountsTable)
      .where(eq(accountsTable.id, params.data.id));

    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    res.json(GetAccountResponse.parse(account));
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

    const [account] = await db
      .update(accountsTable)
      .set(parsed.data)
      .where(eq(accountsTable.id, params.data.id))
      .returning();

    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    res.json(UpdateAccountResponse.parse(account));
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

    const [account] = await db
      .delete(accountsTable)
      .where(eq(accountsTable.id, params.data.id))
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
