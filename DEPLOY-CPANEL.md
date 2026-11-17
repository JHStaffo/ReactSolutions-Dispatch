# Deploying on cPanel

This app runs as a single Node.js application under cPanel's **Setup Node.js App**
(Phusion Passenger, or LiteSpeed on some hosts). It has no native modules and no database server:
data lives in one encrypted file.

## 1. Build the bundle (on your own computer)

You need Node.js 18.18 or newer.

```bash
npm install
npm run package
```

This creates `release/reactsolutions-dispatch.zip` containing only compiled code and a small
`package.json` with the three runtime dependencies (express, ws, zod).

> Prefer building on the server? Clone the repo with cPanel **Git Version Control**, then in the
> Node.js app screen click **Run NPM Install** and use **Run JS script → build**. Shared hosts often
> limit memory, so building locally is more reliable.

## 2. Upload

1. In **File Manager**, upload the zip to your home directory (not inside `public_html`) and **Extract** it.
   You now have `~/reactsolutions-dispatch/`.
2. Create a folder for data, also outside `public_html`, e.g. `~/dispatch-data`.

## 3. Create the Node.js application

cPanel → **Setup Node.js App** → **Create Application**:

| Field | Value |
| --- | --- |
| Node.js version | 18 or newer (20 or 22 recommended) |
| Application mode | Production |
| Application root | `reactsolutions-dispatch` |
| Application URL | your domain or sub-domain, e.g. `dispatch.example.com` (a sub-folder like `/dispatch` also works, see `APP_BASE_PATH`) |
| Application startup file | `app.js` |

Add these **environment variables**, then click **Create**:

| Name | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATA_ENCRYPTION_KEY` | 32 random bytes, base64. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. **Store a copy somewhere safe: without it the data cannot be read.** |
| `DATA_DIR` | absolute path of the data folder, e.g. `/home/USERNAME/dispatch-data` |
| `DEMO_PASSWORD` | initial password for the starter accounts (12+ characters) |
| `TZ` | your dispatch time zone, e.g. `America/New_York` (used for shift checks and sample data) |
| `APP_BASE_PATH` | only if the Application URL is a sub-folder, e.g. `/dispatch` |
| `SEED_SAMPLE_DATA` | `true` for the demo; `false` to start with no sample calls |
| `IDLE_TIMEOUT_MINUTES` | optional, default `15` |
| `GPS_INGEST_KEY` | long random string; turns on the GPS webhook (see README, "Connecting truck GPS") |
| `GPS_SIMULATOR` | `true` to keep the sample trucks moving for a demo, `false` once real GPS is connected |
| `GPS_SIM_CENTER` | optional `lat,lon` of your service area for the simulated trucks |
| `GPS_PROVIDER` / `SAMSARA_API_TOKEN` | only if you use Samsara |

Then click **Run NPM Install**, and **Restart**.

## 4. Turn on HTTPS

Use **SSL/TLS Status → Run AutoSSL** (or install your certificate) for the domain. In production the session
cookie is marked `Secure`, so sign-in only works over HTTPS. Also force HTTPS redirects
(**Domains → Force HTTPS Redirect**).

## 5. First sign-in

Starter accounts (password = your `DEMO_PASSWORD`): `dispatch1`, `dispatch2`, `supervisor`, `viewer`, and the crew
accounts `medic12` and `bls3` (open the site on a phone to get the crew screen).
Supervisors can add, disable and reset users from **Menu → Users**. You can also manage accounts from the cPanel **Terminal**:

```bash
source /home/USERNAME/nodevenv/reactsolutions-dispatch/20/bin/activate   # path shown at the top of the Node.js app page
cd ~/reactsolutions-dispatch
node scripts/users.cjs list
node scripts/users.cjs add jsmith "J. Smith" dispatcher 'a-long-password'
node scripts/users.cjs disable viewer
```

The environment variables must be set in that shell too (`export DATA_DIR=... DATA_ENCRYPTION_KEY=...`).
Restart the app after changing users.

## Notes for this host type

- **Keep one app process.** All live state is in one process, which is what makes simultaneous
  dispatcher actions safe. Passenger runs one Node process per app by default; don't raise the
  instance count. (Moving the store to MySQL would lift this limit.)
- **Live updates.** The board uses WebSockets. If your host's proxy blocks them (some LiteSpeed
  setups do), the app falls back to checking for changes every 4 seconds; the top bar then shows
  "Polling" instead of "Live". Nothing else changes.
- **Backups.** Back up `DATA_DIR` (it is encrypted) and keep the key separately.
- **Logs.** Passenger writes the app's stdout to `stderr.log` in the app root. Those logs contain no
  patient data: request paths have ids removed, and bodies and query strings are never logged.
