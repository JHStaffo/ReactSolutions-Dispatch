#!/usr/bin/env node
/*
 * Builds a deployable bundle for cPanel "Setup Node.js App":
 *   release/reactsolutions-dispatch/       (folder you can upload)
 *   release/reactsolutions-dispatch.zip    (same thing, zipped for cPanel File Manager)
 * It contains only compiled code and runtime dependencies (express, ws, zod), no source or dev tools.
 * Run with `npm run package` (which builds first).
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.join(__dirname, '..');
const outRoot = path.join(root, 'release');
const out = path.join(outRoot, 'reactsolutions-dispatch');
fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const copy = (rel) => fs.cpSync(path.join(root, rel), path.join(out, rel), { recursive: true });
copy('app.js');
copy('build');
copy('client/dist');
copy('scripts/users.cjs');
copy('DEPLOY-CPANEL.md');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
fs.writeFileSync(
  path.join(out, 'package.json'),
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      private: true,
      main: 'app.js',
      engines: pkg.engines,
      scripts: { start: 'node app.js', genkey: pkg.scripts.genkey },
      dependencies: pkg.dependencies,
    },
    null,
    2,
  ),
);

// ---- minimal zip writer (deflate), so no external zip tool is needed ----
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(out);
const parts = [];
const central = [];
let offset = 0;
for (const f of files) {
  const name = Buffer.from(path.relative(outRoot, f).split(path.sep).join('/'));
  const data = fs.readFileSync(f);
  const comp = zlib.deflateRawSync(data);
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(0, 10);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(0, 8);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(0, 12);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(comp.length, 20);
  cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(name.length, 28);
  cd.writeUInt32LE(offset, 42);
  central.push(cd, name);
  parts.push(local, name, comp);
  offset += local.length + name.length + comp.length;
}
const cdBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cdBuf.length, 12);
end.writeUInt32LE(offset, 16);
fs.writeFileSync(path.join(outRoot, 'reactsolutions-dispatch.zip'), Buffer.concat([...parts, cdBuf, end]));
console.log(`Packaged ${files.length} files -> release/reactsolutions-dispatch.zip`);
