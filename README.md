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

**Roles**
- `dispatcher`: take and dispatch calls
- `supervisor`: everything, plus the audit log, reopening closed calls, and resetting sample data
- `viewer`: read-only board with patient initials only; cannot open patient details

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
