"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initGps = initGps;
exports.positions = positions;
exports.ingest = ingest;
exports.milesSince = milesSince;
exports.parsePayload = parsePayload;
const types_1 = require("../../shared/types");
const config_1 = require("./config");
const log_1 = require("./log");
const store_1 = require("./store");
/**
 * Truck GPS. Positions come from the third-party GPS units installed in the trucks, by one of:
 *   1. Push (webhook): the vendor or a Traccar server POSTs to /api/gps/ingest with the shared key.
 *   2. Pull (polling): set GPS_PROVIDER=samsara and SAMSARA_API_TOKEN, and the server polls the vendor API.
 *   3. Phone fallback: a crew member can share their phone's location from the crew screen.
 *   4. Simulator (demo): GPS_SIMULATOR=true drives the sample trucks around the sample facilities.
 * Each crew is matched to its device by Crew.gpsDeviceId. Truck location is not PHI, but the
 * ingest endpoint still requires a secret so nobody can spoof positions.
 */
const TRAIL_MS = 4 * 3600_000;
const latest = new Map();
const trails = new Map();
let pending = [];
function initGps() {
    for (const p of store_1.store.state.lastPositions)
        latest.set(p.deviceId, p);
    setInterval(flush, 3000);
    setInterval(() => {
        store_1.store.state.lastPositions = [...latest.values()];
        store_1.store.save();
    }, 60_000);
    if (config_1.config.gps.provider === 'samsara')
        startSamsara();
    if (config_1.config.gps.simulator)
        startSimulator();
}
function positions() {
    const crewByDevice = new Map(store_1.store.state.crews.filter((c) => c.gpsDeviceId).map((c) => [c.gpsDeviceId, c.id]));
    return [...latest.values()].map((p) => ({ ...p, crewId: crewByDevice.get(p.deviceId) ?? null }));
}
function ingest(fixes, source) {
    let n = 0;
    const now = Date.now();
    const crewByDevice = new Map(store_1.store.state.crews.filter((c) => c.gpsDeviceId).map((c) => [c.gpsDeviceId, c.id]));
    for (const f of fixes) {
        if (!f.deviceId || !Number.isFinite(f.lat) || !Number.isFinite(f.lon))
            continue;
        if (Math.abs(f.lat) > 90 || Math.abs(f.lon) > 180 || (f.lat === 0 && f.lon === 0))
            continue;
        const at = f.at && !Number.isNaN(Date.parse(f.at)) ? new Date(f.at).toISOString() : new Date(now).toISOString();
        const prev = latest.get(f.deviceId);
        if (prev && Date.parse(prev.at) > Date.parse(at))
            continue; // out-of-order fix
        const pos = {
            deviceId: String(f.deviceId).slice(0, 64),
            crewId: crewByDevice.get(f.deviceId) ?? null,
            lat: Math.round(f.lat * 1e6) / 1e6,
            lon: Math.round(f.lon * 1e6) / 1e6,
            speedMph: Math.max(0, Math.round((f.speedMph ?? 0) * 10) / 10),
            heading: Math.round(f.heading ?? 0),
            at,
            receivedAt: new Date(now).toISOString(),
            source,
        };
        latest.set(pos.deviceId, pos);
        const trail = trails.get(pos.deviceId) ?? [];
        trail.push({ lat: pos.lat, lon: pos.lon, t: Date.parse(at) });
        while (trail.length && trail[0].t < now - TRAIL_MS)
            trail.shift();
        if (trail.length > 5000)
            trail.shift();
        trails.set(pos.deviceId, trail);
        pending.push(pos);
        n++;
    }
    return n;
}
function flush() {
    if (!pending.length)
        return;
    const byDevice = new Map(pending.map((p) => [p.deviceId, p]));
    pending = [];
    store_1.store.emit({ type: 'gps', positions: [...byDevice.values()] });
}
/** Miles driven by a crew's truck since `fromIso`, from the GPS breadcrumb trail. */
function milesSince(crewId, fromIso) {
    const crew = store_1.store.crew(crewId);
    if (!crew?.gpsDeviceId || !fromIso)
        return null;
    const trail = trails.get(crew.gpsDeviceId);
    if (!trail)
        return null;
    const from = Date.parse(fromIso);
    const pts = trail.filter((p) => p.t >= from);
    if (pts.length < 2)
        return null;
    let miles = 0;
    for (let i = 1; i < pts.length; i++) {
        const d = (0, types_1.haversineMiles)(pts[i - 1], pts[i]);
        if (d < 5)
            miles += d; // ignore GPS jumps
    }
    return Math.round(miles * 10) / 10;
}
// ---------------- Vendor formats ----------------
const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
/** Normalize a webhook body from a known format into fixes. */
function parsePayload(format, body) {
    const list = Array.isArray(body) ? body : Array.isArray(body?.positions) && format !== 'traccar' ? body.positions : [body];
    if (format === 'traccar') {
        // Traccar "position forwarding" (forward.json=true): { position: {...}, device: { uniqueId, name } }
        return list.map((b) => ({
            deviceId: String(b?.device?.uniqueId ?? b?.device?.name ?? b?.position?.deviceId ?? ''),
            lat: num(b?.position?.latitude),
            lon: num(b?.position?.longitude),
            speedMph: num(b?.position?.speed) * 1.15078, // Traccar reports knots
            heading: num(b?.position?.course) || 0,
            at: b?.position?.fixTime ?? b?.position?.deviceTime,
        }));
    }
    // Generic JSON: { deviceId, lat|latitude, lon|lng|longitude, speedMph|speedKph|speed, heading|course, timestamp|time|at }
    return list.map((b) => {
        const speedMph = Number.isFinite(num(b?.speedMph))
            ? num(b.speedMph)
            : Number.isFinite(num(b?.speedKph))
                ? num(b.speedKph) * 0.621371
                : num(b?.speed) || 0;
        return {
            deviceId: String(b?.deviceId ?? b?.device_id ?? b?.imei ?? b?.id ?? ''),
            lat: num(b?.lat ?? b?.latitude),
            lon: num(b?.lon ?? b?.lng ?? b?.longitude),
            speedMph,
            heading: num(b?.heading ?? b?.course ?? b?.bearing) || 0,
            at: b?.timestamp ?? b?.time ?? b?.at ?? b?.fixTime,
        };
    });
}
// ---------------- Samsara polling ----------------
function startSamsara() {
    const token = process.env.SAMSARA_API_TOKEN;
    if (!token) {
        (0, log_1.log)('warn', 'GPS_PROVIDER=samsara but SAMSARA_API_TOKEN is not set; Samsara polling is off');
        return;
    }
    const poll = async () => {
        try {
            const res = await fetch('https://api.samsara.com/fleet/vehicles/locations', { headers: { Authorization: `Bearer ${token}` } });
            if (!res.ok) {
                (0, log_1.log)('warn', 'Samsara poll failed', { status: res.status });
                return;
            }
            const body = (await res.json());
            // Each vehicle is matched by its Samsara vehicle id OR its name, whichever is in Crew.gpsDeviceId.
            const known = new Set(store_1.store.state.crews.map((c) => c.gpsDeviceId).filter(Boolean));
            const fixes = [];
            for (const v of body.data ?? []) {
                const l = v.location ?? {};
                const id = known.has(String(v.name)) ? String(v.name) : String(v.id);
                fixes.push({ deviceId: id, lat: num(l.latitude), lon: num(l.longitude), speedMph: num(l.speed) || 0, heading: num(l.heading) || 0, at: l.time });
            }
            ingest(fixes, 'samsara');
        }
        catch (e) {
            (0, log_1.log)('warn', 'Samsara poll error', { name: e.name });
        }
    };
    poll();
    setInterval(poll, config_1.config.gps.pollSeconds * 1000);
    (0, log_1.log)('info', 'Samsara GPS polling on', { seconds: config_1.config.gps.pollSeconds });
}
// ---------------- Simulator ----------------
function startSimulator() {
    const [clat, clon] = config_1.config.gps.center;
    const state = new Map();
    const coordsFor = (place) => {
        const f = store_1.store.state.facilities.find((x) => x.name === place && x.lat != null && x.lon != null);
        return f ? { lat: f.lat, lon: f.lon } : null;
    };
    const tick = () => {
        const fixes = [];
        for (const crew of store_1.store.state.crews) {
            if (!crew.active || !crew.gpsDeviceId.startsWith('SIM-'))
                continue;
            let s = state.get(crew.id);
            if (!s) {
                const last = latest.get(crew.gpsDeviceId);
                s = last ? { lat: last.lat, lon: last.lon, heading: 0 } : { lat: clat + (Math.random() - 0.5) * 0.08, lon: clon + (Math.random() - 0.5) * 0.1, heading: 0 };
                state.set(crew.id, s);
            }
            const call = store_1.store.state.calls.find((c) => c.crewId === crew.id && ['ENROUTE', 'ON_SCENE', 'TRANSPORTING', 'AT_DESTINATION'].includes(c.status));
            let target = null;
            let mph = 0;
            if (call?.status === 'ENROUTE')
                target = coordsFor(call.pickupLocation) ?? { lat: clat, lon: clon };
            if (call?.status === 'TRANSPORTING')
                target = coordsFor(call.destination) ?? { lat: clat + 0.02, lon: clon };
            if (!call && !crew.outOfService) {
                // idle: drift slowly, like repositioning between calls
                target = { lat: s.lat + (Math.random() - 0.5) * 0.002, lon: s.lon + (Math.random() - 0.5) * 0.002 };
            }
            if (target) {
                const dist = (0, types_1.haversineMiles)(s, target);
                mph = call ? 28 + Math.random() * 10 : Math.random() < 0.7 ? 0 : 12;
                const step = (mph * 5) / 3600; // miles per 5 s tick
                if (dist > 0.02 && step > 0) {
                    const f = Math.min(1, step / dist);
                    s.heading = (Math.atan2(target.lon - s.lon, target.lat - s.lat) * 180) / Math.PI;
                    s.lat += (target.lat - s.lat) * f;
                    s.lon += (target.lon - s.lon) * f;
                }
                else
                    mph = 0;
            }
            fixes.push({ deviceId: crew.gpsDeviceId, lat: s.lat, lon: s.lon, speedMph: mph, heading: (s.heading + 360) % 360 });
        }
        ingest(fixes, 'simulator');
    };
    tick();
    setInterval(tick, 5000);
    (0, log_1.log)('info', 'GPS simulator on (sample trucks with SIM- device ids)');
}
