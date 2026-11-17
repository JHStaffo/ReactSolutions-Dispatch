"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bad = bad;
exports.actor = actor;
exports.who = who;
exports.csvEscape = csvEscape;
exports.toCsv = toCsv;
function bad(res, err) {
    return res.status(400).json({
        error: 'VALIDATION',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
}
function actor(req) {
    return req.user.displayName;
}
function who(req) {
    return { user: req.user.username, role: req.user.role, ip: req.ip };
}
function csvEscape(v) {
    const s = v === null || v === undefined ? '' : String(v);
    // Prevent spreadsheet formula injection, then quote.
    const safe = typeof v === 'string' && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
function toCsv(headers, rows) {
    return [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}
