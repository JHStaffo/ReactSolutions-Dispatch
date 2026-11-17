# Deploying on cPanel

This app runs as a single Node.js application under cPanel's **Setup Node.js App**
(Phusion Passenger, or LiteSpeed on some hosts). It has no native modules and no database server:
data lives in one encrypted file.

## Deploy with git (recommended)

The repository has a `release` branch that holds a ready-to-run build: compiled code, a runtime
`package.json` and lockfile, and an `update.sh` script. No source or build tools go to the server.
A GitHub Action rebuilds, tests and republishes that branch on every merge to `main`
(you can also run it by hand from the Actions tab, or run `npm run release` on your own computer).

### First install (cPanel Terminal or SSH)

1. Give the account read-only access to the private repository with a deploy key:

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/dispatch_deploy -N "" -C "cpanel-dispatch"
   cat ~/.ssh/dispatch_deploy.pub
   ```

   On GitHub: repository **Settings → Deploy keys → Add deploy key**, paste the key, leave
   **Allow write access** unchecked. Then tell ssh to use it:

   ```bash
   cat >> ~/.ssh/config <<'EOF'
   Host github-dispatch
     HostName github.com
     User git
     IdentityFile ~/.ssh/dispatch_deploy
     IdentitiesOnly yes
   EOF
   chmod 600 ~/.ssh/config
   ```

2. Clone the release branch into your home directory (not inside `public_html`), and make a data folder:

   ```bash
   git clone --branch release --single-branch github-dispatch:JHStaffo/ReactSolutions-Dispatch.git ~/reactsolutions-dispatch
   mkdir -m 700 ~/dispatch-data
   ```

3. Create the Node.js application and its environment variables as in **step 3** below, with
   Application root `reactsolutions-dispatch` and `DATA_DIR` set to `/home/USERNAME/dispatch-data`.
   Then turn on HTTPS (**step 4**).

4. Install and start:

   ```bash
   ~/reactsolutions-dispatch/update.sh
   ```

### Serving the app at your main domain (public_html)

To have the app answer at the domain whose folder is `public_html`, keep the code in
`~/reactsolutions-dispatch` and point the app's **Application URL** at that domain. cPanel then writes a
small routing block into `public_html/.htaccess` and every request goes to the app. Nothing else needs
to be in `public_html`.

- Move any old site files out of `public_html` first (keep `.htaccess`). Apache can still serve a
  leftover `index.html` or `index.php` instead of the app.
- Don't clone the code into `public_html` itself. Everything there can be fetched as a plain file,
  including `.git` history and server code.
- `DATA_DIR` must be outside `public_html`. In production the app refuses to start if it isn't.

### Updating

After a change is merged and the **Publish release branch** action finishes:

```bash
~/reactsolutions-dispatch/update.sh
```

It pulls the new release, installs any changed dependencies inside the Node.js app's environment,
and restarts the app. Data in `DATA_DIR` and your environment variables are untouched.
`cat ~/reactsolutions-dispatch/RELEASE.txt` shows which commit is running.

To roll back, pick an earlier release and restart:

```bash
cd ~/reactsolutions-dispatch
git log --oneline -10
git reset --hard <commit> && touch tmp/restart.txt
```

The next `update.sh` moves forward to the latest release again.

> Keep `DATA_DIR` outside the app folder so deploys can never touch it. Never commit
> `DATA_ENCRYPTION_KEY` or a `.env` file; set them in the Node.js app screen.

## Or: upload a zip

Use this if the account has no Terminal or SSH access.

### 1. Build the bundle (on your own computer)

You need Node.js 18.18 or newer.

```bash
npm install
npm run package
```

This creates `release/reactsolutions-dispatch.zip` containing only compiled code and a small
`package.json` with the three runtime dependencies (express, ws, zod).

You can also download this zip from any release: on GitHub, switch to the `release` branch and use
**Code → Download ZIP**.

### 2. Upload

1. In **File Manager**, upload the zip to your home directory (not inside `public_html`) and **Extract** it.
   You now have `~/reactsolutions-dispatch/`.
2. Create a folder for data, also outside `public_html`, e.g. `~/dispatch-data`.

## 3. Create the Node.js application

> On standard cPanel (no CloudLinux) this screen is **Application Manager → Register Application**
> instead: Application path `reactsolutions-dispatch`, Base application URL `/`, Deployment environment
> Production, and the same environment variables. If neither screen exists, a server admin adds
> **ea-nodejs20** and **mod_passenger** in WHM → EasyApache 4.

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
