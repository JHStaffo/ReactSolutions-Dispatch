"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.store = void 0;
exports.summarize = summarize;
exports.forRole = forRole;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const types_1 = require("../../shared/types");
const config_1 = require("./config");
const crypto_1 = require("./crypto");
const log_1 = require("./log");
const EVENT_BUFFER = 1000;
/**
 * Single-process, in-memory store persisted as one AES-256-GCM encrypted file.
 * Every mutation goes through this process, which is what makes optimistic
 * version checks safe when several dispatchers act at the same moment.
 */
class Store {
    state;
    key;
    saveTimer = null;
    /** Changes every restart so clients know to reload instead of replaying events. */
    bootId = node_crypto_1.default.randomUUID();
    seq = 0;
    events = [];
    listeners = new Set();
    get file() {
        return node_path_1.default.join(config_1.config.dataDir, 'store.enc');
    }
    init(seed) {
        node_fs_1.default.mkdirSync(config_1.config.dataDir, { recursive: true, mode: 0o700 });
        this.key = (0, crypto_1.loadKey)();
        if (node_fs_1.default.existsSync(this.file)) {
            try {
                this.state = (0, crypto_1.decryptJson)(node_fs_1.default.readFileSync(this.file, 'utf8'), this.key);
            }
            catch {
                throw new Error(`Cannot decrypt ${this.file}: DATA_ENCRYPTION_KEY does not match the key the data was written with, or the file was altered.`);
            }
            migrate(this.state);
            (0, log_1.log)('info', 'Loaded encrypted data store', { calls: this.state.calls.length, crews: this.state.crews.length });
        }
        else {
            this.state = seed();
            this.saveNow();
            (0, log_1.log)('info', 'Created new encrypted data store with sample data');
        }
    }
    call(id) {
        return this.state.calls.find((c) => c.id === id);
    }
    patient(id) {
        return id ? this.state.patients.find((p) => p.id === id) : undefined;
    }
    nextPatientNumber() {
        return `P-${String(this.state.nextPatientNumber++).padStart(6, '0')}`;
    }
    crew(id) {
        return this.state.crews.find((c) => c.id === id);
    }
    nextCallNumber() {
        const n = this.state.nextCallNumber++;
        const d = new Date();
        return `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}-${String(n).padStart(4, '0')}`;
    }
    save() {
        if (this.saveTimer)
            return;
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            this.saveNow();
        }, 200);
    }
    saveNow() {
        const tmp = this.file + '.tmp';
        node_fs_1.default.writeFileSync(tmp, (0, crypto_1.encryptJson)(this.state, this.key), { mode: 0o600 });
        node_fs_1.default.renameSync(tmp, this.file);
    }
    emit(e) {
        // Presence and GPS are ephemeral: they do not advance the sequence and are not replayed.
        const ephemeral = e.type === 'presence' || e.type === 'gps';
        const evt = { ...e, seq: ephemeral ? this.seq : ++this.seq };
        if (!ephemeral) {
            this.events.push(evt);
            if (this.events.length > EVENT_BUFFER)
                this.events.shift();
        }
        for (const l of this.listeners)
            l(evt);
    }
    /** Events after `since`, or null when the client is too far behind and must reload. */
    eventsSince(since) {
        if (since === this.seq)
            return [];
        if (since > this.seq)
            return null;
        const first = this.events[0];
        if (!first || first.seq > since + 1)
            return null;
        return this.events.filter((e) => e.seq > since);
    }
    subscribe(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }
}
exports.store = new Store();
/** Minimum-necessary projection used for the board. No DOB, insurance or clinical narrative. */
function summarize(c) {
    return {
        id: c.id,
        callNumber: c.callNumber,
        version: c.version,
        status: c.status,
        statusTimes: c.statusTimes,
        level: c.level,
        tripType: c.tripType,
        patientDisplay: `${c.patient.lastName}, ${c.patient.firstName.charAt(0)}.`,
        age: (0, types_1.ageFromDob)(c.patient.dob),
        weightLbs: c.patient.weightLbs,
        equipment: c.equipment,
        pcsOnFile: c.pcsOnFile,
        pickupMode: c.pickupMode,
        pickupTime: c.pickupTime,
        pickupLocation: c.pickupLocation,
        destination: c.destination,
        durationMin: c.durationMin,
        crewId: c.crewId,
        scheduledStart: c.scheduledStart,
        leg: c.leg,
        linkedCallId: c.linkedCallId,
        seriesId: c.seriesId,
        patientId: c.patientId,
        loadedMiles: c.loadedMiles,
        alerts: c.status === 'COMPLETED' || c.status === 'CANCELLED'
            ? []
            : c.patientId
                ? (0, types_1.paperworkAlerts)(exports.store.patient(c.patientId), new Date(c.scheduledStart || c.pickupTime || Date.now()), c.tripType)
                : c.pcsOnFile || c.tripType === 'SNF_TO_ER'
                    ? []
                    : ['No PCS'],
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        updatedBy: c.updatedBy,
    };
}
/** Read-only viewers see initials only (minimum necessary). */
function forRole(s, role) {
    if (role !== 'viewer')
        return s;
    const [last, first] = s.patientDisplay.split(', ');
    return { ...s, patientDisplay: `${(first || '').charAt(0)}${last.charAt(0)}` };
}
/** Bring a data store written by an older version up to the current shape. */
function migrate(s) {
    s.patients ||= [];
    s.nextPatientNumber ||= 1;
    s.lastPositions ||= [];
    for (const c of s.crews) {
        c.gpsDeviceId ??= '';
        c.active ??= true;
    }
    for (const f of s.facilities) {
        f.lat ??= null;
        f.lon ??= null;
    }
    for (const c of s.calls) {
        c.patientId ??= null;
        c.loadedMiles ??= null;
    }
}
