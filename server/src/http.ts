import type { Request, Response } from 'express';
import type { z } from 'zod';

export function bad(res: Response, err: z.ZodError) {
  return res.status(400).json({
    error: 'VALIDATION',
    issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  });
}

export function actor(req: Request) {
  return req.user!.displayName;
}

export function who(req: Request) {
  return { user: req.user!.username, role: req.user!.role, ip: req.ip };
}

export function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  // Prevent spreadsheet formula injection, then quote.
  const safe = typeof v === 'string' && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}
