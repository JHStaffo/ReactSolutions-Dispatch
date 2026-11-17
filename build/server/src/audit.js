"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.audit = audit;
exports.readAudit = readAudit;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const config_1 = require("./config");
const file = () => node_path_1.default.join(config_1.config.dataDir, 'audit.log');
function audit(e) {
    const entry = { ts: new Date().toISOString(), ...e };
    node_fs_1.default.appendFileSync(file(), JSON.stringify(entry) + '\n', { mode: 0o600 });
}
function readAudit(limit = 300) {
    if (!node_fs_1.default.existsSync(file()))
        return [];
    const lines = node_fs_1.default.readFileSync(file(), 'utf8').trim().split('\n').filter(Boolean);
    return lines
        .slice(-limit)
        .reverse()
        .map((l) => JSON.parse(l));
}
