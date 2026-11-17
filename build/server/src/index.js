"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_http_1 = __importDefault(require("node:http"));
const node_path_1 = __importDefault(require("node:path"));
const express_1 = __importDefault(require("express"));
const config_1 = require("./config");
const log_1 = require("./log");
const realtime_1 = require("./realtime");
const features_1 = require("./features");
const gps_1 = require("./gps");
const patients_1 = require("./patients");
const routes_1 = require("./routes");
const seed_1 = require("./seed");
const store_1 = require("./store");
store_1.store.init(() => {
    if (config_1.config.isProd && !process.env.DEMO_PASSWORD) {
        throw new Error('Set DEMO_PASSWORD (the initial password for the starter accounts) before the first start in production.');
    }
    const s = (0, seed_1.seedState)();
    if (!config_1.config.seedSampleData) {
        s.calls = [];
    }
    return s;
});
const app = (0, express_1.default)();
app.disable('x-powered-by');
app.set('trust proxy', true); // cPanel/Passenger sits behind Apache or LiteSpeed
// Request log: method, path with ids redacted, status, duration. No bodies, no query strings.
app.use((req, res, next) => {
    const t = Date.now();
    res.on('finish', () => {
        if (req.path.endsWith('/changes') && res.statusCode === 200)
            return; // too chatty
        (0, log_1.log)('info', 'http', { method: req.method, path: (0, log_1.redactPath)(req.originalUrl), status: res.statusCode, ms: Date.now() - t });
    });
    next();
});
// Security headers.
app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
    if (config_1.config.isProd)
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});
const base = express_1.default.Router();
// Server-to-server GPS webhook: authenticated by its own key, so it sits before the CSRF check.
base.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
}, features_1.gpsIngestApi);
base.use('/api', express_1.default.json({ limit: '64kb' }), (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store'); // never cache PHI in browsers or proxies
    // CSRF defence in depth (cookie is SameSite=Strict): state-changing calls must carry this header,
    // which a cross-site form cannot set.
    if (req.method !== 'GET' && req.get('X-Requested-With') !== 'dispatch')
        return res.status(403).json({ error: 'CSRF' });
    next();
}, routes_1.api, patients_1.patientsApi, features_1.featuresApi);
base.use('/api', (_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
if (node_fs_1.default.existsSync(node_path_1.default.join(config_1.config.clientDir, 'index.html'))) {
    base.use(express_1.default.static(config_1.config.clientDir, { index: 'index.html', maxAge: '1h' }));
    base.get('*', (_req, res) => res.sendFile(node_path_1.default.join(config_1.config.clientDir, 'index.html')));
}
else {
    base.get('/', (_req, res) => res.type('text').send('API is running. Build the client with `npm run build`, or use `npm run dev`.'));
}
// The client uses relative URLs, so the mount path needs a trailing slash.
if (config_1.config.basePath !== '/') {
    const bare = config_1.config.basePath.slice(0, -1);
    app.use((req, res, next) => (req.path === bare ? res.redirect(301, config_1.config.basePath) : next()));
}
app.use(config_1.config.basePath, base);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err, _req, res, _next) => {
    // Error messages can echo request content (e.g. JSON parse errors), so only the error class is logged.
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')
        return res.status(err.status || 400).json({ error: 'BAD_REQUEST' });
    (0, log_1.log)('error', 'Unhandled error', { name: err.name, type: err.type || '-' });
    res.status(500).json({ error: 'SERVER_ERROR' });
});
(0, gps_1.initGps)();
const server = node_http_1.default.createServer(app);
(0, realtime_1.attachRealtime)(server);
server.listen(config_1.config.port, () => {
    (0, log_1.log)('info', 'Dispatch server listening', { port: config_1.config.port, basePath: config_1.config.basePath, env: config_1.config.isProd ? 'production' : 'development' });
});
const shutdown = () => {
    store_1.store.saveNow();
    process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
