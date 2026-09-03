/** audit.ts — mirrors Auditservice.js */

import { rpc } from '../lib/rpc';
import { ctx } from '../lib/session';

export const auditLog = (p: {
  table_name?: string;
  action?:     string;
  from_date?:  string;
  to_date?:    string;
  user_name?:  string;
  limit?:      number;
}) =>
  rpc('audit_log', {
    ...ctx(),
    p_table_name: p.table_name ?? null,
    p_action:     p.action     ?? null,
    p_from_date:  p.from_date  ?? null,
    p_to_date:    p.to_date    ?? null,
    p_user_name:  p.user_name  ?? null,
    p_limit:      p.limit      ?? 200
  });
