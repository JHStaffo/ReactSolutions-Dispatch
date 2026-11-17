import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';

/**
 * Append-only audit trail (HIPAA 164.312(b)). Records WHO did WHAT to WHICH record WHEN.
 * It stores record ids and action names only, never patient values.
 */
export interface AuditEntry {
  ts: string;
  user: string;
  role: string;
  action: string;
  entityType?: string;
  entityId?: string;
  callNumber?: string;
  outcome: 'success' | 'failure' | 'denied' | 'conflict';
  ip?: string;
  detail?: string; // non-PHI only, e.g. "crew=Medic 12" or "fields=pickupTime,notes"
}

const file = () => path.join(config.dataDir, 'audit.log');

export function audit(e: Omit<AuditEntry, 'ts'>) {
  const entry: AuditEntry = { ts: new Date().toISOString(), ...e };
  fs.appendFileSync(file(), JSON.stringify(entry) + '\n', { mode: 0o600 });
}

export function readAudit(limit = 300): AuditEntry[] {
  if (!fs.existsSync(file())) return [];
  const lines = fs.readFileSync(file(), 'utf8').trim().split('\n').filter(Boolean);
  return lines
    .slice(-limit)
    .reverse()
    .map((l) => JSON.parse(l) as AuditEntry);
}
