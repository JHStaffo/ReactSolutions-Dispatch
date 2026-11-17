// Integration tests against the compiled server. Run `npm run build:server` first (npm test does this).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}/api/`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-test-'));
let proc;

async function login(username) {
  const r = await fetch(BASE + 'auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'dispatch' },
    body: JSON.stringify({ username, password: 'Dispatch!2026' }),
  });
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return async (p, body, method) => {
    const res = await fetch(BASE + p, {
      method: method || (body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'dispatch', Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
}

const day = () => {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  return { from: from.toISOString(), to: new Date(from.getTime() + 86400000).toISOString() };
};

before(async () => {
  proc = spawn(process.execPath, ['app.js'], {
    cwd: path.join(__dirname, '..', '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, NODE_ENV: 'test', GPS_INGEST_KEY: 'test-gps-key', GPS_SIMULATOR: 'false' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(BASE + 'auth/me');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
});

after(async () => {
  // Wait for the server to exit so it is not still saving into the folder we delete.
  await new Promise((r) => {
    if (proc.exitCode !== null) return r();
    proc.once('exit', r);
    proc.kill();
  });
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('rejects bad passwords and unauthenticated access', async () => {
  const r = await fetch(BASE + 'auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'dispatch' },
    body: JSON.stringify({ username: 'dispatch1', password: 'nope' }),
  });
  assert.equal(r.status, 401);
  assert.equal((await fetch(BASE + 'board', { method: 'POST', headers: { 'X-Requested-With': 'dispatch' } })).status, 401);
});

test('requires the CSRF header on writes', async () => {
  const r = await fetch(BASE + 'auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
});

test('data at rest is encrypted', () => {
  const raw = fs.readFileSync(path.join(dataDir, 'store.enc'), 'utf8');
  assert.match(raw, /aes-256-gcm/);
  assert.doesNotMatch(raw, /Fakename|Medicare/);
});

test('board uses minimum-necessary summaries; viewer sees initials only', async () => {
  const d1 = await login('dispatch1');
  const b = await d1('board', day());
  assert.equal(b.status, 200);
  const c = b.body.calls[0];
  assert.ok(c.patientDisplay.includes(','));
  assert.equal(c.patient, undefined);
  const v = await login('viewer');
  const vb = await v('board', day());
  assert.ok(!vb.body.calls[0].patientDisplay.includes(','));
  assert.equal((await v(`calls/${c.id}`)).status, 403);
});

test('creates a round trip with recurrence', async () => {
  const d1 = await login('dispatch1');
  const t = new Date(Date.now() + 86400000);
  t.setHours(6, 0, 0, 0);
  const rt = new Date(t.getTime() + 4 * 3600000);
  const r = await d1('calls', {
    level: 'BLS',
    tripType: 'DIALYSIS',
    patient: { firstName: 'Test', lastName: 'Patient', dob: '1950-01-01', weightLbs: 180 },
    insurance: { payer: 'Medicare Part B', memberId: 'X1' },
    chiefComplaint: 'ESRD',
    stretcherReason: 'Bed-confined',
    pickupMode: 'SCHEDULED',
    pickupTime: t.toISOString(),
    pickupLocation: 'A',
    destination: 'B',
    durationMin: 60,
    returnTrip: { mode: 'SCHEDULED', pickupTime: rt.toISOString() },
    recurrence: { weekdays: [0, 1, 2, 3, 4, 5, 6], weeks: 1 },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.calls.length, 14); // 7 days x 2 legs
  const [out, ret] = r.body.calls;
  assert.equal(out.linkedCallId, ret.id);
  assert.equal(ret.pickupLocation, 'B');
});

test('ALS to BLS requires acknowledgement; stale versions are rejected', async () => {
  const d1 = await login('dispatch1');
  const d2 = await login('dispatch2');
  const b = await d1('board', day());
  const als = b.body.calls.find((c) => c.level === 'ALS' && c.status === 'QUEUED');
  const start = new Date();
  start.setHours(13, 0, 0, 0);
  const first = await d1(`calls/${als.id}/assign`, { crewId: 'crew-b5', start: start.toISOString(), expectedVersion: als.version });
  assert.equal(first.status, 422);
  assert.ok(first.body.warnings.some((w) => w.code === 'ALS_TO_BLS'));
  // Dispatcher two assigns it to a medic unit first.
  const win = await d2(`calls/${als.id}/assign`, { crewId: 'crew-m14', start: start.toISOString(), expectedVersion: als.version });
  assert.equal(win.status, 200);
  // Dispatcher one now acknowledges, but is working from the old version.
  const lose = await d1(`calls/${als.id}/assign`, {
    crewId: 'crew-b5', start: start.toISOString(), expectedVersion: als.version, acknowledge: first.body.warnings.map((w) => w.code),
  });
  assert.equal(lose.status, 409);
  assert.equal(lose.body.call.crewId, 'crew-m14');
});

test('change feed replays events for polling clients', async () => {
  const d1 = await login('dispatch1');
  const b = await d1('board', day());
  const q = b.body.calls.find((c) => c.status === 'QUEUED' && c.pickupMode !== 'WILL_CALL');
  await d1(`calls/${q.id}`, { notes: 'gate code 1234', expectedVersion: q.version }, 'PATCH');
  const ch = await d1(`changes?since=${b.body.seq}&boot=${b.body.bootId}`);
  assert.ok(ch.body.events.some((e) => e.type === 'call' && e.call.id === q.id));
  const reset = await d1(`changes?since=0&boot=wrong`);
  assert.equal(reset.body.reset, true);
});

test('audit log records PHI access without PHI values', async () => {
  const sup = await login('supervisor');
  const b = await sup('board', day());
  await sup(`calls/${b.body.calls[0].id}`);
  const a = await sup('audit');
  assert.ok(a.body.entries.some((e) => e.action === 'CALL_VIEW_PHI'));
  const raw = fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8');
  assert.doesNotMatch(raw, /Fakename|Testcase|gate code/);
});

test('patient records link to past and upcoming trips', async () => {
  const d1 = await login('dispatch1');
  const s = await d1('patients/search', { q: 'sample ada' });
  assert.equal(s.status, 200);
  assert.equal(s.body.patients.length, 1);
  assert.equal(s.body.patients[0].dob, '1948-03-14');
  const p = await d1(`patients/${s.body.patients[0].id}`);
  assert.ok(p.body.trips.some((t) => t.status === 'COMPLETED'));
  assert.ok(p.body.trips.some((t) => t.status !== 'COMPLETED'));
  // Paperwork alerts flow onto the patient's open trips.
  const upd = await d1(`patients/${p.body.patient.id}`, { pcsExpires: '2000-01-01', expectedVersion: p.body.patient.version }, 'PATCH');
  assert.equal(upd.status, 200);
  const again = await d1(`patients/${p.body.patient.id}`);
  assert.ok(again.body.trips.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED').every((t) => t.alerts.includes('PCS expired')));
  // Viewers and crews cannot read patient records.
  const v = await login('viewer');
  assert.equal((await v('patients/search', { q: 'a' })).status, 403);
});

test('GPS webhook requires the key and accepts generic and Traccar formats', async () => {
  const post = (q, body, key) =>
    fetch(BASE + 'gps/ingest' + q, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'X-GPS-Key': key } : {}) }, body: JSON.stringify(body) });
  assert.equal((await post('', { deviceId: 'SIM-412', lat: 39.9, lon: -75.1 })).status, 401);
  assert.equal((await post('', { deviceId: 'SIM-412', lat: 39.9, lon: -75.1 }, 'wrong-key-12')).status, 401);
  const g = await post('', [{ deviceId: 'SIM-412', lat: 39.95, lon: -75.16, speedKph: 50, timestamp: new Date().toISOString() }], 'test-gps-key');
  assert.equal((await g.json()).accepted, 1);
  const t = await post('?format=traccar', { position: { latitude: 39.96, longitude: -75.15, speed: 10, course: 180, fixTime: new Date(Date.now() + 1000).toISOString() }, device: { uniqueId: 'SIM-412' } }, 'test-gps-key');
  assert.equal((await t.json()).accepted, 1);
  const d1 = await login('dispatch1');
  const pos = (await d1('gps')).body.positions.find((p) => p.deviceId === 'SIM-412');
  assert.equal(pos.crewId, 'crew-m12');
  assert.equal(pos.lat, 39.96);
  assert.equal(pos.speedMph, 11.5);
});

test('crew accounts see only their own trips and can only move them forward', async () => {
  const crew = await login('bls3');
  const mine = await crew('crew/my-trips');
  assert.equal(mine.status, 200);
  assert.ok(mine.body.trips.length > 0);
  assert.ok(mine.body.trips.every((t) => t.crewId === 'crew-b3'));
  assert.equal((await crew('board', day())).status, 403);
  const d1 = await login('dispatch1');
  const other = (await d1('board', day())).body.calls.find((c) => c.crewId && c.crewId !== 'crew-b3' && c.status === 'ASSIGNED');
  assert.equal((await crew(`calls/${other.id}/status`, { status: 'ENROUTE', expectedVersion: other.version })).status, 403);
  const t = mine.body.trips.find((x) => x.status === 'ASSIGNED');
  assert.equal((await crew(`calls/${t.id}/status`, { status: 'CANCELLED', expectedVersion: t.version, reason: 'x' })).status, 403);
  assert.equal((await crew(`calls/${t.id}/status`, { status: 'ENROUTE', expectedVersion: t.version })).status, 200);
});

test('reports have no PHI; billing export is supervisor-only and audited', async () => {
  const d1 = await login('dispatch1');
  const from = new Date(Date.now() - 30 * 86400000).toISOString();
  const to = new Date(Date.now() + 86400000).toISOString();
  const r = await d1('reports/summary', { from, to });
  assert.equal(r.status, 200);
  assert.ok(r.body.completed > 0);
  assert.doesNotMatch(JSON.stringify(r.body), /Testcase|Fakename|1948-03-14|SMP-0001/);
  assert.equal((await d1('exports/billing', { from, to })).status, 403);
  const sup = await login('supervisor');
  const res = await fetch(BASE + 'exports/billing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'dispatch', Cookie: (await (async () => {
      const lr = await fetch(BASE + 'auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'dispatch' }, body: JSON.stringify({ username: 'supervisor', password: 'Dispatch!2026' }) });
      return lr.headers.get('set-cookie').split(';')[0];
    })()) },
    body: JSON.stringify({ from, to }),
  });
  const csv = await res.text();
  assert.match(csv.split('\r\n')[0], /^Call #,Date of service,Patient #/);
  assert.ok(csv.split('\r\n').length > 3);
  const a = await sup('audit');
  assert.ok(a.body.entries.some((e) => e.action === 'PHI_EXPORT_BILLING'));
});

test('supervisors manage users; disabled users are signed out', async () => {
  const sup = await login('supervisor');
  const add = await sup('admin/users', { username: 'temp1', displayName: 'Temp', role: 'dispatcher', password: 'a-long-password-1' });
  assert.equal(add.status, 201);
  const r = await fetch(BASE + 'auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'dispatch' }, body: JSON.stringify({ username: 'temp1', password: 'a-long-password-1' }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  await sup('admin/users/temp1', { disabled: true }, 'PATCH');
  const me = await fetch(BASE + 'auth/me', { headers: { Cookie: cookie } });
  assert.equal(me.status, 401);
  const d1 = await login('dispatch1');
  assert.equal((await d1('admin/users')).status, 403);
});
