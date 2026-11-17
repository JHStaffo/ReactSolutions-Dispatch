import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { config } from './config';
import { log, redactPath } from './log';
import { attachRealtime } from './realtime';
import { featuresApi, gpsIngestApi } from './features';
import { initGps } from './gps';
import { patientsApi } from './patients';
import { api } from './routes';
import { seedState } from './seed';
import { store } from './store';

// Patient data must never sit where the web server could serve it as a plain file.
const WEB_ROOTS = /[\\/](public_html|www|htdocs|httpdocs)([\\/]|$)/i;
if (WEB_ROOTS.test(config.dataDir)) {
  const msg = `DATA_DIR (${config.dataDir}) is inside a public web folder. Set DATA_DIR to a folder outside it, e.g. ~/dispatch-data.`;
  if (config.isProd) throw new Error(msg);
  log('warn', msg);
}

store.init(() => {
  if (config.isProd && !process.env.DEMO_PASSWORD) {
    throw new Error('Set DEMO_PASSWORD (the initial password for the starter accounts) before the first start in production.');
  }
  const s = seedState();
  if (!config.seedSampleData) {
    s.calls = [];
  }
  return s;
});

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true); // cPanel/Passenger sits behind Apache or LiteSpeed

// Request log: method, path with ids redacted, status, duration. No bodies, no query strings.
app.use((req, res, next) => {
  const t = Date.now();
  res.on('finish', () => {
    if (req.path.endsWith('/changes') && res.statusCode === 200) return; // too chatty
    log('info', 'http', { method: req.method, path: redactPath(req.originalUrl), status: res.statusCode, ms: Date.now() - t });
  });
  next();
});

// Security headers.
app.use((_req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  if (config.isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

const base = express.Router();

// Server-to-server GPS webhook: authenticated by its own key, so it sits before the CSRF check.
base.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
}, gpsIngestApi);

base.use(
  '/api',
  express.json({ limit: '64kb' }),
  (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store'); // never cache PHI in browsers or proxies
    // CSRF defence in depth (cookie is SameSite=Strict): state-changing calls must carry this header,
    // which a cross-site form cannot set.
    if (req.method !== 'GET' && req.get('X-Requested-With') !== 'dispatch') return res.status(403).json({ error: 'CSRF' });
    next();
  },
  api,
  patientsApi,
  featuresApi,
);
base.use('/api', (_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));

if (fs.existsSync(path.join(config.clientDir, 'index.html'))) {
  base.use(express.static(config.clientDir, { index: 'index.html', maxAge: '1h' }));
  base.get('*', (_req, res) => res.sendFile(path.join(config.clientDir, 'index.html')));
} else {
  base.get('/', (_req, res) => res.type('text').send('API is running. Build the client with `npm run build`, or use `npm run dev`.'));
}

// The client uses relative URLs, so the mount path needs a trailing slash.
if (config.basePath !== '/') {
  const bare = config.basePath.slice(0, -1);
  app.use((req, res, next) => (req.path === bare ? res.redirect(301, config.basePath) : next()));
}
app.use(config.basePath, base);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error & { type?: string; status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Error messages can echo request content (e.g. JSON parse errors), so only the error class is logged.
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(err.status || 400).json({ error: 'BAD_REQUEST' });
  log('error', 'Unhandled error', { name: err.name, type: err.type || '-' });
  res.status(500).json({ error: 'SERVER_ERROR' });
});

initGps();
const server = http.createServer(app);
attachRealtime(server);
server.listen(config.port, () => {
  log('info', 'Dispatch server listening', { port: config.port, basePath: config.basePath, env: config.isProd ? 'production' : 'development' });
});

const shutdown = () => {
  store.saveNow();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
