import type { Call, GpsPosition } from '../../shared/types';
import { haversineMiles } from '../../shared/types';
import { config } from './config';
import { log } from './log';
import { store } from './store';

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
const latest = new Map<string, GpsPosition>();
const trails = new Map<string, { lat: number; lon: number; t: number }[]>();
let pending: GpsPosition[] = [];

export function initGps() {
  for (const p of store.state.lastPositions) latest.set(p.deviceId, p);
  setInterval(flush, 3000);
  setInterval(() => {
    store.state.lastPositions = [...latest.values()];
    store.save();
  }, 60_000);
  if (config.gps.provider === 'samsara') startSamsara();
  if (config.gps.simulator) startSimulator();
}

export function positions(): GpsPosition[] {
  const crewByDevice = new Map(store.state.crews.filter((c) => c.gpsDeviceId).map((c) => [c.gpsDeviceId, c.id]));
  return [...latest.values()].map((p) => ({ ...p, crewId: crewByDevice.get(p.deviceId) ?? null }));
}

export interface RawFix {
  deviceId: string;
  lat: number;
  lon: number;
  speedMph?: number;
  heading?: number;
  at?: string;
}

export function ingest(fixes: RawFix[], source: string): number {
  let n = 0;
  const now = Date.now();
  const crewByDevice = new Map(store.state.crews.filter((c) => c.gpsDeviceId).map((c) => [c.gpsDeviceId, c.id]));
  for (const f of fixes) {
    if (!f.deviceId || !Number.isFinite(f.lat) || !Number.isFinite(f.lon)) continue;
    if (Math.abs(f.lat) > 90 || Math.abs(f.lon) > 180 || (f.lat === 0 && f.lon === 0)) continue;
    const at = f.at && !Number.isNaN(Date.parse(f.at)) ? new Date(f.at).toISOString() : new Date(now).toISOString();
    const prev = latest.get(f.deviceId);
    if (prev && Date.parse(prev.at) > Date.parse(at)) continue; // out-of-order fix
    const pos: GpsPosition = {
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
    while (trail.length && trail[0].t < now - TRAIL_MS) trail.shift();
    if (trail.length > 5000) trail.shift();
    trails.set(pos.deviceId, trail);
    pending.push(pos);
    n++;
  }
  return n;
}

function flush() {
  if (!pending.length) return;
  const byDevice = new Map(pending.map((p) => [p.deviceId, p]));
  pending = [];
  store.emit({ type: 'gps', positions: [...byDevice.values()] });
}

/** Miles driven by a crew's truck since `fromIso`, from the GPS breadcrumb trail. */
export function milesSince(crewId: string, fromIso: string | undefined): number | null {
  const crew = store.crew(crewId);
  if (!crew?.gpsDeviceId || !fromIso) return null;
  const trail = trails.get(crew.gpsDeviceId);
  if (!trail) return null;
  const from = Date.parse(fromIso);
  const pts = trail.filter((p) => p.t >= from);
  if (pts.length < 2) return null;
  let miles = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = haversineMiles(pts[i - 1], pts[i]);
    if (d < 5) miles += d; // ignore GPS jumps
  }
  return Math.round(miles * 10) / 10;
}

// ---------------- Vendor formats ----------------

const num = (v: unknown) => (v === null || v === undefined || v === '' ? NaN : Number(v));

/** Normalize a webhook body from a known format into fixes. */
export function parsePayload(format: string, body: any): RawFix[] {
  const list = Array.isArray(body) ? body : Array.isArray(body?.positions) && format !== 'traccar' ? body.positions : [body];
  if (format === 'traccar') {
    // Traccar "position forwarding" (forward.json=true): { position: {...}, device: { uniqueId, name } }
    return list.map((b: any) => ({
      deviceId: String(b?.device?.uniqueId ?? b?.device?.name ?? b?.position?.deviceId ?? ''),
      lat: num(b?.position?.latitude),
      lon: num(b?.position?.longitude),
      speedMph: num(b?.position?.speed) * 1.15078, // Traccar reports knots
      heading: num(b?.position?.course) || 0,
      at: b?.position?.fixTime ?? b?.position?.deviceTime,
    }));
  }
  // Generic JSON: { deviceId, lat|latitude, lon|lng|longitude, speedMph|speedKph|speed, heading|course, timestamp|time|at }
  return list.map((b: any) => {
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
    log('warn', 'GPS_PROVIDER=samsara but SAMSARA_API_TOKEN is not set; Samsara polling is off');
    return;
  }
  const poll = async () => {
    try {
      const res = await fetch('https://api.samsara.com/fleet/vehicles/locations', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        log('warn', 'Samsara poll failed', { status: res.status });
        return;
      }
      const body = (await res.json()) as { data?: any[] };
      // Each vehicle is matched by its Samsara vehicle id OR its name, whichever is in Crew.gpsDeviceId.
      const known = new Set(store.state.crews.map((c) => c.gpsDeviceId).filter(Boolean));
      const fixes: RawFix[] = [];
      for (const v of body.data ?? []) {
        const l = v.location ?? {};
        const id = known.has(String(v.name)) ? String(v.name) : String(v.id);
        fixes.push({ deviceId: id, lat: num(l.latitude), lon: num(l.longitude), speedMph: num(l.speed) || 0, heading: num(l.heading) || 0, at: l.time });
      }
      ingest(fixes, 'samsara');
    } catch (e) {
      log('warn', 'Samsara poll error', { name: (e as Error).name });
    }
  };
  poll();
  setInterval(poll, config.gps.pollSeconds * 1000);
  log('info', 'Samsara GPS polling on', { seconds: config.gps.pollSeconds });
}

// ---------------- Simulator ----------------

function startSimulator() {
  const [clat, clon] = config.gps.center;
  const state = new Map<string, { lat: number; lon: number; heading: number }>();
  const coordsFor = (place: string) => {
    const f = store.state.facilities.find((x) => x.name === place && x.lat != null && x.lon != null);
    return f ? { lat: f.lat!, lon: f.lon! } : null;
  };
  const tick = () => {
    const fixes: RawFix[] = [];
    for (const crew of store.state.crews) {
      if (!crew.active || !crew.gpsDeviceId.startsWith('SIM-')) continue;
      let s = state.get(crew.id);
      if (!s) {
        const last = latest.get(crew.gpsDeviceId);
        s = last ? { lat: last.lat, lon: last.lon, heading: 0 } : { lat: clat + (Math.random() - 0.5) * 0.08, lon: clon + (Math.random() - 0.5) * 0.1, heading: 0 };
        state.set(crew.id, s);
      }
      const call: Call | undefined = store.state.calls.find(
        (c) => c.crewId === crew.id && ['ENROUTE', 'ON_SCENE', 'TRANSPORTING', 'AT_DESTINATION'].includes(c.status),
      );
      let target: { lat: number; lon: number } | null = null;
      let mph = 0;
      if (call?.status === 'ENROUTE') target = coordsFor(call.pickupLocation) ?? { lat: clat, lon: clon };
      if (call?.status === 'TRANSPORTING') target = coordsFor(call.destination) ?? { lat: clat + 0.02, lon: clon };
      if (!call && !crew.outOfService) {
        // idle: drift slowly, like repositioning between calls
        target = { lat: s.lat + (Math.random() - 0.5) * 0.002, lon: s.lon + (Math.random() - 0.5) * 0.002 };
      }
      if (target) {
        const dist = haversineMiles(s, target);
        mph = call ? 28 + Math.random() * 10 : Math.random() < 0.7 ? 0 : 12;
        const step = (mph * 5) / 3600; // miles per 5 s tick
        if (dist > 0.02 && step > 0) {
          const f = Math.min(1, step / dist);
          s.heading = (Math.atan2(target.lon - s.lon, target.lat - s.lat) * 180) / Math.PI;
          s.lat += (target.lat - s.lat) * f;
          s.lon += (target.lon - s.lon) * f;
        } else mph = 0;
      }
      fixes.push({ deviceId: crew.gpsDeviceId, lat: s.lat, lon: s.lon, speedMph: mph, heading: (s.heading + 360) % 360 });
    }
    ingest(fixes, 'simulator');
  };
  tick();
  setInterval(tick, 5000);
  log('info', 'GPS simulator on (sample trucks with SIM- device ids)');
}
