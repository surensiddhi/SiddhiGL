/**
 * sidebar.ts — App navigation sidebar.
 * Menu structure mirrors the `menus` table (node_type B=group, F=leaf).
 * form_name mapped to SPA hash keys.
 * Collapsible groups, username at bottom.
 */

import { getSession, logout, roleLevel } from '../lib/session';

// Hardcoded from menus table (avoids extra RPC on every load)
const GROUPS = [
  {
    code: '1', label: 'Masters', minRole: 1,
    items: [
      { label: 'Account Type',    key: 'account-type',   minRole: 1 },
      { label: 'Account Opening', key: 'account-master', minRole: 1 },
      { label: 'Cost Centre',     key: 'cost-centre',    minRole: 1 },
      { label: 'Parties',         key: 'party-master',   minRole: 1 },
    ],
  },
  {
    code: '2', label: 'Transactions', minRole: 1,
    items: [
      { label: 'Transaction List', key: 'voucher-list', minRole: 1 },
      { label: 'Voucher Entry',    key: 'voucher-form', minRole: 2 },
      { label: 'Posted Vouchers',  key: 'posted-list',  minRole: 1 },
    ],
  },
  {
    code: '3', label: 'Reports', minRole: 1,
    items: [
      { label: 'Trial Balance',  key: 'trial-balance', minRole: 1 },
      { label: 'General Ledger', key: 'ledger',        minRole: 1 },
      { label: 'Day Book',       key: 'day-book',      minRole: 1 },
      { label: 'Balance Sheet',  key: 'balance-sheet', minRole: 1 },
      { label: 'Profit & Loss',  key: 'profit-loss',   minRole: 1 },
      { label: 'Aging Report',   key: 'aging',         minRole: 1 },
    ],
  },
  {
    code: '4', label: 'Administration', minRole: 4,
    items: [
      { label: 'Users & Roles', key: 'users',        minRole: 4 },
      { label: 'Settings',      key: 'company-config', minRole: 4 },
      { label: 'Audit Log',     key: 'audit-log',    minRole: 4 },
    ],
  },
];

let _initialized = false;

export function initSidebar(el: HTMLElement): void {
  const s = getSession();
  if (!s) return;
  const role = roleLevel(s);

  const groupsHtml = GROUPS
    .filter(g => role >= g.minRole)
    .map(g => {
      const linksHtml = g.items
        .filter(i => role >= i.minRole)
        .map(i => `
          <a class="sidebar-link" href="#${i.key}" data-key="${i.key}">${i.label}</a>
        `).join('');
      return `
        <div class="sidebar-group">
          <div class="sidebar-group-toggle" data-group="${g.code}">
            <span>${g.label}</span>
            <span class="sidebar-chevron">▾</span>
          </div>
          <div class="sidebar-group-items">${linksHtml}</div>
        </div>
      `;
    }).join('');

  el.innerHTML = `
    <div class="sidebar-header">
      <div class="sidebar-app-name">SiddhiGL <span class="sidebar-version">v 1.0</span></div>
      <div class="sidebar-company">${s.tenant_name ?? s.tenant_id}</div>
    </div>
    <nav class="sidebar-nav">${groupsHtml}</nav>
    <div class="sidebar-footer">
      <div class="sidebar-username">&#128100; ${s.full_name ?? s.username}</div>
      <a class="sidebar-footer-link" href="#change-password">&#128274; Change Password</a>
      <button class="sidebar-logout" data-action="logout">&#x2192; Sign out</button>
    </div>
  `;

  markActive(el);

  // Collapsible groups
  el.querySelectorAll<HTMLElement>('.sidebar-group-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const items   = toggle.nextElementSibling as HTMLElement;
      const chevron = toggle.querySelector<HTMLElement>('.sidebar-chevron')!;
      const open    = items.style.display !== 'none';
      items.style.display  = open ? 'none' : '';
      chevron.textContent  = open ? '▸' : '▾';
    });
  });

  // Logout
  el.querySelector('[data-action="logout"]')?.addEventListener('click', () => logout());

  if (!_initialized) {
    _initialized = true;
    window.addEventListener('hashchange', () => markActive(el));
  }
}

function markActive(el: HTMLElement): void {
  const current = window.location.hash.slice(1).split('?')[0] || 'voucher-list';
  el.querySelectorAll<HTMLAnchorElement>('.sidebar-link').forEach(a => {
    a.classList.toggle('active', a.dataset['key'] === current);
  });
}
