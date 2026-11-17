// Domain types shared by the server and the browser client.
// All patient values in this prototype are SAMPLE data, but they are handled as PHI.

export type Level = 'ALS' | 'BLS';
export type Role = 'dispatcher' | 'supervisor' | 'viewer' | 'crew';

export const TRIP_TYPES = {
  DIALYSIS: 'Dialysis',
  APPOINTMENT: "Doctor's appointment",
  INTERFACILITY: 'Interfacility transfer',
  DISCHARGE: 'Hospital discharge',
  SNF_TO_ER: 'SNF to ER',
  OTHER: 'Other',
} as const;
export type TripType = keyof typeof TRIP_TYPES;

export const EQUIPMENT = {
  OXYGEN: 'Oxygen',
  CARDIAC_MONITOR: 'Cardiac monitor',
  IV_PUMP: 'IV pump',
  VENTILATOR: 'Ventilator',
  SUCTION: 'Suction',
  BARIATRIC_STRETCHER: 'Bariatric stretcher',
  STAIR_CHAIR: 'Stair chair',
  RESTRAINTS: 'Soft restraints',
  ISOLATION: 'Isolation precautions',
} as const;
export type Equipment = keyof typeof EQUIPMENT;

/** Equipment that normally requires an ALS crew. */
export const ALS_EQUIPMENT: Equipment[] = ['CARDIAC_MONITOR', 'IV_PUMP', 'VENTILATOR'];
export const BARIATRIC_LBS = 350;

export const DEFAULT_DURATION_MIN: Record<TripType, number> = {
  DIALYSIS: 60,
  APPOINTMENT: 60,
  INTERFACILITY: 90,
  DISCHARGE: 60,
  SNF_TO_ER: 45,
  OTHER: 60,
};

export const STATUSES = {
  QUEUED: 'Queued',
  ASSIGNED: 'Assigned',
  ENROUTE: 'En route',
  ON_SCENE: 'On scene',
  TRANSPORTING: 'Transporting',
  AT_DESTINATION: 'At destination',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
} as const;
export type CallStatus = keyof typeof STATUSES;

/** Normal forward progression once a crew is assigned. */
export const STATUS_FLOW: CallStatus[] = ['ASSIGNED', 'ENROUTE', 'ON_SCENE', 'TRANSPORTING', 'AT_DESTINATION', 'COMPLETED'];
export const ACTIVE_STATUSES: CallStatus[] = ['ENROUTE', 'ON_SCENE', 'TRANSPORTING', 'AT_DESTINATION'];

/** ASAP = as soon as possible, SCHEDULED = fixed pickup time, WILL_CALL = facility will call when the patient is ready. */
export type PickupMode = 'ASAP' | 'SCHEDULED' | 'WILL_CALL';

export interface CrewMember {
  name: string;
  cert: 'Paramedic' | 'AEMT' | 'EMT';
}

export interface Crew {
  id: string;
  unit: string; // radio designation, e.g. "Medic 12"
  vehicle: string; // truck number
  phone: string;
  level: Level;
  members: CrewMember[];
  shiftStart: string; // "HH:mm" local
  shiftEnd: string; // "HH:mm" local, may be < shiftStart for overnight
  outOfService: boolean;
  oosReason: string;
  /** Id of the third-party GPS unit installed in this truck (as the vendor reports it). */
  gpsDeviceId: string;
  /** Inactive crews are kept for history but hidden from the board. */
  active: boolean;
  version: number;
}

export interface GpsPosition {
  deviceId: string;
  crewId: string | null;
  lat: number;
  lon: number;
  speedMph: number;
  heading: number;
  at: string; // fix time reported by the device
  receivedAt: string;
  source: string; // generic | traccar | samsara | simulator | phone
}

export interface Patient {
  id: string;
  patientNumber: string; // internal, e.g. P-000123; never the SSN or insurer member id
  version: number;
  firstName: string;
  lastName: string;
  dob: string;
  sex: 'F' | 'M' | 'X' | 'U';
  weightLbs: number;
  phone: string;
  address: string;
  insurance: { payer: string; memberId: string };
  /** Physician Certification Statement expiry (YYYY-MM-DD), null if none on file. */
  pcsExpires: string | null;
  priorAuth: { number: string; expires: string | null; tripsAuthorized: number | null };
  defaultLevel: Level;
  defaultEquipment: Equipment[];
  stretcherReason: string; // usual medical-necessity statement
  medicalNotes: string; // diagnoses, allergies, isolation history
  active: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

/** Search result: enough to pick the right patient, nothing more. */
export interface PatientSummary {
  id: string;
  patientNumber: string;
  name: string; // "Last, First"
  dob: string;
  age: number;
  payer: string;
  nextTrip: string | null;
  lastTrip: string | null;
  alerts: string[];
}

/** Paperwork problems for a trip date: missing/expired PCS, expired prior auth. */
export function paperworkAlerts(p: Pick<Patient, 'pcsExpires' | 'priorAuth'> | null | undefined, tripDate: Date, tripType?: TripType): string[] {
  if (!p) return [];
  const out: string[] = [];
  const day = (s: string) => new Date(s + 'T23:59:59');
  const soon = (d: Date) => d.getTime() - tripDate.getTime() < 7 * 86400000;
  if (tripType !== 'SNF_TO_ER') {
    if (!p.pcsExpires) out.push('No PCS');
    else if (day(p.pcsExpires) < tripDate) out.push('PCS expired');
    else if (soon(day(p.pcsExpires))) out.push('PCS expiring');
  }
  if (p.priorAuth?.number && p.priorAuth.expires) {
    if (day(p.priorAuth.expires) < tripDate) out.push('Auth expired');
    else if (soon(day(p.priorAuth.expires))) out.push('Auth expiring');
  }
  return out;
}

export const FACILITY_KINDS = ['Hospital', 'Dialysis', 'SNF', 'Clinic', 'Residence', 'Other'] as const;
export interface Facility {
  id: string;
  name: string;
  kind: (typeof FACILITY_KINDS)[number];
  address: string;
  phone: string;
  lat: number | null;
  lon: number | null;
}

export interface CallHistoryEntry {
  ts: string;
  actor: string;
  action: string;
  detail?: string; // never patient values
}

/** Full call record. Only returned by the audited detail endpoint. */
export interface Call {
  id: string; // random UUID; never derived from patient data
  callNumber: string;
  version: number;
  status: CallStatus;
  statusTimes: Partial<Record<CallStatus, string>>;
  level: Level;
  tripType: TripType;
  patient: { firstName: string; lastName: string; dob: string; weightLbs: number };
  insurance: { payer: string; memberId: string; priorAuth: string };
  pcsOnFile: boolean; // Physician Certification Statement for medical necessity
  equipment: Equipment[];
  chiefComplaint: string;
  stretcherReason: string;
  pickupMode: PickupMode;
  pickupTime: string | null; // ISO; required for SCHEDULED
  pickupLocation: string;
  destination: string;
  durationMin: number;
  notes: string;
  crewId: string | null;
  scheduledStart: string | null; // ISO
  cancelReason: string;
  /** Round trips: the outbound and return legs point at each other. */
  linkedCallId: string | null;
  leg: 'ONE_WAY' | 'OUTBOUND' | 'RETURN';
  seriesId: string | null; // recurring standing orders (e.g. dialysis M/W/F)
  patientId: string | null;
  /** Patient-on-board miles: from GPS between Transporting and At destination, or entered by hand. */
  loadedMiles: number | null;
  history: CallHistoryEntry[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

/** Minimum-necessary view used on the board and in live updates. */
export interface CallSummary {
  id: string;
  callNumber: string;
  version: number;
  status: CallStatus;
  statusTimes: Partial<Record<CallStatus, string>>;
  level: Level;
  tripType: TripType;
  patientDisplay: string; // "Lastname, F."
  age: number;
  weightLbs: number;
  equipment: Equipment[];
  pcsOnFile: boolean;
  pickupMode: PickupMode;
  pickupTime: string | null;
  pickupLocation: string;
  destination: string;
  durationMin: number;
  crewId: string | null;
  scheduledStart: string | null;
  leg: Call['leg'];
  linkedCallId: string | null;
  seriesId: string | null;
  patientId: string | null;
  loadedMiles: number | null;
  /** Paperwork warnings, e.g. "PCS expired". */
  alerts: string[];
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface SessionUser {
  username: string;
  displayName: string;
  role: Role;
  /** For crew accounts: the unit they work on. */
  crewId?: string | null;
}

export interface UserInfo extends SessionUser {
  disabled: boolean;
}

export interface MapConfig {
  tileUrl: string;
  attribution: string;
  center: [number, number];
  zoom: number;
}

export type ServerEvent =
  | { seq: number; type: 'call'; action: string; actor: string; call: CallSummary }
  | { seq: number; type: 'crew'; action: string; actor: string; crew: Crew }
  | { seq: number; type: 'reset'; actor: string }
  | { seq: number; type: 'gps'; positions: GpsPosition[] }
  | { seq: number; type: 'facilities'; facilities: Facility[] }
  | { seq: number; type: 'presence'; users: { displayName: string; role: Role }[] };

export interface AssignWarning {
  code: 'ALS_TO_BLS' | 'CREW_OVERLAP' | 'OUTSIDE_SHIFT' | 'CREW_OUT_OF_SERVICE';
  message: string;
}

export function ageFromDob(dob: string, now = new Date()): number {
  const d = new Date(dob + 'T00:00:00');
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

export function haversineMiles(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 3958.8;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLon = toR(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
