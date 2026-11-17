"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const node_path_1 = __importDefault(require("node:path"));
const isProd = process.env.NODE_ENV === 'production';
function normBase(p) {
    let b = (p || '/').trim();
    if (!b.startsWith('/'))
        b = '/' + b;
    if (!b.endsWith('/'))
        b += '/';
    return b;
}
exports.config = {
    isProd,
    port: Number(process.env.PORT || 3001),
    /** URL path the app is mounted at, e.g. "/dispatch/" when cPanel's Application URL is a sub-folder. */
    basePath: normBase(process.env.APP_BASE_PATH),
    dataDir: node_path_1.default.resolve(process.env.DATA_DIR || node_path_1.default.join(process.cwd(), 'data')),
    clientDir: node_path_1.default.resolve(process.env.CLIENT_DIR || node_path_1.default.join(process.cwd(), 'client', 'dist')),
    /** HIPAA 164.312(a)(2)(iii) automatic logoff. */
    idleTimeoutMs: Number(process.env.IDLE_TIMEOUT_MINUTES || 15) * 60_000,
    absoluteTimeoutMs: Number(process.env.ABSOLUTE_TIMEOUT_HOURS || 12) * 3_600_000,
    /** Secure cookies need HTTPS. Defaults to on in production. */
    secureCookies: process.env.SECURE_COOKIES ? process.env.SECURE_COOKIES === 'true' : isProd,
    seedSampleData: process.env.SEED_SAMPLE_DATA !== 'false',
    gps: {
        /** Shared secret the GPS vendor/Traccar must send (X-GPS-Key header or ?key=). Ingest is off without it. */
        ingestKey: process.env.GPS_INGEST_KEY || '',
        /** "samsara" turns on API polling; webhook ingest works regardless. */
        provider: (process.env.GPS_PROVIDER || '').toLowerCase(),
        pollSeconds: Math.max(5, Number(process.env.GPS_POLL_SECONDS || 15)),
        simulator: process.env.GPS_SIMULATOR ? process.env.GPS_SIMULATOR === 'true' : !isProd,
        center: (process.env.GPS_SIM_CENTER || '39.9526,-75.1652').split(',').map(Number),
        /** Positions older than this are shown as stale. */
        staleMinutes: Number(process.env.GPS_STALE_MINUTES || 5),
    },
    map: {
        tileUrl: process.env.MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: process.env.MAP_ATTRIBUTION || '&copy; OpenStreetMap contributors',
    },
};
