import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { log } from './log';

/**
 * Encryption at rest: the data store is written as AES-256-GCM ciphertext.
 * Production requires DATA_ENCRYPTION_KEY (32 bytes, base64). Keep the key out of the
 * repository and out of the data directory (set it as an environment variable in cPanel).
 */
export function loadKey(): Buffer {
  const env = process.env.DATA_ENCRYPTION_KEY;
  if (env) {
    const key = Buffer.from(env, 'base64');
    if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes, base64 encoded');
    return key;
  }
  if (config.isProd) {
    throw new Error('DATA_ENCRYPTION_KEY is required when NODE_ENV=production');
  }
  const p = path.join(config.dataDir, '.dev-encryption-key');
  if (fs.existsSync(p)) return Buffer.from(fs.readFileSync(p, 'utf8').trim(), 'base64');
  const key = crypto.randomBytes(32);
  fs.writeFileSync(p, key.toString('base64'), { mode: 0o600 });
  log('warn', 'Generated a development encryption key in the data directory. Set DATA_ENCRYPTION_KEY in production.');
  return key;
}

interface Envelope {
  v: 1;
  alg: 'aes-256-gcm';
  iv: string;
  tag: string;
  data: string;
}

export function encryptJson(value: unknown, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const env: Envelope = {
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
  return JSON.stringify(env);
}

export function decryptJson<T>(text: string, key: Buffer): T {
  const env = JSON.parse(text) as Envelope;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(env.tag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(env.data, 'base64')), decipher.final()]);
  return JSON.parse(plain.toString('utf8')) as T;
}

export function hashPassword(password: string, salt = crypto.randomBytes(16)): string {
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}
