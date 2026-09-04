/**
 * ledger.ts — General Ledger report.
 * DB: get_ledger(p_tenant, p_caller, p_mode, p_from, p_to,
 *               p_account_no?, p_party_type?, p_party_code?, p_status?)
 *   → TABLE(line_kind, voucher_date, voucher_date_nep, voucher_no, tran_type,
 *            particulars, debit, credit, running_balance)
 *   line_kind values: 'opening' | 'txn'  (no closing row — computed client-side)
 *
 * Lookups:
 *   lk_accounts(p_tenant, p_caller, p_term?)                             → [{value, label}]
 *   lk_party_types(p_tenant, p_caller, p_term?)                          → [{value, label}]
 *   list_parties(p_tenant, p_caller, p_party_type?, p_status?, p_term?)  → [{party_code, party_name, …}]
 */

import { ledger } from '../../services/report';
import { rpc } from '../../lib/rpc';
import { ctx } from '../../lib/session';
import { isoToBs, bsToIso } from '../../lib/bs-calendar';

// ── Types ──────────────────────────────────────────────────────────────────────

interface LedgerRow {
  line_kind:        string;        // 'opening' | 'txn'
  voucher_date:     string | null;
  voucher_date_nep: string | null;
  voucher_no:       string | null;
  tran_type:        string | null;
  particulars:      string | null;
  debit:            number | null;
  credit:           number | null;
  running_balance:  number;
}

/** Synthetic closing row appended client-side */
interface ClosingRow {
  line_kind: 'closing';
  total_dr:  number;
  total_cr:  number;
  balance:   number;
}

interface LkRow    { value: string; label: string; }
interface PartyRow { party_code: string; party_name: string; [k: string]: unknown; }

// ── Helpers ────────────────────────────────────────────────────────────────────

function isoToNep(iso: string): string {
  const bs = isoToBs(iso);
  return bs ? bs.replace(/\//g, '-') : '';
}

function toISO(bs: string): string {
  return bsToIso(bs.replace(/-/g, '/')) ?? '';
}

function todayIso(): string { return new Date().toISOString().slice(0, 10); }

function fyStartIso(): string {
  const bsToday = isoToBs(todayIso()) ?? '';
  if (!bsToday) return todayIso();
  const [y, m] = bsToday.split('/').map(Number);
  const fyYear = (m >= 4) ? y : y - 1;
  return bsToIso(`${fyYear}/04/01`) ?? todayIso();
}

function rowDates(r: LedgerRow): { ad: string; bs: string } {
  const ad = r.voucher_date ? String(r.voucher_date).slice(0, 10) : '';
  const bs = r.voucher_date_nep
    ? String(r.voucher_date_nep).replace(/\//g, '-')
    : (ad ? isoToNep(ad) : '');
  return { ad, bs };
}

function fmtAmt(n: number | null | undefined): string {
  if (n == null || n === 0) return '';
  return Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtBal(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function esc(s: string | null | undefined): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Dropdown styles ────────────────────────────────────────────────────────────

const DROP_STYLE = `
  position:absolute;top:calc(100% + 2px);left:0;min-width:100%;max-width:420px;
  background:var(--surface);border:1px solid var(--border);border-radius:6px;
  z-index:200;max-height:220px;overflow-y:auto;
  box-shadow:0 4px 16px rgba(0,0,0,.18);font-size:.875rem`;

const DROP_ITEM = `
  padding:7px 12px;cursor:pointer;color:var(--text);
  border-bottom:1px solid var(--border)`;

// ── init ───────────────────────────────────────────────────────────────────────

export function init(el: HTMLElement): void {
  let allRows:    LedgerRow[] = [];
  let filterTerm = '';
  let loading    = false;
  let currentMode: 'account' | 'party' = 'account';

  const defaultFrom = fyStartIso();
  const defaultTo   = todayIso();

  // ── Shell ────────────────────────────────────────────────────────────────────

  el.innerHTML = `
    <div class="page-header">
      <span class="page-title">General Ledger</span>
    </div>

    <div class="card" style="padding:16px 20px 12px">

      <!-- Mode + subject row -->
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:10px;
                  flex-wrap:wrap;font-size:.875rem">

        <div style="display:flex;align-items:center;gap:8px">
          <label style="font-weight:700;color:var(--text);white-space:nowrap">Ledger of</label>
          <select id="gl-mode" class="at-select" style="width:140px">
            <option value="account">Account</option>
            <option value="party">Party</option>
          </select>
        </div>

        <!-- Account mode -->
        <div id="gl-acc-row" style="display:flex;align-items:center;gap:8px">
          <label style="font-weight:700;color:var(--text);white-space:nowrap">Account</label>
          <div style="position:relative;width:280px">
            <input id="gl-acc-no" type="text" placeholder="Type to search accounts…"
              style="width:100%;box-sizing:border-box;border:1px solid var(--border);
                     border-radius:5px;padding:5px 36px 5px 10px;font-size:.875rem;
                     background:var(--surface);color:var(--text)" />
            <button id="gl-acc-btn" title="Search accounts"
              style="position:absolute;right:4px;top:50%;transform:translateY(-50%);
                     background:none;border:none;cursor:pointer;font-size:1rem;
                     color:var(--muted);padding:0 4px;line-height:1">&#128269;</button>
            <div id="gl-acc-drop" hidden style="${DROP_STYLE}"></div>
          </div>
          <span id="gl-acc-name" style="color:var(--muted);font-size:.82rem;font-style:italic"></span>
        </div>

        <!-- Party mode -->
        <div id="gl-pty-row" style="display:none;align-items:center;gap:8px;flex-wrap:wrap">
          <label style="font-weight:700;color:var(--text);white-space:nowrap">Party Type</label>
          <select id="gl-pty-type" class="at-select" style="width:140px">
            <option value="">All types</option>
          </select>
          <label style="font-weight:700;color:var(--text);white-space:nowrap">Party</label>
          <div style="position:relative;width:260px">
            <input id="gl-pty-code" type="text" placeholder="Type to search parties…"
              style="width:100%;box-sizing:border-box;border:1px solid var(--border);
                     border-radius:5px;padding:5px 36px 5px 10px;font-size:.875rem;
                     background:var(--surface);color:var(--text)" />
            <button id="gl-pty-btn" title="Search parties"
              style="position:absolute;right:4px;top:50%;transform:translateY(-50%);
                     background:none;border:none;cursor:pointer;font-size:1rem;
                     color:var(--muted);padding:0 4px;line-height:1">&#128269;</button>
            <div id="gl-pty-drop" hidden style="${DROP_STYLE}"></div>
          </div>
          <span id="gl-pty-name" style="color:var(--muted);font-size:.82rem;font-style:italic"></span>
        </div>

      </div>

      <!-- Date grid -->
      <div style="display:grid;grid-template-columns:auto 1fr auto 1fr;gap:8px 12px;
                  align-items:center;margin-bottom:12px;font-size:.875rem">

        <label style="font-weight:700;color:var(--text);white-space:nowrap">From (Nep)</label>
        <input id="gl-from-bs" type="text" placeholder="YYYY-MM-DD"
          style="border:1px solid var(--border);border-radius:5px;padding:5px 10px;
                 font-size:.875rem;background:var(--surface);color:var(--text);
                 width:100%;box-sizing:border-box" />

        <label style="font-weight:700;color:var(--text);white-space:nowrap">To (Nep)</label>
        <input id="gl-to-bs" type="text" placeholder="YYYY-MM-DD"
          style="border:1px solid var(--border);border-radius:5px;padding:5px 10px;
                 font-size:.875rem;background:var(--surface);color:var(--text);
                 width:100%;box-sizing:border-box" />

        <label style="font-weight:700;color:var(--text);white-space:nowrap">From (Eng)</label>
        <input id="gl-from-ad" type="date"
          style="border:1px solid var(--border);border-radius:5px;padding:5px 10px;
                 font-size:.875rem;background:var(--surface);color:var(--text);
                 width:100%;box-sizing:border-box" />

        <label style="font-weight:700;color:var(--text);white-space:nowrap">To (Eng)</label>
        <input id="gl-to-ad" type="date"
          style="border:1px solid var(--border);border-radius:5px;padding:5px 10px;
                 font-size:.875rem;background:var(--surface);color:var(--text);
                 width:100%;box-sizing:border-box" />

      </div>

      <!-- Toolbar -->
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button id="gl-fetch" class="btn btn-primary" style="min-width:80px">Fetch</button>
        <select id="gl-status" class="at-select" style="width:150px">
          <option value="posted" selected>Posted</option>
          <option value="pending">Pending/Approved</option>
          <option value="all">All</option>
        </select>
        <input id="gl-search" type="text" placeholder="Find in particulars / voucher…"
          style="flex:1;min-width:180px;max-width:300px;border:1px solid var(--border);
                 border-radius:5px;padding:5px 10px;font-size:.875rem;
                 background:var(--surface);color:var(--text)" />
        <button id="gl-csv"   class="btn btn-secondary">CSV</button>
        <button id="gl-print" class="btn btn-secondary">Print / PDF</button>
        <span   id="gl-range" style="margin-left:auto;color:var(--muted);font-size:.78rem"></span>
      </div>

    </div>

    <!-- Results -->
    <div class="card" style="padding:0;margin-top:12px">
      <div id="gl-body" style="overflow-x:auto">
        <div class="loading-msg" style="color:var(--muted)">
          Select an account and date range, then press Fetch.
        </div>
      </div>
    </div>
  `;

  // ── Refs ─────────────────────────────────────────────────────────────────────

  const modeSelect    = el.querySelector<HTMLSelectElement>('#gl-mode')!;
  const accRow        = el.querySelector<HTMLElement>('#gl-acc-row')!;
  const accNoInp      = el.querySelector<HTMLInputElement>('#gl-acc-no')!;
  const accBtn        = el.querySelector<HTMLButtonElement>('#gl-acc-btn')!;
  const accDrop       = el.querySelector<HTMLElement>('#gl-acc-drop')!;
  const accName       = el.querySelector<HTMLElement>('#gl-acc-name')!;

  const ptyRow        = el.querySelector<HTMLElement>('#gl-pty-row')!;
  const ptyTypeSelect = el.querySelector<HTMLSelectElement>('#gl-pty-type')!;
  const ptyCodeInp    = el.querySelector<HTMLInputElement>('#gl-pty-code')!;
  const ptyBtn        = el.querySelector<HTMLButtonElement>('#gl-pty-btn')!;
  const ptyDrop       = el.querySelector<HTMLElement>('#gl-pty-drop')!;
  const ptyName       = el.querySelector<HTMLElement>('#gl-pty-name')!;

  const fromBS     = el.querySelector<HTMLInputElement>('#gl-from-bs')!;
  const toBS       = el.querySelector<HTMLInputElement>('#gl-to-bs')!;
  const fromAD     = el.querySelector<HTMLInputElement>('#gl-from-ad')!;
  const toAD       = el.querySelector<HTMLInputElement>('#gl-to-ad')!;
  const statusSel  = el.querySelector<HTMLSelectElement>('#gl-status')!;
  const searchInp  = el.querySelector<HTMLInputElement>('#gl-search')!;
  const rangeLabel = el.querySelector<HTMLElement>('#gl-range')!;

  // ── Defaults ──────────────────────────────────────────────────────────────────

  fromAD.value = defaultFrom;
  toAD.value   = defaultTo;
  fromBS.value = isoToNep(defaultFrom);
  toBS.value   = isoToNep(defaultTo);

  // ── Party types (dynamic) ─────────────────────────────────────────────────────

  (async () => {
    try {
      const rows = await rpc<LkRow[]>('lk_party_types', { ...ctx(), p_term: null });
      if (rows?.length) {
        ptyTypeSelect.innerHTML =
          '<option value="">All types</option>' +
          rows.map(r => `<option value="${esc(r.value)}">${esc(r.label)}</option>`).join('');
      }
    } catch { /* keep default */ }
  })();

  // ── Mode toggle ───────────────────────────────────────────────────────────────

  function applyMode(mode: 'account' | 'party'): void {
    currentMode = mode;
    accRow.style.display = mode === 'account' ? 'flex' : 'none';
    ptyRow.style.display = mode === 'party'   ? 'flex' : 'none';
    accDrop.hidden = true;
    ptyDrop.hidden = true;
  }

  modeSelect.addEventListener('change', () =>
    applyMode(modeSelect.value as 'account' | 'party'));

  // ── Date sync ─────────────────────────────────────────────────────────────────

  fromBS.addEventListener('change', () => {
    const iso = toISO(fromBS.value);
    if (iso) fromAD.value = iso; else fromBS.value = isoToNep(fromAD.value);
  });
  toBS.addEventListener('change', () => {
    const iso = toISO(toBS.value);
    if (iso) toAD.value = iso; else toBS.value = isoToNep(toAD.value);
  });
  fromAD.addEventListener('change', () => { if (fromAD.value) fromBS.value = isoToNep(fromAD.value); });
  toAD.addEventListener('change',   () => { if (toAD.value)   toBS.value   = isoToNep(toAD.value);   });

  // ── Account lookup ────────────────────────────────────────────────────────────

  let accTimer: ReturnType<typeof setTimeout>;

  async function searchAccounts(term: string): Promise<void> {
    try {
      const rows = await rpc<LkRow[]>('lk_accounts', { ...ctx(), p_term: term || null });
      if (!rows?.length) { accDrop.hidden = true; return; }
      accDrop.innerHTML = rows.map(r =>
        `<div class="gl-di" data-v="${esc(r.value)}" data-l="${esc(r.label)}"
          style="${DROP_ITEM}"
          onmouseover="this.style.background='var(--hover,#f0f0f0)'"
          onmouseout="this.style.background=''">
          <span style="font-family:monospace;font-size:.82rem;color:var(--muted)">${esc(r.value)}</span>
          &nbsp;&nbsp;${esc(r.label)}
        </div>`
      ).join('');
      accDrop.hidden = false;
    } catch { accDrop.hidden = true; }
  }

  accNoInp.addEventListener('input', () => {
    clearTimeout(accTimer);
    accName.textContent = '';
    const term = accNoInp.value.trim();
    if (!term) { accDrop.hidden = true; return; }
    accTimer = setTimeout(() => searchAccounts(term), 300);
  });
  accBtn.addEventListener('click', () => { searchAccounts(accNoInp.value.trim()); accNoInp.focus(); });
  accDrop.addEventListener('mousedown', e => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.gl-di');
    if (!item) return;
    accNoInp.value      = item.dataset['v'] ?? '';
    accName.textContent = item.dataset['l'] ?? '';
    accDrop.hidden = true;
    e.preventDefault();
  });
  accNoInp.addEventListener('blur', () => setTimeout(() => { accDrop.hidden = true; }, 200));

  // ── Party lookup ──────────────────────────────────────────────────────────────

  let ptyTimer: ReturnType<typeof setTimeout>;

  async function searchParties(term: string): Promise<void> {
    try {
      const rows = await rpc<PartyRow[]>('list_parties', {
        ...ctx(),
        p_party_type: ptyTypeSelect.value || null,
        p_status:     'active',
        p_term:       term || null,
      });
      if (!rows?.length) { ptyDrop.hidden = true; return; }
      ptyDrop.innerHTML = rows.map(r =>
        `<div class="gl-pi" data-v="${esc(r.party_code)}" data-l="${esc(r.party_name)}"
          style="${DROP_ITEM}"
          onmouseover="this.style.background='var(--hover,#f0f0f0)'"
          onmouseout="this.style.background=''">
          <span style="font-family:monospace;font-size:.82rem;color:var(--muted)">${esc(r.party_code)}</span>
          &nbsp;&nbsp;${esc(r.party_name)}
        </div>`
      ).join('');
      ptyDrop.hidden = false;
    } catch { ptyDrop.hidden = true; }
  }

  ptyCodeInp.addEventListener('input', () => {
    clearTimeout(ptyTimer);
    ptyName.textContent = '';
    const term = ptyCodeInp.value.trim();
    if (!term) { ptyDrop.hidden = true; return; }
    ptyTimer = setTimeout(() => searchParties(term), 300);
  });
  ptyBtn.addEventListener('click', () => { searchParties(ptyCodeInp.value.trim()); ptyCodeInp.focus(); });
  ptyDrop.addEventListener('mousedown', e => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.gl-pi');
    if (!item) return;
    ptyCodeInp.value    = item.dataset['v'] ?? '';
    ptyName.textContent = item.dataset['l'] ?? '';
    ptyDrop.hidden = true;
    e.preventDefault();
  });
  ptyCodeInp.addEventListener('blur', () => setTimeout(() => { ptyDrop.hidden = true; }, 200));

  // Close dropdowns on outside click
  document.addEventListener('click', e => {
    if (!accRow.contains(e.target as Node)) accDrop.hidden = true;
    if (!ptyRow.contains(e.target as Node)) ptyDrop.hidden = true;
  });

  // ── Events ────────────────────────────────────────────────────────────────────

  el.querySelector('#gl-fetch')!.addEventListener('click', () => doFetch());
  searchInp.addEventListener('input', () => {
    filterTerm = searchInp.value.trim().toLowerCase();
    renderTable();
  });
  el.querySelector('#gl-csv')!.addEventListener('click', exportCsv);
  el.querySelector('#gl-print')!.addEventListener('click', printReport);

  // ── Fetch ─────────────────────────────────────────────────────────────────────

  async function doFetch(): Promise<void> {
    if (loading) return;
    const fromIso = fromAD.value;
    const toIso   = toAD.value;
    if (!fromIso || !toIso) { alert('Please set both From and To dates.'); return; }
    if (fromIso > toIso)    { alert('From date must be before To date.');  return; }

    if (currentMode === 'account' && !accNoInp.value.trim()) {
      alert('Please enter or select an account.'); return;
    }
    if (currentMode === 'party' && !ptyCodeInp.value.trim()) {
      alert('Please enter or select a party.'); return;
    }

    loading = true;
    el.querySelector('#gl-body')!.innerHTML = '<div class="loading-msg">Loading…</div>';

    try {
      const status = statusSel.value as 'posted' | 'pending' | 'all';
      const data   = await ledger({
        mode:       currentMode,
        from:       fromIso,
        to:         toIso,
        account_no: currentMode === 'account' ? accNoInp.value.trim()   : undefined,
        party_type: currentMode === 'party'   ? ptyTypeSelect.value      : undefined,
        party_code: currentMode === 'party'   ? ptyCodeInp.value.trim()  : undefined,
        status,
      }) as LedgerRow[];

      allRows = (data ?? []).map(r => ({
        ...r,
        debit:           r.debit           != null ? Number(r.debit)           : null,
        credit:          r.credit          != null ? Number(r.credit)          : null,
        running_balance: Number(r.running_balance ?? 0),
      }));

      const subject = currentMode === 'account'
        ? `${accNoInp.value.trim()}${accName.textContent ? ' - ' + accName.textContent : ''}`
        : `${ptyTypeSelect.options[ptyTypeSelect.selectedIndex].text} / ${ptyCodeInp.value.trim()}`;

      rangeLabel.textContent =
        `${subject} | ${isoToNep(fromIso)} – ${isoToNep(toIso)} | ` +
        statusSel.options[statusSel.selectedIndex].text;

      filterTerm = '';
      searchInp.value = '';
      renderTable();
    } catch (err: unknown) {
      el.querySelector('#gl-body')!.innerHTML =
        `<div class="error-msg">${err instanceof Error ? err.message : 'Failed to load'}</div>`;
    } finally {
      loading = false;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function txnRows(rows: LedgerRow[]): LedgerRow[] {
    return rows.filter(r => r.line_kind === 'txn');
  }

  function closing(rows: LedgerRow[]): ClosingRow {
    const txns = txnRows(rows);
    const totalDr = txns.reduce((s, r) => s + (r.debit  ?? 0), 0);
    const totalCr = txns.reduce((s, r) => s + (r.credit ?? 0), 0);
    const lastBal = allRows.length
      ? allRows[allRows.length - 1].running_balance
      : 0;
    return { line_kind: 'closing', total_dr: totalDr, total_cr: totalCr, balance: lastBal };
  }

  function filteredTxns(): LedgerRow[] {
    if (!filterTerm) return txnRows(allRows);
    return txnRows(allRows).filter(r => {
      const hay = `${r.voucher_no ?? ''} ${r.particulars ?? ''}`.toLowerCase();
      return hay.includes(filterTerm);
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  function renderTable(): void {
    const tbody = el.querySelector('#gl-body')!;
    if (!allRows.length) {
      tbody.innerHTML = `<div class="loading-msg">No ledger entries found.</div>`;
      return;
    }

    const opening   = allRows.find(r => r.line_kind === 'opening');
    const txns      = filteredTxns();
    const cl        = closing(filterTerm ? txns : allRows.filter(r => r.line_kind === 'txn'));
    // When filtering, recompute closing balance from last visible txn
    const filteredClosingBal = txns.length
      ? txns[txns.length - 1].running_balance
      : (opening ? opening.running_balance : 0);

    const openHtml = opening ? (() => {
      const balCol = opening.running_balance < 0 ? 'color:#b91c1c' : '';
      return `<tr style="color:var(--muted);font-style:italic">
        <td colspan="3" style="font-size:.82rem;padding:6px 8px">Opening balance</td>
        <td></td><td></td>
        <td style="text-align:right;font-family:monospace;font-size:.85rem;padding:6px 8px;${balCol}">
          ${fmtBal(opening.running_balance)}
        </td>
      </tr>`;
    })() : '';

    const txnHtml = txns.map(r => {
      const { ad, bs } = rowDates(r);
      const balCol = r.running_balance < 0 ? 'color:#b91c1c' : '';
      return `<tr>
        <td style="font-size:.82rem;vertical-align:top;white-space:nowrap;padding:5px 8px">
          ${bs
            ? `<div style="font-weight:500">${bs}</div>
               <div style="font-size:.7rem;color:var(--muted);margin-top:2px">${ad}</div>`
            : `<span style="color:var(--muted)">${ad || '—'}</span>`}
        </td>
        <td style="font-family:monospace;font-size:.82rem;padding:5px 8px">${esc(r.voucher_no)}</td>
        <td style="font-size:.875rem;padding:5px 8px">${esc(r.particulars)}</td>
        <td style="text-align:right;font-family:monospace;font-size:.85rem;padding:5px 8px">
          ${fmtAmt(r.debit)}
        </td>
        <td style="text-align:right;font-family:monospace;font-size:.85rem;padding:5px 8px">
          ${fmtAmt(r.credit)}
        </td>
        <td style="text-align:right;font-family:monospace;font-size:.85rem;padding:5px 8px;${balCol}">
          ${fmtBal(r.running_balance)}
        </td>
      </tr>`;
    }).join('');

    const closingBal = filterTerm ? filteredClosingBal : cl.balance;
    const closingBalCol = closingBal < 0 ? 'color:#b91c1c' : '';
    const closeHtml = `
      <tr style="border-top:2px solid var(--border);background:var(--bg);font-weight:700">
        <td colspan="3"
          style="text-align:right;font-size:.82rem;padding:6px 8px;color:var(--muted)">
          Period totals &amp; closing
        </td>
        <td style="text-align:right;font-family:monospace;font-size:.85rem;padding:6px 8px">
          ${fmtAmt(cl.total_dr)}
        </td>
        <td style="text-align:right;font-family:monospace;font-size:.85rem;padding:6px 8px">
          ${fmtAmt(cl.total_cr)}
        </td>
        <td style="text-align:right;font-family:monospace;font-size:.88rem;padding:6px 8px;${closingBalCol}">
          ${fmtBal(closingBal)}
        </td>
      </tr>`;

    tbody.innerHTML = `
      <table class="data-table" id="gl-table">
        <thead>
          <tr style="background:var(--bg)">
            <th style="width:120px">Date (Nep / Eng)</th>
            <th style="width:120px">Voucher</th>
            <th>Particulars</th>
            <th style="width:130px;text-align:right">Debit</th>
            <th style="width:130px;text-align:right">Credit</th>
            <th style="width:140px;text-align:right">Balance</th>
          </tr>
        </thead>
        <tbody>${openHtml}${txnHtml}${closeHtml}</tbody>
      </table>`;
  }

  // ── CSV ───────────────────────────────────────────────────────────────────────

  function exportCsv(): void {
    if (!allRows.length) { alert('No data to export.'); return; }
    const lines = ['Date (Nep),Date (Eng),Voucher,Particulars,Debit,Credit,Balance'];

    const opening = allRows.find(r => r.line_kind === 'opening');
    if (opening) {
      lines.push([
        'Opening', '', '', '"Opening balance"', '', '', opening.running_balance
      ].join(','));
    }

    filteredTxns().forEach(r => {
      const { ad, bs } = rowDates(r);
      lines.push([
        bs, ad, r.voucher_no ?? '',
        `"${(r.particulars ?? '').replace(/"/g, '""')}"`,
        r.debit ?? '', r.credit ?? '', r.running_balance,
      ].join(','));
    });

    const cl = closing(allRows.filter(r => r.line_kind === 'txn'));
    lines.push(['Closing', '', '', '"Period totals & closing"',
      cl.total_dr, cl.total_cr, cl.balance].join(','));

    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `general-ledger-${fromAD.value}-to-${toAD.value}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Print ─────────────────────────────────────────────────────────────────────

  function printReport(): void {
    if (!allRows.length) { alert('No data to print.'); return; }
    const opening = allRows.find(r => r.line_kind === 'opening');
    const txns    = filteredTxns();
    const cl      = closing(allRows.filter(r => r.line_kind === 'txn'));
    const closingBal = txns.length ? txns[txns.length - 1].running_balance : cl.balance;

    const openHtml = opening ? (() => {
      const s = opening.running_balance < 0 ? 'color:#b91c1c' : '';
      return `<tr style="color:#888;font-style:italic">
        <td colspan="3">Opening balance</td><td></td><td></td>
        <td class="num" style="${s}">${fmtBal(opening.running_balance)}</td>
      </tr>`;
    })() : '';

    const txnHtml = txns.map(r => {
      const { ad, bs } = rowDates(r);
      const s = r.running_balance < 0 ? 'color:#b91c1c' : '';
      return `<tr>
        <td style="white-space:nowrap">${bs}<br><span style="font-size:8pt;color:#888">${ad}</span></td>
        <td style="font-family:monospace;font-size:9pt">${esc(r.voucher_no)}</td>
        <td>${esc(r.particulars)}</td>
        <td class="num">${fmtAmt(r.debit)}</td>
        <td class="num">${fmtAmt(r.credit)}</td>
        <td class="num" style="${s}">${fmtBal(r.running_balance)}</td>
      </tr>`;
    }).join('');

    const clBalS = closingBal < 0 ? 'color:#b91c1c' : '';
    const closeHtml = `<tr style="font-weight:bold;border-top:2px solid #ccc;background:#f8f8f8">
      <td colspan="3" style="text-align:right">Period totals &amp; closing</td>
      <td class="num">${fmtAmt(cl.total_dr)}</td>
      <td class="num">${fmtAmt(cl.total_cr)}</td>
      <td class="num" style="${clBalS}">${fmtBal(closingBal)}</td>
    </tr>`;

    const html = `<!DOCTYPE html><html><head>
      <title>General Ledger</title>
      <style>
        body { font-family:Arial,sans-serif;font-size:10pt;margin:20px }
        h2 { margin-bottom:4px } p { margin:0 0 12px;color:#555;font-size:9pt }
        table { border-collapse:collapse;width:100% }
        th,td { border:1px solid #ccc;padding:3px 6px;font-size:9pt }
        th { background:#f0f0f0;text-align:left }
        .num { text-align:right;font-family:monospace }
      </style>
    </head><body>
      <h2>General Ledger</h2>
      <p>${esc(rangeLabel.textContent ?? '')}</p>
      <table>
        <thead>
          <tr>
            <th>Date (Nep / Eng)</th><th>Voucher</th><th>Particulars</th>
            <th style="text-align:right">Debit</th>
            <th style="text-align:right">Credit</th>
            <th style="text-align:right">Balance</th>
          </tr>
        </thead>
        <tbody>${openHtml}${txnHtml}${closeHtml}</tbody>
      </table>
    </body></html>`;

    const w = window.open('', '_blank', 'width=1000,height=700');
    if (!w) { alert('Pop-up blocked. Allow pop-ups for this site.'); return; }
    w.document.write(html); w.document.close(); w.focus(); w.print();
  }
}
