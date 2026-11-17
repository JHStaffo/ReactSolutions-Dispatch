import crypto from 'node:crypto';
import type { Call, Crew, Equipment, Facility, Level, PickupMode, TripType } from '../../shared/types';
import { hashPassword } from './crypto';
import type { State, StoredUser } from './store';

// Everything below is FICTIONAL sample data. Phone numbers use the reserved 555-01xx range.

const crews: Omit<Crew, 'version' | 'outOfService' | 'oosReason'>[] = [
  { id: 'crew-m12', unit: 'Medic 12', vehicle: 'Truck 412', phone: '(555) 010-1212', level: 'ALS', shiftStart: '06:00', shiftEnd: '18:00',
    members: [{ name: 'R. Alvarez', cert: 'Paramedic' }, { name: 'K. Brennan', cert: 'EMT' }] },
  { id: 'crew-m14', unit: 'Medic 14', vehicle: 'Truck 414', phone: '(555) 010-1414', level: 'ALS', shiftStart: '07:00', shiftEnd: '19:00',
    members: [{ name: 'D. Okafor', cert: 'Paramedic' }, { name: 'S. Patel', cert: 'AEMT' }] },
  { id: 'crew-m21', unit: 'Medic 21', vehicle: 'Truck 521', phone: '(555) 010-2121', level: 'ALS', shiftStart: '10:00', shiftEnd: '22:00',
    members: [{ name: 'L. Nguyen', cert: 'Paramedic' }, { name: 'T. Fischer', cert: 'Paramedic' }] },
  { id: 'crew-b3', unit: 'BLS 3', vehicle: 'Truck 303', phone: '(555) 010-0303', level: 'BLS', shiftStart: '05:00', shiftEnd: '17:00',
    members: [{ name: 'M. Castillo', cert: 'EMT' }, { name: 'J. Romero', cert: 'EMT' }] },
  { id: 'crew-b5', unit: 'BLS 5', vehicle: 'Truck 305', phone: '(555) 010-0505', level: 'BLS', shiftStart: '06:00', shiftEnd: '18:00',
    members: [{ name: 'A. Whitfield', cert: 'EMT' }, { name: 'P. Kowalski', cert: 'EMT' }] },
  { id: 'crew-b7', unit: 'BLS 7', vehicle: 'Truck 307', phone: '(555) 010-0707', level: 'BLS', shiftStart: '08:00', shiftEnd: '20:00',
    members: [{ name: 'G. Mensah', cert: 'EMT' }, { name: 'H. Lindqvist', cert: 'EMT' }] },
  { id: 'crew-b9', unit: 'BLS 9', vehicle: 'Truck 309', phone: '(555) 010-0909', level: 'BLS', shiftStart: '12:00', shiftEnd: '00:00',
    members: [{ name: 'C. Dubois', cert: 'EMT' }, { name: 'N. Haddad', cert: 'EMT' }] },
  { id: 'crew-m30', unit: 'Medic 30', vehicle: 'Truck 630', phone: '(555) 010-3030', level: 'ALS', shiftStart: '18:00', shiftEnd: '06:00',
    members: [{ name: 'E. Sato', cert: 'Paramedic' }, { name: 'W. Grant', cert: 'EMT' }] },
];

const facilities: Facility[] = [
  { id: 'f1', name: 'Riverside Dialysis Center', kind: 'Dialysis', address: '100 River Rd, Suite 2', phone: '(555) 010-4001' },
  { id: 'f2', name: 'Northgate Kidney Care', kind: 'Dialysis', address: '2250 Northgate Blvd', phone: '(555) 010-4002' },
  { id: 'f3', name: 'Mercy General Hospital', kind: 'Hospital', address: '500 Mercy Way', phone: '(555) 010-4003' },
  { id: 'f4', name: 'St. Anselm Medical Center', kind: 'Hospital', address: '77 Cathedral Ave', phone: '(555) 010-4004' },
  { id: 'f5', name: 'Lakeview Regional ER', kind: 'Hospital', address: '1 Lakeview Dr', phone: '(555) 010-4005' },
  { id: 'f6', name: 'Oak Hollow Skilled Nursing', kind: 'SNF', address: '48 Oak Hollow Ln', phone: '(555) 010-4006' },
  { id: 'f7', name: 'Maple Gardens Rehab & SNF', kind: 'SNF', address: '913 Maple St', phone: '(555) 010-4007' },
  { id: 'f8', name: 'Summit Cardiology Clinic', kind: 'Clinic', address: '3400 Summit Pkwy, Fl 3', phone: '(555) 010-4008' },
  { id: 'f9', name: 'Eastside Orthopedics', kind: 'Clinic', address: '61 East Market St', phone: '(555) 010-4009' },
  { id: 'f10', name: 'Valley Imaging Center', kind: 'Clinic', address: '820 Valley View Rd', phone: '(555) 010-4010' },
];

const users: Array<Omit<StoredUser, 'passwordHash' | 'disabled'>> = [
  { username: 'dispatch1', displayName: 'Dispatcher One', role: 'dispatcher' },
  { username: 'dispatch2', displayName: 'Dispatcher Two', role: 'dispatcher' },
  { username: 'supervisor', displayName: 'Shift Supervisor', role: 'supervisor' },
  { username: 'viewer', displayName: 'Read-only Viewer', role: 'viewer' },
];

export const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Dispatch!2026';

interface SampleCall {
  first: string; last: string; dob: string; lbs: number; level: Level; trip: TripType;
  payer: string; member: string; eq: Equipment[]; cc: string; why: string;
  from: string; to: string; mode: PickupMode; at?: string; crew?: string; dur?: number;
  status?: Call['status']; leg?: Call['leg'];
}

const sample: SampleCall[] = [
  { first: 'Ada', last: 'Sample', dob: '1948-03-14', lbs: 162, level: 'BLS', trip: 'DIALYSIS', payer: 'Medicare Part B', member: 'SMP-0001-A', eq: ['OXYGEN'],
    cc: 'ESRD, scheduled hemodialysis', why: 'Bed-confined; unable to sit upright for transport duration', from: 'Oak Hollow Skilled Nursing', to: 'Riverside Dialysis Center',
    mode: 'SCHEDULED', at: '06:30', crew: 'crew-b3', status: 'COMPLETED', leg: 'OUTBOUND' },
  { first: 'Ada', last: 'Sample', dob: '1948-03-14', lbs: 162, level: 'BLS', trip: 'DIALYSIS', payer: 'Medicare Part B', member: 'SMP-0001-A', eq: ['OXYGEN'],
    cc: 'ESRD, return from hemodialysis', why: 'Bed-confined; post-dialysis hypotension risk', from: 'Riverside Dialysis Center', to: 'Oak Hollow Skilled Nursing',
    mode: 'SCHEDULED', at: '11:00', crew: 'crew-b3', status: 'ASSIGNED', leg: 'RETURN' },
  { first: 'Bruno', last: 'Testcase', dob: '1956-11-02', lbs: 410, level: 'BLS', trip: 'DIALYSIS', payer: 'Medicaid', member: 'SMP-0002-B', eq: ['BARIATRIC_STRETCHER', 'STAIR_CHAIR'],
    cc: 'ESRD, morbid obesity', why: 'Bariatric patient, non-ambulatory, requires 4-person lift', from: '12 Example Ct (residence)', to: 'Northgate Kidney Care',
    mode: 'SCHEDULED', at: '07:15', crew: 'crew-b5', status: 'ENROUTE', dur: 75 },
  { first: 'Clara', last: 'Demo', dob: '1939-07-21', lbs: 118, level: 'ALS', trip: 'INTERFACILITY', payer: 'Sample Health PPO', member: 'SMP-0003-C', eq: ['CARDIAC_MONITOR', 'IV_PUMP', 'OXYGEN'],
    cc: 'NSTEMI, transfer for cardiac catheterization', why: 'Continuous cardiac monitoring and titrated IV drip required', from: 'Lakeview Regional ER', to: 'St. Anselm Medical Center',
    mode: 'SCHEDULED', at: '09:00', crew: 'crew-m12', status: 'ASSIGNED', dur: 90 },
  { first: 'Dmitri', last: 'Placeholder', dob: '1951-01-30', lbs: 205, level: 'BLS', trip: 'DISCHARGE', payer: 'Medicare Part A', member: 'SMP-0004-D', eq: [],
    cc: 'Post hip-arthroplasty discharge', why: 'Non-weight-bearing, unable to sit >30 min per ortho orders', from: 'Mercy General Hospital', to: 'Maple Gardens Rehab & SNF',
    mode: 'SCHEDULED', at: '10:30', crew: 'crew-b7', status: 'ASSIGNED' },
  { first: 'Elena', last: 'Mockwell', dob: '1944-09-09', lbs: 140, level: 'BLS', trip: 'APPOINTMENT', payer: 'Medicare Part B', member: 'SMP-0005-E', eq: ['OXYGEN'],
    cc: 'CHF follow-up', why: 'Bed-confined, continuous O2 2 L/min, cannot tolerate wheelchair', from: 'Maple Gardens Rehab & SNF', to: 'Summit Cardiology Clinic',
    mode: 'SCHEDULED', at: '13:00', leg: 'OUTBOUND' },
  { first: 'Elena', last: 'Mockwell', dob: '1944-09-09', lbs: 140, level: 'BLS', trip: 'APPOINTMENT', payer: 'Medicare Part B', member: 'SMP-0005-E', eq: ['OXYGEN'],
    cc: 'CHF follow-up, return', why: 'Bed-confined, continuous O2 2 L/min', from: 'Summit Cardiology Clinic', to: 'Maple Gardens Rehab & SNF',
    mode: 'WILL_CALL', leg: 'RETURN' },
  { first: 'Frank', last: 'Fakename', dob: '1937-05-17', lbs: 176, level: 'ALS', trip: 'SNF_TO_ER', payer: 'Medicare Part B', member: 'SMP-0006-F', eq: ['CARDIAC_MONITOR', 'OXYGEN'],
    cc: 'Altered mental status, hypotension 88/50', why: 'Unstable vitals, requires ALS monitoring', from: 'Oak Hollow Skilled Nursing', to: 'Lakeview Regional ER',
    mode: 'ASAP', dur: 45 },
  { first: 'Gina', last: 'Specimen', dob: '1962-12-03', lbs: 238, level: 'BLS', trip: 'APPOINTMENT', payer: 'Sample Health HMO', member: 'SMP-0007-G', eq: [],
    cc: 'MRI lumbar spine', why: 'Paraplegic, unable to transfer to wheelchair safely', from: '88 Example Ave (residence)', to: 'Valley Imaging Center',
    mode: 'SCHEDULED', at: '14:30' },
  { first: 'Hugo', last: 'Example', dob: '1949-04-26', lbs: 190, level: 'ALS', trip: 'INTERFACILITY', payer: 'Medicare Part A', member: 'SMP-0008-H', eq: ['VENTILATOR', 'CARDIAC_MONITOR', 'SUCTION'],
    cc: 'Respiratory failure, vent-dependent, transfer to LTACH', why: 'Mechanical ventilation in transit', from: 'St. Anselm Medical Center', to: 'Mercy General Hospital',
    mode: 'SCHEDULED', at: '15:00', dur: 120 },
  { first: 'Iris', last: 'Trial', dob: '1958-08-08', lbs: 150, level: 'BLS', trip: 'DIALYSIS', payer: 'Medicaid', member: 'SMP-0009-I', eq: ['ISOLATION'],
    cc: 'ESRD, MRSA contact precautions', why: 'Bed-confined following BKA, contact isolation', from: 'Maple Gardens Rehab & SNF', to: 'Northgate Kidney Care',
    mode: 'SCHEDULED', at: '12:00', crew: 'crew-b9', status: 'ASSIGNED' },
  { first: 'Jonas', last: 'Dummy', dob: '1971-02-19', lbs: 260, level: 'BLS', trip: 'DISCHARGE', payer: 'Sample Health PPO', member: 'SMP-0010-J', eq: ['STAIR_CHAIR'],
    cc: 'Discharge home after CVA', why: 'Left hemiplegia, unable to ambulate or sit unsupported', from: 'Lakeview Regional ER', to: '45 Example Blvd, 3rd floor walk-up',
    mode: 'ASAP' },
  { first: 'Kay', last: 'Fixture', dob: '1945-10-11', lbs: 128, level: 'ALS', trip: 'SNF_TO_ER', payer: 'Medicare Part B', member: 'SMP-0011-K', eq: ['CARDIAC_MONITOR'],
    cc: 'Chest pain, new onset A-fib', why: 'Cardiac monitoring required', from: 'Maple Gardens Rehab & SNF', to: 'Mercy General Hospital',
    mode: 'SCHEDULED', at: '16:30', crew: 'crew-m21', status: 'ASSIGNED', dur: 45 },
];

function atToday(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

export function seedState(): State {
  const now = new Date().toISOString();
  let n = 1;
  const calls: Call[] = sample.map((s) => {
    const pickupTime = s.at ? atToday(s.at) : null;
    const status = s.status ?? (s.crew ? 'ASSIGNED' : 'QUEUED');
    const statusTimes: Call['statusTimes'] = { QUEUED: now };
    if (s.crew) statusTimes.ASSIGNED = now;
    if (status === 'ENROUTE' || status === 'COMPLETED') statusTimes.ENROUTE = now;
    if (status === 'COMPLETED') Object.assign(statusTimes, { ON_SCENE: now, TRANSPORTING: now, AT_DESTINATION: now, COMPLETED: now });
    return {
      id: crypto.randomUUID(),
      callNumber: `SMPL-${String(n++).padStart(4, '0')}`,
      version: 1,
      status,
      statusTimes,
      level: s.level,
      tripType: s.trip,
      patient: { firstName: s.first, lastName: s.last, dob: s.dob, weightLbs: s.lbs },
      insurance: { payer: s.payer, memberId: s.member, priorAuth: '' },
      pcsOnFile: s.trip !== 'SNF_TO_ER',
      equipment: s.eq,
      chiefComplaint: s.cc,
      stretcherReason: s.why,
      pickupMode: s.mode,
      pickupTime,
      pickupLocation: s.from,
      destination: s.to,
      durationMin: s.dur ?? 60,
      notes: '',
      crewId: s.crew ?? null,
      scheduledStart: s.crew ? pickupTime : null,
      cancelReason: '',
      linkedCallId: null,
      leg: s.leg ?? 'ONE_WAY',
      seriesId: null,
      history: [{ ts: now, actor: 'system', action: 'Created (sample data)' }],
      createdAt: now,
      createdBy: 'system',
      updatedAt: now,
      updatedBy: 'system',
    };
  });
  // Link the sample round trips (outbound immediately followed by its return).
  for (let i = 0; i < calls.length - 1; i++) {
    if (calls[i].leg === 'OUTBOUND' && calls[i + 1].leg === 'RETURN') {
      calls[i].linkedCallId = calls[i + 1].id;
      calls[i + 1].linkedCallId = calls[i].id;
    }
  }
  return {
    crews: crews.map((c) => ({ ...c, outOfService: false, oosReason: '', version: 1 })),
    calls,
    facilities,
    users: users.map((u) => ({ ...u, passwordHash: hashPassword(DEMO_PASSWORD), disabled: false })),
    nextCallNumber: 1,
  };
}
