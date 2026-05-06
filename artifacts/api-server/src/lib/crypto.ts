import crypto from "node:crypto";
import { logger } from "./logger.js";

const PREFIX = "enc:v1:";
const RAW = process.env.OAUTH_TOKEN_ENCRYPTION_KEY || "";

function deriveKey(): Buffer | null {
  if (!RAW) return null;
  if (/^[0-9a-fA-F]{64}$/.test(RAW)) return Buffer.from(RAW, "hex");
  if (RAW.length >= 32) {
    return crypto.createHash("sha256").update(RAW, "utf-8").digest();
  }
  return null;
}

const KEY = deriveKey();

if (!KEY) {
  if (process.env.NODE_ENV === "production") {
    // 生产 fail-closed：拒绝在无密钥的情况下启动，避免 token 静默落明文
    throw new Error(
      "OAUTH_TOKEN_ENCRYPTION_KEY 未配置 — 生产环境必须设置 32 字节 hex 密钥才能启动",
    );
  }
  logger.warn(
    "OAUTH_TOKEN_ENCRYPTION_KEY 未配置或长度不足 32 字符 — OAuth token 将以明文存储（仅 dev 允许）",
  );
}

export function isEncryptionConfigured(): boolean {
  return KEY !== null;
}

export function encryptToken(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain === "") return null;
  if (plain.startsWith(PREFIX)) return plain;
  if (!KEY) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptToken(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith(PREFIX)) return stored;
  if (!KEY) {
    logger.error("发现加密 token 但 OAUTH_TOKEN_ENCRYPTION_KEY 未配置 — 无法解密");
    return null;
  }
  try {
    const parts = stored.slice(PREFIX.length).split(":");
    if (parts.length !== 3) throw new Error("malformed ciphertext");
    const [ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64!, "base64");
    const tag = Buffer.from(tagB64!, "base64");
    const data = Buffer.from(dataB64!, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return dec.toString("utf-8");
  } catch (e) {
    logger.error({ err: e }, "OAuth token 解密失败");
    return null;
  }
}
