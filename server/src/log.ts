// Operational logging. Never pass patient data, request bodies, query strings or tokens here.
type Level = 'info' | 'warn' | 'error';

export function log(level: Level, msg: string, meta?: Record<string, string | number | boolean>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta });
  if (level === 'error') console.error(line);
  else console.log(line);
}

/** Replace ids in a path so URLs can be logged without identifiers. */
export function redactPath(p: string): string {
  return p
    .split('?')[0]
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:n');
}
