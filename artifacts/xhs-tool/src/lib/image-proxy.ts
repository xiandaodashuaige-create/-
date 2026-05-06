/**
 * 把外部 CDN（小红书等）图片 URL 包装成走我们后端的代理路径，
 * 服务端会带正确的 Referer 转发，绕过防盗链。
 *
 * 后端实现：artifacts/api-server/src/routes/xhsImageProxy.ts
 */
export function proxyXhsImage(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  if (url.includes("/api/xhs/image-proxy")) return url;
  if (
    url.includes("xhscdn.com") ||
    url.includes("xiaohongshu.com") ||
    url.includes("sns-webpic") ||
    url.includes("sns-img") ||
    url.includes("sns-na-") ||
    url.includes("sns-avatar")
  ) {
    const base = (import.meta as any).env?.BASE_URL || "/";
    const normalizedUrl = url.startsWith("//") ? `https:${url}` : url;
    return `${base}api/xhs/image-proxy?url=${encodeURIComponent(normalizedUrl)}`;
  }
  return url;
}
