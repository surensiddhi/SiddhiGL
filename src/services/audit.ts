/** audit.ts — mirrors Auditservice.js */

import { rpc } from '../lib/rpc';
import { ctx } from '../lib/session';

export interface AuditLogRow {
  id:         number;
  changed_at: string;
  changed_by: string;
  table_name: string;
  action:     string;
  row_key:    string;
  tenant_id:  string;
  changes:    Record<string, unknown> | null;
}

export const auditLog = (p: {
  from?:   string;
  to?:     string;
  user?:   string;
  table?:  string;
  action?: string;
  limit?:  number;
}) =>
  rpc<AuditLogRow[]>('get_audit_log', {
    ...ctx(),
    p_from:   p.from   ?? null,
    p_to:     p.to     ?? null,
    p_user:   p.user   ?? null,
    p_table:  p.table  ?? null,
    p_action: p.action ?? null,
    p_limit:  p.limit  ?? 500,
  });
