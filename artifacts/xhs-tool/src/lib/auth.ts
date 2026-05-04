let _getToken: (() => Promise<string | null>) | null = null;

export function setTokenProvider(fn: () => Promise<string | null>) {
  _getToken = fn;
}

export async function getAuthToken(): Promise<string | null> {
  if (!_getToken) return null;
  return _getToken();
}
