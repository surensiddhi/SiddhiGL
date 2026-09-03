/**
 * main.ts — App entry point.
 * Hash-based SPA router. Mirrors the GAS showView() / VIEW_INIT map in Index.html.
 */

import './style.css';
import { getSession, logout } from './lib/session';
import { clearLookupCache } from './services/lookup';
import { initSidebar } from './components/sidebar';

// ── View registry ─────────────────────────────────────────────────────────────
const VIEW_INIT: Record<string, () => Promise<{ init: (el: HTMLElement) => void }>> = {
  'login':            () => import('./views/login'),
  'change-password':  () => import('./views/login').then(m => ({ init: m.initChangePassword })),
  'dashboard':        () => import('./views/dashboard'),
  'voucher-list':     () => import('./views/voucher-list'),
  'voucher-form':     () => import('./views/voucher-form'),
  'posted-list':      () => import('./views/posted-list'),
  'account-master':   () => import('./views/account-master'),
  'account-type':     () => import('./views/account-type'),
  'party-master':     () => import('./views/party-master'),
  'cost-centre':      () => import('./views/cost-centre'),
  'users':            () => import('./views/users'),
  'company-config':   () => import('./views/company-config'),
  'audit-log':        () => import('./views/audit-log'),
  'trial-balance':    () => import('./views/reports/trial-balance'),
  'ledger':           () => import('./views/reports/ledger'),
  'day-book':         () => import('./views/reports/day-book'),
  'profit-loss':      () => import('./views/reports/profit-loss'),
  'balance-sheet':    () => import('./views/reports/balance-sheet'),
  'aging':            () => import('./views/reports/aging'),
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const appShell  = document.getElementById('app-shell')!;
const viewLogin = document.getElementById('view-login')!;
const contentEl = document.getElementById('content')!;
const sidebarEl = document.getElementById('sidebar')!;

let _sidebarReady = false;

// ── Router ────────────────────────────────────────────────────────────────────
async function navigate(): Promise<void> {
  const hash    = window.location.hash.slice(1) || 'dashboard';
  const session = getSession();

  // Auth guard
  if (!session) {
    showLogin();
    return;
  }

  // Force password change
  if (session.must_change_password && hash !== 'change-password') {
    window.location.hash = '#change-password';
    return;
  }

  // Show app shell, hide login
  viewLogin.hidden = true;
  appShell.hidden  = false;

  // Sidebar: init once per login
  if (!_sidebarReady) {
    _sidebarReady = true;
    initSidebar(sidebarEl);
  }

  // Load the view
  const viewKey = hash.split('?')[0] ?? 'dashboard';
  const loader  = VIEW_INIT[viewKey];
  if (!loader) {
    contentEl.innerHTML = `<p style="padding:2rem">View not found: <code>${viewKey}</code></p>`;
    return;
  }

  contentEl.innerHTML = '';
  try {
    const mod = await loader();
    mod.init(contentEl);
  } catch (err) {
    console.error('View load error:', err);
    contentEl.innerHTML = `<p style="padding:2rem;color:red">Failed to load view: ${viewKey}</p>`;
  }
}

function showLogin(): void {
  appShell.hidden  = true;
  viewLogin.hidden = false;
  _sidebarReady    = false;
  import('./views/login').then(m => m.init(viewLogin));
}

// ── Global click handler (logout + sidebar actions) ───────────────────────────
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('[data-action="logout"]')) {
    clearLookupCache();
    logout();
  }
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────
window.addEventListener('hashchange', navigate);
navigate();
