/**
 * 把外部 CDN（小红书等）图片 URL 包装成走我们后端的代理路径，
 * 服务端会带正确的 Referer 转发，绕过防盗链。
 *
 * 后端实现：artifacts/api-server/src/routes/xhsImageProxy.ts
 */
// 图片代理失败上报：onError 走 SVG 兜底时调用，按 URL 去重防刷屏
const _reportedFailures = new Set<string>();
export function reportImageProxyFallback(url: string | undefined, where: string): void {
  if (!url) return;
  const key = `${where}::${url}`;
  if (_reportedFailures.has(key)) return;
  _reportedFailures.add(key);
  // 至少保留 console 痕迹方便 grep；后续可改成 sendBeacon 上报后端
  // eslint-disable-next-line no-console
  console.warn("[image-proxy-fallback]", where, url);
}

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
