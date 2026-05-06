// TikTok 数据提供商切换器（替代单一 TikHub 硬编码）
//
// 当前默认使用 TikHub。其他三家（EchoTik / Kalodata / FastMoss）需要付费订阅 +
// 各自的 API key。要启用：
//   1. 设置环境变量 TIKTOK_DATA_PROVIDER = echotik | kalodata | fastmoss
//   2. 实现对应 .ts 文件中的 fetchProfile / fetchUserPosts 等函数
//   3. 重启 API Server
//
// 已有 routes/competitors.ts 调用 tikhubScraper 的代码不强制改造 — 此切换器
// 提供未来重构的钩子，不破坏现有流程。
import * as tikhub from "../tikhubScraper.js";
import * as echotik from "./echotik.js";
import * as fastmoss from "./fastmoss.js";
import * as kalodata from "./kalodata.js";

export type TikTokProvider = "tikhub" | "echotik" | "fastmoss" | "kalodata";

export function getActiveProvider(): TikTokProvider {
  const v = (process.env.TIKTOK_DATA_PROVIDER || "tikhub").toLowerCase();
  if (v === "echotik" || v === "fastmoss" || v === "kalodata") return v;
  return "tikhub";
}

export async function fetchProfile(handle: string) {
  const p = getActiveProvider();
  switch (p) {
    case "tikhub":
      return tikhub.fetchTikTokProfile(handle);
    case "echotik":
      return echotik.fetchProfile(handle);
    case "fastmoss":
      return fastmoss.fetchProfile(handle);
    case "kalodata":
      return kalodata.fetchProfile(handle);
  }
}

export async function fetchUserPosts(secUidOrHandle: string, count = 12) {
  const p = getActiveProvider();
  switch (p) {
    case "tikhub":
      return tikhub.fetchTikTokUserVideos(secUidOrHandle, count);
    case "echotik":
      return echotik.fetchUserPosts(secUidOrHandle, count);
    case "fastmoss":
      return fastmoss.fetchUserPosts(secUidOrHandle, count);
    case "kalodata":
      return kalodata.fetchUserPosts(secUidOrHandle, count);
  }
}

export function isProviderConfigured(p?: TikTokProvider): boolean {
  const target = p || getActiveProvider();
  switch (target) {
    case "tikhub":
      return tikhub.isTikHubConfigured();
    case "echotik":
      return !!process.env.ECHOTIK_API_KEY;
    case "fastmoss":
      return !!process.env.FASTMOSS_API_KEY;
    case "kalodata":
      return !!process.env.KALODATA_API_KEY;
  }
}
