/**
 * perm.ts
 * Permission helpers — direct port of Perm.html.
 * Roles: 1=viewer  2=user  3=manager  4=admin
 */

import { getSession, roleLevel } from './session';

const PERM_MIN: Record<string, number> = {
  // Vouchers
  'voucher.view':     1,
  'voucher.create':   2,
  'voucher.approve':  3,
  'voucher.post':     3,
  'voucher.delete':   4,
  // Masters
  'master.view':      1,
  'master.edit':      3,
  // Reports
  'report.view':      1,
  // Admin
  'admin.users':      4,
  'admin.config':     4,
};

export function hasRank(minRole: number): boolean {
  const s = getSession();
  return !!s && roleLevel(s) >= minRole;
}

export function can(perm: string): boolean {
  const min = PERM_MIN[perm];
  if (min === undefined) return false;
  return hasRank(min);
}

/**
 * applyPerms — hide/disable elements with data-perm attributes.
 * Usage: <button data-perm="voucher.approve">Approve</button>
 */
export function applyPerms(root: Element = document.body): void {
  root.querySelectorAll<HTMLElement>('[data-perm]').forEach(el => {
    const perm = el.dataset['perm']!;
    if (!can(perm)) {
      el.hidden = true;
    }
  });

  root.querySelectorAll<HTMLElement>('[data-min-role]').forEach(el => {
    const min = parseInt(el.dataset['minRole'] ?? '0', 10);
    if (!hasRank(min)) {
      el.hidden = true;
    }
  });
}
