// Startup file for cPanel (Setup Node.js App or Application Manager, both run by Phusion Passenger)
// and `npm start`. Run `npm run build` first; this loads the compiled server.
//
// Settings can come from the hosting panel's environment variables, or from a private file
// `~/dispatch.env` (one NAME=value per line; override the path with DISPATCH_ENV_FILE).
// Keep that file outside public_html and readable only by you: chmod 600 ~/dispatch.env
// Variables already set in the environment win over the file.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(function loadEnvFile() {
  const file = process.env.DISPATCH_ENV_FILE || path.join(os.homedir(), 'dispatch.env');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return; // no file: rely on the environment
  }
  try {
    if ((fs.statSync(file).mode & 0o077) !== 0) {
      console.error(JSON.stringify({ level: 'warn', msg: `${file} can be read by other users. Run: chmod 600 ${file}` }));
    }
  } catch {
    /* ignore */
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
})();

require('./build/server/src/index.js');
