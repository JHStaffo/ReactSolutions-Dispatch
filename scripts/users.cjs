#!/usr/bin/env node
/*
 * Manage sign-in accounts in the encrypted data store.
 * Stop (or be ready to restart) the app first: the running server keeps data in memory.
 *
 *   node scripts/users.cjs list
 *   node scripts/users.cjs add <username> "<Display Name>" <dispatcher|supervisor|viewer> <password>
 *   node scripts/users.cjs set-password <username> <password>
 *   node scripts/users.cjs disable <username>
 *   node scripts/users.cjs enable <username>
 *
 * Uses the same DATA_DIR and DATA_ENCRYPTION_KEY environment variables as the app.
 */
const fs = require('node:fs');
const path = require('node:path');
const { loadKey, encryptJson, decryptJson, hashPassword } = require('../build/server/src/crypto.js');
const { config } = require('../build/server/src/config.js');

const file = path.join(config.dataDir, 'store.enc');
if (!fs.existsSync(file)) {
  console.error(`No data store at ${file}. Start the app once first.`);
  process.exit(1);
}
const key = loadKey();
const state = decryptJson(fs.readFileSync(file, 'utf8'), key);
const [cmd, username, ...rest] = process.argv.slice(2);
const find = () => state.users.find((u) => u.username.toLowerCase() === String(username).toLowerCase());
const save = () => {
  fs.writeFileSync(file + '.tmp', encryptJson(state, key), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
  console.log('Saved. Restart the app to load the change.');
};
const checkPw = (pw) => {
  if (!pw || pw.length < 12) {
    console.error('Password must be at least 12 characters.');
    process.exit(1);
  }
};

switch (cmd) {
  case 'list':
    for (const u of state.users) console.log(`${u.username.padEnd(16)} ${u.role.padEnd(11)} ${u.disabled ? 'DISABLED ' : ''}${u.displayName}`);
    break;
  case 'add': {
    const [displayName, role, pw] = rest;
    if (!username || !displayName || !['dispatcher', 'supervisor', 'viewer'].includes(role)) {
      console.error('Usage: add <username> "<Display Name>" <dispatcher|supervisor|viewer> <password>');
      process.exit(1);
    }
    if (find()) {
      console.error('That username already exists.');
      process.exit(1);
    }
    checkPw(pw);
    state.users.push({ username, displayName, role, passwordHash: hashPassword(pw), disabled: false });
    save();
    break;
  }
  case 'set-password': {
    const u = find();
    if (!u) throw new Error('No such user');
    checkPw(rest[0]);
    u.passwordHash = hashPassword(rest[0]);
    save();
    break;
  }
  case 'disable':
  case 'enable': {
    const u = find();
    if (!u) throw new Error('No such user');
    u.disabled = cmd === 'disable';
    save();
    break;
  }
  default:
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 15).join('\n'));
}
