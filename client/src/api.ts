// All requests use relative URLs so the app works at a domain root or under a sub-folder.
// PHI is only ever sent in request bodies (never in URLs) and nothing is cached in browser storage.

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: any,
  ) {
    super(body?.message || `Request failed (${status})`);
  }
}

let onUnauthorized: (reason?: string) => void = () => {};
export function setUnauthorizedHandler(fn: (reason?: string) => void) {
  onUnauthorized = fn;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch('api/' + path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'dispatch' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* empty */
  }
  if (res.status === 401 && !path.startsWith('auth/login')) onUnauthorized(body?.reason);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

/** Path the app is served from, e.g. "/" or "/dispatch/". */
export const basePath = new URL('.', window.location.href).pathname;

export function wsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${basePath}ws`;
}
