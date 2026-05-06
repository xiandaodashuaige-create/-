/**
 * 返回 AI 流程的小工具
 * 解决断流：用户被引导去 /accounts 等辅助页授权后，能一键回到原 AI 流程
 *
 * 使用 sessionStorage（标签页生命周期），并加 30 分钟 TTL 避免「幽灵跳转」
 * （比如用户中途放弃流程、几小时后又来用别的功能时被莫名跳走）
 */
const KEY = "oauth_return_to";
const KEY_AT = "oauth_return_to_at";
const TTL_MS = 30 * 60 * 1000;

export function setReturnToFlow(path: string) {
  sessionStorage.setItem(KEY, path);
  sessionStorage.setItem(KEY_AT, String(Date.now()));
}

export function getReturnToFlow(): string | null {
  const at = Number(sessionStorage.getItem(KEY_AT) ?? 0);
  if (at && Date.now() - at > TTL_MS) {
    clearReturnToFlow();
    return null;
  }
  return sessionStorage.getItem(KEY);
}

export function clearReturnToFlow() {
  sessionStorage.removeItem(KEY);
  sessionStorage.removeItem(KEY_AT);
}
