/**
 * sidebar.ts — App navigation sidebar.
 * Menu structure now comes live from the `menus` table (node_type B=group,
 * F=leaf) via services/menu.ts → menu_list() RPC, which already filters by
 * role and by the tenant's active modules. Nothing here decides visibility
 * any more — this file only builds the tree and renders it.
 *
 * form_name (DB) → SPA hash route key: see FORM_ROUTE below. That mapping
 * is a frontend concern (route keys are an implementation detail of this
 * SPA), so it stays here rather than in the DB.
 *
 * Fetched once per login (main.ts only calls initSidebar once per session),
 * so this costs exactly one extra RPC at login — same cost profile as the
 * old hardcoded-array approach aimed for.
 */

import { getSession, logout } from '../lib/session';
import { menuList, type MenuRow } from '../services/menu';

// DB form_name → SPA hash route key (keys in main.ts's VIEW_INIT)
const FORM_ROUTE: Record<string, string> = {
  vAccountTypes: 'account-type',
  vAccounts:     'account-master',
  vCostCentre:   'cost-centre',
  vParties:      'party-master',
  vList:         'voucher-list',
  vForm:         'voucher-form',
  vPosted:       'posted-list',
  vPVForm:       'payment-voucher',
  vRVForm:       'receipt-voucher',
  vUsers:        'users',
  frmConfig:     'company-config',
  rptAudit:      'audit-log',
  rptTrialBal:   'trial-balance',
  rptLedger:     'ledger',
  rptDayBook:    'day-book',
  rptPL:         'profit-loss',
  rptBalSheet:   'balance-sheet',
  rptAging:      'aging',
  vItems:        'item-master',
  vSaleForm:     'sale-bill-form',
  vSaleList:     'sale-bill-list',
  vPurForm:      'purchase-bill-form',
  vPurList:      'purchase-bill-list',
  vItemGroup:    'item-group',
  vStockAdj:     'stock-adjustment',
  rptStockBal:   'stock-balance',
  rptExpiry:     'expiry-report',
};

interface TreeGroup {
  code:  string;
  label: string;
  items: { label: string; key: string }[];
}

function buildTree(rows: MenuRow[]): TreeGroup[] {
  const byCode = new Map<string, MenuRow>();
  rows.forEach(r => byCode.set(r.code, r));

  const groups: TreeGroup[] = rows
    .filter(r => r.node_type === 'B' && !r.parent_code)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(g => {
      const items = rows
        .filter(r => r.node_type === 'F' && r.parent_code === g.code)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(r => {
          const key = r.form_name ? FORM_ROUTE[r.form_name] : undefined;
          if (!key) {
            console.warn(`sidebar: no route mapped for form_name "${r.form_name}" (menu code ${r.code})`);
            return null;
          }
          return { label: r.menu_item, key };
        })
        .filter((i): i is { label: string; key: string } => i !== null);

      return { code: g.code, label: g.menu_item, items };
    })
    .filter(g => g.items.length > 0); // hide empty groups (e.g. every child role/module-filtered out)

  return groups;
}

let _initialized = false;

export async function initSidebar(el: HTMLElement): Promise<void> {
  const s = getSession();
  if (!s) return;

  let groups: TreeGroup[] = [];
  try {
    const rows = await menuList();
    groups = buildTree(rows);
  } catch (err) {
    console.error('Failed to load menu:', err);
  }

  const groupsHtml = groups
    .map(g => {
      const linksHtml = g.items
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
      <div class="sidebar-app-name" data-action="about" title="About SiddhiGL" role="button" tabindex="0">Siddhi<span class="brand-accent">GL</span> <span class="sidebar-version">${APP_VERSION}</span></div>
      <div class="sidebar-company">${s.tenant_name ?? s.tenant_id}</div>
    </div>
    <nav class="sidebar-nav">${groupsHtml}</nav>
    <div class="sidebar-footer">
      <div class="sidebar-username">&#128100; ${s.full_name ?? s.username}</div>
      <a class="sidebar-footer-link" href="#change-password">&#128274; Change Password</a>
      <a class="sidebar-footer-link" href="#" data-action="about">&#8505;&#65039; About</a>
      <button class="sidebar-logout" data-action="logout">&#x2192; Sign out</button>
    </div>
  `;

  markActive(el);

  // About popup
  el.querySelectorAll<HTMLElement>('[data-action="about"]').forEach(trigger => {
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      openAboutModal();
    });
    trigger.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
        e.preventDefault();
        openAboutModal();
      }
    });
  });

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

// ── About popup ──────────────────────────────────────────────────────────
const APP_VERSION = 'v 1.0.0';
const DEVELOPER_NAME = 'Nepal Data Systems Pvt. Ltd., Kathmandu';
const DEVELOPER_EMAIL = 'info@nds.com.np';
const DEVELOPER_WEBSITE = 'www.nds.com.np';

function openAboutModal(): void {
  if (document.querySelector('.about-overlay')) return; // already open

  const overlay = document.createElement('div');
  overlay.className = 'about-overlay';
  overlay.innerHTML = `
    <div class="about-modal" role="dialog" aria-modal="true" aria-label="About SiddhiGL">
      <button class="about-close" data-action="about-close" aria-label="Close">&times;</button>
      <div class="about-title">Siddhi<span class="brand-accent">GL</span></div>
      <div class="about-tagline">Simple Accounting System for SMEs</div>
      <div class="about-row"><span>Version</span><span>${APP_VERSION}</span></div>
      <div class="about-row"><span>Developed by</span><span>${DEVELOPER_NAME}</span></div>
      <div class="about-row"><span>Email</span><span>${DEVELOPER_EMAIL}</span></div>
      <div class="about-row"><span>Website</span><span>${DEVELOPER_WEBSITE}</span></div>
      <div class="about-copyright">&copy; ${new Date().getFullYear()} ${DEVELOPER_NAME}. All rights reserved.</div>
      <div class="about-disclaimer">
        <strong>Disclaimer:</strong> This software is provided "as is", without warranty of any kind,
        express or implied, including but not limited to fitness for a particular purpose and
        non-infringement. ${DEVELOPER_NAME} shall not be liable for any direct, indirect, incidental,
        or consequential loss or damage arising from the use of this software. Users remain
        responsible for the accuracy of the data they enter and for complying with applicable
        tax, VAT and statutory reporting requirements in their jurisdiction.
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-action="about-close"]')?.addEventListener('click', close);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);
}
