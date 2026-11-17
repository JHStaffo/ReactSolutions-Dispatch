# ReactSolutions Dispatch

A working prototype of a **non-emergency (non-911) ambulance dispatch** platform for ALS and BLS
stretcher transports: dialysis, doctor's appointments, interfacility transfers, hospital discharges
and SNF-to-ER runs.

Several dispatchers can work the same board at once. Every change appears on everyone's screen
immediately, and conflicting actions are caught instead of silently overwriting each other.

> **Sample data only.** All patients, crews, facilities and phone numbers are fictional. The app is
> nevertheless built to handle the data as PHI (see [HIPAA safeguards](#hipaa-safeguards)).

## Features

**Call intake**
- ALS/BLS level, trip type, patient name, DOB (age shown), weight (lb or kg), insurance payer,
  member ID, prior-auth number, PCS (Physician Certification Statement) on file
- Chief complaint, reason for stretcher / medical necessity, equipment (O₂, cardiac monitor, IV pump,
  vent, suction, bariatric stretcher, stair chair, restraints, isolation)
- Pickup **ASAP**, at a **scheduled** time, or **will-call** (facility calls when the patient is ready)
- **Round trips**: creates linked outbound and return legs (scheduled or will-call return)
- **Recurring standing orders** (e.g. dialysis Mon/Wed/Fri for N weeks)
- Facility address book with autocomplete
- Live hints: ALS equipment on a BLS call, bariatric weight without a bariatric stretcher, missing PCS

**Dispatch board**
- Unassigned queue sorted ASAP first (with wait time), then scheduled, then will-call, with filter tabs
- Vertical day timeline in 15-minute slots with one column per crew
- Crew headers show unit, truck, phone (tap to call), crew members and certifications, ALS/BLS level,
  shift hours, trip count, and out-of-service status
- **Drag and drop** a call onto a crew and time slot to assign it; drag trips between crews or times to
  reassign; drag back to the queue to unassign
- Assignment checks that need confirmation: **ALS call to a BLS crew**, overlapping trips, outside
  the crew's shift, unit out of service
- Overlapping trips shown side by side, off-shift hours shaded, current-time line, late trips flagged
- Trip status workflow with timestamps: Assigned → En route → On scene → Transporting → At destination
  → Completed, plus Cancel (reason required). Supervisors can reopen closed calls
- Call detail drawer with full record, linked leg, status times, and change history
- Top bar counters: queued, ASAP waiting (oldest wait), will-call, late, active, units in service
- Day navigation, quick filter, who's online, and pop-up notices when another dispatcher changes something

**Multi-dispatcher sync**
- WebSocket push of every change; automatic fallback to 4-second polling if WebSockets are blocked
- Sequence-numbered event feed: missed events are fetched, and a server restart triggers a reload
- Optimistic concurrency: every write carries the version the dispatcher was looking at. If someone else
  changed the call first, the write is rejected (HTTP 409), the board refreshes and the dispatcher is told who changed it

**Patients**
- Patient database (sample records only) with search by name, DOB, patient number or member ID. Each record shows demographics,
  insurance, PCS and prior-auth expiry, medical notes, and the patient's **past and scheduled trips**
- Booking a trip from intake finds or creates the patient record and pre-fills it from the last trip
- **Paperwork alerts**: missing or expired PCS, and PCS or prior auth expiring within 7 days, flagged on
  the trip card, call drawer and top bar

**GPS and map**
- Live truck positions from a third-party GPS provider: a generic JSON webhook, Traccar forwarding, or
  Samsara polling. Crew headers show speed and how long ago the last fix came in, and go stale after 5 minutes
- Map view (Leaflet) with every truck, its status and current trip, plus facilities
- **Closest-unit suggestions** for ASAP calls, ranked by straight-line distance and level of care
- **Loaded miles** measured from GPS between "Transporting" and "At destination" (dispatchers can edit them)
- Crew phones can share their location when a truck's GPS unit is down

**Crew mobile screen**
- Crew accounts sign in on a phone and see today's trips, patient and destination details, and one-tap
  status buttons (En route → On scene → Transporting → At destination → Clear)

**Reports and exports**
- Reports for any date range: trips by type, payer, level and status, on-time pickups, ASAP response,
  cancellation reasons, unit utilization and loaded miles. These hold no patient details. CSV export
- **Billing export** (supervisor only, audited): completed trips with patient, payer, PCS, auth and loaded miles
- **Printable run sheets** per crew per day (audited as a PHI print)

**Alerts and administration**
- Sound and desktop pop-ups for new ASAP calls and trips that are running late (mute from the menu)
- Supervisor screens for **users** (add, disable, reset password, change role), **crews and trucks**
  (members, phone, shift, level, GPS device id), and the **facility address book** with map locations

**Roles**
- `dispatcher`: take and dispatch calls
- `supervisor`: everything, plus the audit log, reopening closed calls, and resetting sample data
- `viewer`: read-only board with patient initials only; cannot open patient details
- `crew`: the mobile crew screen, limited to that crew's own trips

## Run it locally

Requires Node.js 18.18+.

```bash
npm install
npm run dev
```

Open http://localhost:5173 and sign in with any of these (password `Dispatch!2026`):

| Username | Role |
| --- | --- |
| `dispatch1` | dispatcher |
| `dispatch2` | dispatcher |
| `supervisor` | supervisor |
| `viewer` | read-only |
| `medic12` | crew (Medic 12, ALS) |
| `bls3` | crew (BLS 3) |

Try two dispatchers at once: open a second browser (or a private window), sign in as `dispatch2`, and
drag calls around in one window while watching the other.

Production-style run on one port:

```bash
npm run build
npm start            # http://localhost:3001
```

Tests (API, security and concurrency checks):

```bash
npm test
```

Sample calls are generated for the day the data store is first created. To get fresh calls for today,
sign in as `supervisor` and choose **Reset sample data** from the user menu.

## Deploy to cPanel

See **[DEPLOY-CPANEL.md](DEPLOY-CPANEL.md)**. Short version: `npm run package`, upload
`release/reactsolutions-dispatch.zip`, create a Node.js app with startup file `app.js`, set
`NODE_ENV`, `DATA_ENCRYPTION_KEY`, `DATA_DIR`, `DEMO_PASSWORD` and `TZ`, run NPM install, restart.

## HIPAA safeguards

Technical safeguards built into this prototype (45 CFR 164.312):

| Safeguard | How |
| --- | --- |
| Unique user identification | Named accounts; scrypt-hashed passwords; every action attributed to a user |
| Automatic logoff | 15-minute idle timeout enforced on the server, with a one-minute warning in the browser; 12-hour absolute limit; live-update sockets are closed when the session ends |
| Access control | Role-based permissions on every API route; viewers never receive patient details |
| Minimum necessary | The board and live updates carry only "Lastname, F.", age, weight, equipment and route. DOB, insurance and clinical details load only when a call is opened, and are dropped from memory when it closes |
| Audit controls | Append-only audit log of sign-ins (success and failure), sign-outs, timeouts, PHI views, searches, creates, edits, assignments, status changes, conflicts and denied access. It stores record ids and action names, never patient values. Supervisors can view it in the app |
| Integrity | Version checks prevent lost updates; AES-GCM authenticated encryption detects tampering with stored data |
| Encryption at rest | Data store is AES-256-GCM encrypted; production refuses to start without `DATA_ENCRYPTION_KEY` |
| Transmission security | HTTPS required in production (Secure, HttpOnly, SameSite=Strict cookie; HSTS) |
| No PHI in URLs or logs | Records use random UUIDs; search terms go in request bodies; request logs strip ids and never record bodies or query strings; error logs record only the error type |
| Other hardening | Login throttling (10 failures per 15 min per IP or username), CSRF header check, strict Content-Security-Policy, no-store caching on API responses, no PHI in browser storage, `noindex` |

**Before using with real patient data** you would also need: a signed BAA with your hosting provider,
encrypted backups, MFA, password complexity and rotation policy, account provisioning and
de-provisioning procedures, a risk assessment, retention rules for the audit log, and
administrative and physical safeguards. Shared cPanel hosting is generally **not** suitable for real
PHI unless the host will sign a BAA.

## Architecture

```
client/   React 18 + TypeScript (Vite). Dispatch board, intake form, drawer, live sync.
server/   Node + Express + ws. REST API, auth, audit, encrypted store, realtime push.
shared/   Types and constants used by both.
app.js    Startup file (cPanel / Passenger / `npm start`).
scripts/  package.cjs (cPanel bundle), users.cjs (account management).
```

- All writes go through the REST API (audited, validated with zod). The WebSocket only pushes.
- State is held in memory in a single Node process and saved to `data/store.enc` (atomic write).
  This keeps deployment simple on cPanel; moving to MySQL/PostgreSQL is the natural next step if you
  need more than one app process.
- Times are stored in UTC and shown in each dispatcher's local time.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | HTTP port (cPanel sets this) |
| `NODE_ENV` | | `production` enables Secure cookies, HSTS, and required key checks |
| `DATA_DIR` | `./data` | Where the encrypted store and audit log live |
| `DATA_ENCRYPTION_KEY` | dev key auto-created | 32-byte base64 key. Required in production |
| `DEMO_PASSWORD` | `Dispatch!2026` | Password for the starter accounts on first start. Required in production |
| `APP_BASE_PATH` | `/` | Set when served from a sub-folder, e.g. `/dispatch` |
| `TZ` | server default | Time zone for shift checks and sample data |
| `IDLE_TIMEOUT_MINUTES` | `15` | Automatic logoff |
| `ABSOLUTE_TIMEOUT_HOURS` | `12` | Maximum session length |
| `SEED_SAMPLE_DATA` | `true` | Create sample calls on first start |
| `SECURE_COOKIES` | on in production | Override for testing over plain HTTP |
| `GPS_INGEST_KEY` | | Shared secret for the GPS webhook. The webhook is off until this is set |
| `GPS_PROVIDER` | | `samsara` to poll Samsara instead of (or as well as) the webhook |
| `SAMSARA_API_TOKEN` | | Samsara API token, read-only vehicle locations scope |
| `GPS_POLL_SECONDS` | `15` | Samsara polling interval |
| `GPS_STALE_MINUTES` | `5` | After this long without a fix a truck is shown as stale |
| `GPS_SIMULATOR` | on outside production | Moves the sample trucks (device ids starting `SIM-`) for demos |
| `GPS_SIM_CENTER` | `39.9526,-75.1652` | Where simulated trucks drive, as `lat,lon` |
| `MAP_TILE_URL` | OpenStreetMap | Map tile URL template. Use a paid tile provider for production traffic |
| `MAP_ATTRIBUTION` | OpenStreetMap | Attribution text for the tiles |

## Connecting truck GPS

1. In **Menu → Crews & trucks**, set each truck's **GPS device id** to the id your provider uses
   (IMEI, Traccar unique id, or Samsara vehicle name or id).
2. Pick one way in:
   - **Webhook (any provider):** `POST https://YOUR-SITE/api/gps/ingest` with header `X-GPS-Key: <GPS_INGEST_KEY>`
     and JSON `{"deviceId":"...","lat":..,"lon":..,"speedMph":..,"heading":..,"timestamp":"..."}` (one object,
     an array, or `{"positions":[...]}`). `latitude`/`longitude`, `speedKph` and `imei` are accepted too.
   - **Traccar:** set `forward.url` to `https://YOUR-SITE/api/gps/ingest?format=traccar&key=<GPS_INGEST_KEY>`
     with `forward.json=true`.
   - **Samsara:** set `GPS_PROVIDER=samsara` and `SAMSARA_API_TOKEN`.
3. Set `GPS_SIMULATOR=false` in production so only real devices move.

Positions carry no patient data. The map uses OpenStreetMap tiles by default, which are fine for testing;
their usage policy asks heavy users to bring their own tile provider.

