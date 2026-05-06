// FastMoss 适配器 — 需要 FASTMOSS_API_KEY 才能启用
// 文档：https://www.fastmoss.com (需付费订阅)
function notConfigured(): never {
  throw new Error("FastMoss provider 未实现 — 请订阅 FastMoss 并设置 FASTMOSS_API_KEY，然后实现 services/tiktokProviders/fastmoss.ts");
}

export async function fetchProfile(_handle: string): Promise<null> {
  notConfigured();
}

export async function fetchUserPosts(_handleOrId: string, _count: number): Promise<never> {
  notConfigured();
}
