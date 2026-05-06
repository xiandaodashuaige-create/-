// Kalodata 适配器 — 需要 KALODATA_API_KEY 才能启用
// 文档：https://www.kalodata.com (需付费订阅)
function notConfigured(): never {
  throw new Error("Kalodata provider 未实现 — 请订阅 Kalodata 并设置 KALODATA_API_KEY，然后实现 services/tiktokProviders/kalodata.ts");
}

export async function fetchProfile(_handle: string): Promise<null> {
  notConfigured();
}

export async function fetchUserPosts(_handleOrId: string, _count: number): Promise<never> {
  notConfigured();
}
