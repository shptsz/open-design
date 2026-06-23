const STORAGE_KEY = 'open-design:api-token';
export const API_TOKEN_URL_PARAM = 'od_api_token';
const COOKIE_NAME = 'od_api_token';

function writeTokenCookie(token: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; SameSite=Lax`;
}

function readTokenFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const token = params.get(API_TOKEN_URL_PARAM)?.trim();
  if (!token) return null;
  try {
    window.localStorage.setItem(STORAGE_KEY, token);
    writeTokenCookie(token);
    params.delete(API_TOKEN_URL_PARAM);
    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', nextUrl);
  } catch {
    // Browser storage/history can be unavailable in restricted modes; the
    // in-memory token still covers this page load.
  }
  writeTokenCookie(token);
  return token;
}

function readStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

export function readApiTokenForBrowserRequests(): string | null {
  return readStoredToken();
}

export function withApiTokenQuery(url: string): string {
  const token = readApiTokenForBrowserRequests();
  if (!token || typeof window === 'undefined') return url;
  const resolved = new URL(url, window.location.href);
  if (resolved.origin !== window.location.origin || !resolved.pathname.startsWith('/api/')) {
    return url;
  }
  resolved.searchParams.set(API_TOKEN_URL_PARAM, token);
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

function isSameOriginApiRequest(input: RequestInfo | URL): boolean {
  if (typeof window === 'undefined') return false;
  const url = input instanceof Request
    ? input.url
    : input instanceof URL
      ? input.href
      : String(input);
  try {
    const resolved = new URL(url, window.location.href);
    return resolved.origin === window.location.origin && resolved.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

function withBearerHeader(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  token: string,
): [RequestInfo | URL, RequestInit | undefined] {
  if (!isSameOriginApiRequest(input)) return [input, init];

  if (input instanceof Request) {
    if (input.headers.has('authorization')) return [input, init];
    const headers = new Headers(input.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return [new Request(input, { headers }), init];
  }

  const headers = new Headers(init?.headers);
  if (!headers.has('authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return [input, { ...init, headers }];
}

let installed = false;

export function installApiTokenFetchAuth(): void {
  if (installed || typeof window === 'undefined') return;
  const token = readTokenFromUrl() ?? readStoredToken();
  if (!token) return;
  writeTokenCookie(token);
  installed = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const [nextInput, nextInit] = withBearerHeader(input, init, token);
    return originalFetch(nextInput, nextInit);
  }) as typeof window.fetch;
}
