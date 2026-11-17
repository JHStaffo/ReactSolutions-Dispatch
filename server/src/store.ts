import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Call, CallSummary, Crew, Facility, GpsPosition, Patient, Role, ServerEvent } from '../../shared/types';
import { ageFromDob, paperworkAlerts } from '../../shared/types';
import { config } from './config';
import { decryptJson, encryptJson, loadKey } from './crypto';
import { log } from './log';

export interface StoredUser {
  username: string;
  displayName: string;
  role: Role;
  passwordHash: string;
  disabled: boolean;
  crewId?: string | null;
}

export interface State {
  crews: Crew[];
  calls: Call[];
  facilities: Facility[];
  users: StoredUser[];
  patients: Patient[];
  nextCallNumber: number;
  nextPatientNumber: number;
  /** Last known position per GPS device, so the map isn't empty after a restart. */
  lastPositions: GpsPosition[];
}

type EventInput =
  | { type: 'call'; action: string; actor: string; call: CallSummary; prevCrewId?: string | null }
  | { type: 'crew'; action: string; actor: string; crew: Crew }
  | { type: 'reset'; actor: string }
  | { type: 'gps'; positions: GpsPosition[] }
  | { type: 'facilities'; facilities: Facility[] }
  | { type: 'presence'; users: { displayName: string; role: Role }[] };

const EVENT_BUFFER = 1000;

/**
 * Single-process, in-memory store persisted as one AES-256-GCM encrypted file.
 * Every mutation goes through this process, which is what makes optimistic
 * version checks safe when several dispatchers act at the same moment.
 */
class Store {
  state!: State;
  private key!: Buffer;
  private saveTimer: NodeJS.Timeout | null = null;
  /** Changes every restart so clients know to reload instead of replaying events. */
  readonly bootId = crypto.randomUUID();
  seq = 0;
  private events: ServerEvent[] = [];
  private listeners = new Set<(e: ServerEvent) => void>();

  get file() {
    return path.join(config.dataDir, 'store.enc');
  }

  init(seed: () => State) {
    fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    this.key = loadKey();
    if (fs.existsSync(this.file)) {
      try {
        this.state = decryptJson<State>(fs.readFileSync(this.file, 'utf8'), this.key);
      } catch {
        throw new Error(`Cannot decrypt ${this.file}: DATA_ENCRYPTION_KEY does not match the key the data was written with, or the file was altered.`);
      }
      migrate(this.state);
      log('info', 'Loaded encrypted data store', { calls: this.state.calls.length, crews: this.state.crews.length });
    } else {
      this.state = seed();
      this.saveNow();
      log('info', 'Created new encrypted data store with sample data');
    }
  }

  call(id: string) {
    return this.state.calls.find((c) => c.id === id);
  }

  patient(id: string | null | undefined) {
    return id ? this.state.patients.find((p) => p.id === id) : undefined;
  }

  nextPatientNumber(): string {
    return `P-${String(this.state.nextPatientNumber++).padStart(6, '0')}`;
  }

  crew(id: string) {
    return this.state.crews.find((c) => c.id === id);
  }

  nextCallNumber(): string {
    const n = this.state.nextCallNumber++;
    const d = new Date();
    return `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}-${String(n).padStart(4, '0')}`;
  }

  save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, 200);
  }

  saveNow() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, encryptJson(this.state, this.key), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  emit(e: EventInput) {
    // Presence and GPS are ephemeral: they do not advance the sequence and are not replayed.
    const ephemeral = e.type === 'presence' || e.type === 'gps';
    const evt = { ...e, seq: ephemeral ? this.seq : ++this.seq } as ServerEvent;
    if (!ephemeral) {
      this.events.push(evt);
      if (this.events.length > EVENT_BUFFER) this.events.shift();
    }
    for (const l of this.listeners) l(evt);
  }

  /** Events after `since`, or null when the client is too far behind and must reload. */
  eventsSince(since: number): ServerEvent[] | null {
    if (since === this.seq) return [];
    if (since > this.seq) return null;
    const first = this.events[0];
    if (!first || first.seq > since + 1) return null;
    return this.events.filter((e) => e.seq > since);
  }

  subscribe(fn: (e: ServerEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const store = new Store();

/** Minimum-necessary projection used for the board. No DOB, insurance or clinical narrative. */
export function summarize(c: Call): CallSummary {
  return {
    id: c.id,
    callNumber: c.callNumber,
    version: c.version,
    status: c.status,
    statusTimes: c.statusTimes,
    level: c.level,
    tripType: c.tripType,
    patientDisplay: `${c.patient.lastName}, ${c.patient.firstName.charAt(0)}.`,
    age: ageFromDob(c.patient.dob),
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
    alerts:
      c.status === 'COMPLETED' || c.status === 'CANCELLED'
        ? []
        : c.patientId
          ? paperworkAlerts(store.patient(c.patientId), new Date(c.scheduledStart || c.pickupTime || Date.now()), c.tripType)
          : c.pcsOnFile || c.tripType === 'SNF_TO_ER'
            ? []
            : ['No PCS'],
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    updatedBy: c.updatedBy,
  };
}

/** Read-only viewers see initials only (minimum necessary). */
export function forRole(s: CallSummary, role: Role): CallSummary {
  if (role !== 'viewer') return s;
  const [last, first] = s.patientDisplay.split(', ');
  return { ...s, patientDisplay: `${(first || '').charAt(0)}${last.charAt(0)}` };
}

/** Bring a data store written by an older version up to the current shape. */
function migrate(s: State) {
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
