"use strict";
// Domain types shared by the server and the browser client.
// All patient values in this prototype are SAMPLE data, but they are handled as PHI.
Object.defineProperty(exports, "__esModule", { value: true });
exports.FACILITY_KINDS = exports.ACTIVE_STATUSES = exports.STATUS_FLOW = exports.STATUSES = exports.DEFAULT_DURATION_MIN = exports.BARIATRIC_LBS = exports.ALS_EQUIPMENT = exports.EQUIPMENT = exports.TRIP_TYPES = void 0;
exports.paperworkAlerts = paperworkAlerts;
exports.ageFromDob = ageFromDob;
exports.haversineMiles = haversineMiles;
exports.TRIP_TYPES = {
    DIALYSIS: 'Dialysis',
    APPOINTMENT: "Doctor's appointment",
    INTERFACILITY: 'Interfacility transfer',
    DISCHARGE: 'Hospital discharge',
    SNF_TO_ER: 'SNF to ER',
    OTHER: 'Other',
};
exports.EQUIPMENT = {
    OXYGEN: 'Oxygen',
    CARDIAC_MONITOR: 'Cardiac monitor',
    IV_PUMP: 'IV pump',
    VENTILATOR: 'Ventilator',
    SUCTION: 'Suction',
    BARIATRIC_STRETCHER: 'Bariatric stretcher',
    STAIR_CHAIR: 'Stair chair',
    RESTRAINTS: 'Soft restraints',
    ISOLATION: 'Isolation precautions',
};
/** Equipment that normally requires an ALS crew. */
exports.ALS_EQUIPMENT = ['CARDIAC_MONITOR', 'IV_PUMP', 'VENTILATOR'];
exports.BARIATRIC_LBS = 350;
exports.DEFAULT_DURATION_MIN = {
    DIALYSIS: 60,
    APPOINTMENT: 60,
    INTERFACILITY: 90,
    DISCHARGE: 60,
    SNF_TO_ER: 45,
    OTHER: 60,
};
exports.STATUSES = {
    QUEUED: 'Queued',
    ASSIGNED: 'Assigned',
    ENROUTE: 'En route',
    ON_SCENE: 'On scene',
    TRANSPORTING: 'Transporting',
    AT_DESTINATION: 'At destination',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
};
/** Normal forward progression once a crew is assigned. */
exports.STATUS_FLOW = ['ASSIGNED', 'ENROUTE', 'ON_SCENE', 'TRANSPORTING', 'AT_DESTINATION', 'COMPLETED'];
exports.ACTIVE_STATUSES = ['ENROUTE', 'ON_SCENE', 'TRANSPORTING', 'AT_DESTINATION'];
/** Paperwork problems for a trip date: missing/expired PCS, expired prior auth. */
function paperworkAlerts(p, tripDate, tripType) {
    if (!p)
        return [];
    const out = [];
    const day = (s) => new Date(s + 'T23:59:59');
    const soon = (d) => d.getTime() - tripDate.getTime() < 7 * 86400000;
    if (tripType !== 'SNF_TO_ER') {
        if (!p.pcsExpires)
            out.push('No PCS');
        else if (day(p.pcsExpires) < tripDate)
            out.push('PCS expired');
        else if (soon(day(p.pcsExpires)))
            out.push('PCS expiring');
    }
    if (p.priorAuth?.number && p.priorAuth.expires) {
        if (day(p.priorAuth.expires) < tripDate)
            out.push('Auth expired');
        else if (soon(day(p.priorAuth.expires)))
            out.push('Auth expiring');
    }
    return out;
}
exports.FACILITY_KINDS = ['Hospital', 'Dialysis', 'SNF', 'Clinic', 'Residence', 'Other'];
function ageFromDob(dob, now = new Date()) {
    const d = new Date(dob + 'T00:00:00');
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate()))
        age--;
    return age;
}
function haversineMiles(a, b) {
    const R = 3958.8;
    const toR = (d) => (d * Math.PI) / 180;
    const dLat = toR(b.lat - a.lat);
    const dLon = toR(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}
