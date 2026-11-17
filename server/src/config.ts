import path from 'node:path';

const isProd = process.env.NODE_ENV === 'production';

function normBase(p: string | undefined): string {
  let b = (p || '/').trim();
  if (!b.startsWith('/')) b = '/' + b;
  if (!b.endsWith('/')) b += '/';
  return b;
}

export const config = {
  isProd,
  port: Number(process.env.PORT || 3001),
  /** URL path the app is mounted at, e.g. "/dispatch/" when cPanel's Application URL is a sub-folder. */
  basePath: normBase(process.env.APP_BASE_PATH),
  dataDir: path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data')),
  clientDir: path.resolve(process.env.CLIENT_DIR || path.join(process.cwd(), 'client', 'dist')),
  /** HIPAA 164.312(a)(2)(iii) automatic logoff. */
  idleTimeoutMs: Number(process.env.IDLE_TIMEOUT_MINUTES || 15) * 60_000,
  absoluteTimeoutMs: Number(process.env.ABSOLUTE_TIMEOUT_HOURS || 12) * 3_600_000,
  /** Secure cookies need HTTPS. Defaults to on in production. */
  secureCookies: process.env.SECURE_COOKIES ? process.env.SECURE_COOKIES === 'true' : isProd,
  seedSampleData: process.env.SEED_SAMPLE_DATA !== 'false',
};
