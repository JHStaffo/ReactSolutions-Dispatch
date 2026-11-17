"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadKey = loadKey;
exports.encryptJson = encryptJson;
exports.decryptJson = decryptJson;
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const config_1 = require("./config");
const log_1 = require("./log");
/**
 * Encryption at rest: the data store is written as AES-256-GCM ciphertext.
 * Production requires DATA_ENCRYPTION_KEY (32 bytes, base64). Keep the key out of the
 * repository and out of the data directory (set it as an environment variable in cPanel).
 */
function loadKey() {
    const env = process.env.DATA_ENCRYPTION_KEY;
    if (env) {
        const key = Buffer.from(env, 'base64');
        if (key.length !== 32)
            throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes, base64 encoded');
        return key;
    }
    if (config_1.config.isProd) {
        throw new Error('DATA_ENCRYPTION_KEY is required when NODE_ENV=production');
    }
    const p = node_path_1.default.join(config_1.config.dataDir, '.dev-encryption-key');
    if (node_fs_1.default.existsSync(p))
        return Buffer.from(node_fs_1.default.readFileSync(p, 'utf8').trim(), 'base64');
    const key = node_crypto_1.default.randomBytes(32);
    node_fs_1.default.writeFileSync(p, key.toString('base64'), { mode: 0o600 });
    (0, log_1.log)('warn', 'Generated a development encryption key in the data directory. Set DATA_ENCRYPTION_KEY in production.');
    return key;
}
function encryptJson(value, key) {
    const iv = node_crypto_1.default.randomBytes(12);
    const cipher = node_crypto_1.default.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    const env = {
        v: 1,
        alg: 'aes-256-gcm',
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: data.toString('base64'),
    };
    return JSON.stringify(env);
}
function decryptJson(text, key) {
    const env = JSON.parse(text);
    const decipher = node_crypto_1.default.createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(env.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(env.data, 'base64')), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
}
function hashPassword(password, salt = node_crypto_1.default.randomBytes(16)) {
    const hash = node_crypto_1.default.scryptSync(password, salt, 64);
    return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function verifyPassword(password, stored) {
    const [scheme, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt' || !saltB64 || !hashB64)
        return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = node_crypto_1.default.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
    return node_crypto_1.default.timingSafeEqual(expected, actual);
}
