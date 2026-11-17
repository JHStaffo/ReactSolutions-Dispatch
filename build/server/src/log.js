"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.log = log;
exports.redactPath = redactPath;
function log(level, msg, meta) {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta });
    if (level === 'error')
        console.error(line);
    else
        console.log(line);
}
/** Replace ids in a path so URLs can be logged without identifiers. */
function redactPath(p) {
    return p
        .split('?')[0]
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
        .replace(/\/\d+(?=\/|$)/g, '/:n');
}
