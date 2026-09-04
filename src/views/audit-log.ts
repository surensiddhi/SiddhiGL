/** audit-log.ts — Audit Log report */

import { auditLog } from '../services/audit';
import type { AuditLogRow } from '../services/audit';
import { isoToBs, bsToIso } from '../lib/bs-calendar';

const TABLE_OPTIONS = [
  '(any)', 'tran_head', 'tran_detail', 'chart_of_accounts', 'account_types',
  'parties', 'party_types', 'company_config', 'users',
];
const ACTION_OPTIONS = ['(any)', 'INSERT', 'UPDATE', 'DELETE'];

/* ── helpers ──────────────────────────────────────────────── */
function isoToNep(iso: string): string {
  try { return (isoToBs(iso) ?? iso).replace(/\//g, '-'); } catch { return iso; }
}
function nepToIso(nep: string): string {
  try { return bsToIso(nep.replace(/-/g, '/')) ?? ''; } catch { return ''; }
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'numeric', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  });
}
function fmtChanges(row: AuditLogRow): string {
  const c = row.changes;
  if (!c || typeof c !== 'object') return '';
  const entries = Object.entries(c);
  if (!entries.length) return '';

  if (row.action === 'UPDATE') {
    return entries
      .map(([k, v]) => {
        const pair = v as { old?: unknown; new?: unknown };
        return `${k}: ${JSON.stringify(pair?.old ?? null)} → ${JSON.stringify(pair?.new ?? null)}`;
      })
      .join('; ');
  }
  return entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ');
}
function esc(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

/* ── styles ───────────────────────────────────────────────── */
function injectStyles(): void {
  if (document.getElementById('al-styles')) return;
  const s = document.createElement('style');
  s.id = 'al-styles';
  s.textContent = `
    #al-filter {
      display: grid;
      grid-template-columns: auto 1fr auto 1fr auto 1fr;
      align-items: center;
      gap: 6px 10px;
      margin-bottom: 14px;
    }
    #al-filter label {
      font-size: 13px;
      color: var(--muted);
      white-space: nowrap;
    }
    #al-filter input, #al-filter select {
      font-size: 13px;
      padding: 5px 8px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: var(--input-bg, var(--card-bg));
      color: var(--text);
      width: 100%;
      box-sizing: border-box;
    }
    .al-btn-row {
      grid-column: 1 / -1;
      display: flex;
      gap: 8px;
      margin-top: 4px;
      align-items: center;
    }
    .al-btn-row button {
      padding: 5px 16px;
      font-size: 13px;
      border: 1px solid var(--border);
      border-radius: 4px;
      cursor: pointer;
      background: var(--card-bg);
      color: var(--text);
    }
    .al-btn-row button.primary {
      background: #D97706;
      color: #fff;
      border-color: #D97706;
    }
    .al-btn-row select {
      font-size: 13px;
      padding: 5px 8px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: var(--input-bg, var(--card-bg));
      color: var(--text);
    }
    #al-wrap { overflow-x: auto; }
    #al-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    #al-table thead th {
      background: #111827;
      color: #fff;
      padding: 7px 10px;
      text-align: left;
      font-weight: 600;
      white-space: nowrap;
    }
    #al-table td {
      padding: 6px 10px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    #al-table td.al-when, #al-table td.al-user, #al-table td.al-table, #al-table td.al-record {
      white-space: nowrap;
    }
    #al-table tbody tr:hover td { background: color-mix(in srgb, #D97706 4%, transparent); }
    .al-action-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 99px;
      font-size: 11px;
      font-weight: 600;
    }
    .al-action-INSERT { background: #D1FAE5; color: #065F46; }
    .al-action-UPDATE { background: #FEF3C7; color: #92400E; }
    .al-action-DELETE { background: #FEE2E2; color: #991B1B; }
  `;
  document.head.appendChild(s);
}

/* ── main ─────────────────────────────────────────────────── */
export function init(el: HTMLElement): void {
  injectStyles();

  const fromIso = daysAgoIso(90);
  const toIso   = todayIso();

  el.innerHTML = `
    <div class="page-header">
      <span class="page-title">Audit Log</span>
    </div>
    <div class="card">
      <div id="al-filter">
        <label>From (Nep)</label>
        <input id="al-from-nep" type="text" value="${isoToNep(fromIso)}" placeholder="YYYY-MM-DD">
        <label>To (Nep)</label>
        <input id="al-to-nep" type="text" value="${isoToNep(toIso)}" placeholder="YYYY-MM-DD">
        <label>User</label>
        <input id="al-user" type="text" placeholder="(any)">

        <label>From (Eng)</label>
        <input id="al-from-eng" type="date" value="${fromIso}">
        <label>To (Eng)</label>
        <input id="al-to-eng" type="date" value="${toIso}">
        <label>Table</label>
        <select id="al-table-sel" class="at-select">
          ${TABLE_OPTIONS.map(t => `<option value="${t === '(any)' ? '' : t}">${t}</option>`).join('')}
        </select>

        <div class="al-btn-row">
          <button class="primary" id="al-fetch">Fetch</button>
          <select id="al-action-sel">
            ${ACTION_OPTIONS.map(a => `<option value="${a === '(any)' ? '' : a}">${a}</option>`).join('')}
          </select>
          <button id="al-csv">CSV</button>
          <button id="al-print">Print / PDF</button>
        </div>
      </div>

      <div id="al-wrap">
        <table id="al-table">
          <thead>
            <tr>
              <th>When</th>
              <th>User</th>
              <th>Table</th>
              <th>Action</th>
              <th>Record</th>
              <th>Changes</th>
            </tr>
          </thead>
          <tbody id="al-body">
            <tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px">Set filters and Fetch.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  const fromNep = el.querySelector<HTMLInputElement>('#al-from-nep')!;
  const toNep   = el.querySelector<HTMLInputElement>('#al-to-nep')!;
  const fromEng = el.querySelector<HTMLInputElement>('#al-from-eng')!;
  const toEng   = el.querySelector<HTMLInputElement>('#al-to-eng')!;
  const userIn  = el.querySelector<HTMLInputElement>('#al-user')!;
  const tableSl = el.querySelector<HTMLSelectElement>('#al-table-sel')!;
  const actionSl= el.querySelector<HTMLSelectElement>('#al-action-sel')!;
  const body    = el.querySelector<HTMLTableSectionElement>('#al-body')!;

  fromNep.addEventListener('change', () => { const iso = nepToIso(fromNep.value.trim()); if (iso) fromEng.value = iso; });
  toNep.addEventListener('change',   () => { const iso = nepToIso(toNep.value.trim());   if (iso) toEng.value   = iso; });
  fromEng.addEventListener('change', () => { if (fromEng.value) fromNep.value = isoToNep(fromEng.value); });
  toEng.addEventListener('change',   () => { if (toEng.value)   toNep.value   = isoToNep(toEng.value); });

  let lastRows: AuditLogRow[] = [];

  async function fetchData(): Promise<void> {
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px">Loading…</td></tr>`;
    try {
      const rows = await auditLog({
        from:   fromEng.value || undefined,
        to:     toEng.value   || undefined,
        user:   userIn.value.trim() || undefined,
        table:  tableSl.value || undefined,
        action: actionSl.value || undefined,
        limit:  500,
      });
      lastRows = rows;
      render(rows);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      body.innerHTML = `<tr><td colspan="6" style="color:red;padding:10px">Error: ${esc(msg)}</td></tr>`;
    }
  }

  el.querySelector('#al-fetch')!.addEventListener('click', fetchData);
  el.querySelector('#al-print')!.addEventListener('click', () => window.print());
  el.querySelector('#al-csv')!.addEventListener('click', () => exportCsv());

  function render(rows: AuditLogRow[]): void {
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px">No matching entries.</td></tr>`;
      return;
    }
    body.innerHTML = rows.map(r => `
      <tr>
        <td class="al-when">${fmtWhen(r.changed_at)}</td>
        <td class="al-user">${esc(r.changed_by ?? '')}</td>
        <td class="al-table">${esc(r.table_name ?? '')}</td>
        <td class="al-record" style="text-transform:none">
          <span class="al-action-badge al-action-${r.action}">${r.action}</span>
        </td>
        <td class="al-record">${esc(r.row_key ?? '')}</td>
        <td>${esc(fmtChanges(r))}</td>
      </tr>
    `).join('');
  }

  function exportCsv(): void {
    if (!lastRows.length) return;
    const lines = ['When,User,Table,Action,Record,Changes'];
    for (const r of lastRows) {
      const csvSafe = (s: string) => `"${s.replace(/"/g, '""')}"`;
      lines.push([
        csvSafe(fmtWhen(r.changed_at)), csvSafe(r.changed_by ?? ''), csvSafe(r.table_name ?? ''),
        csvSafe(r.action), csvSafe(r.row_key ?? ''), csvSafe(fmtChanges(r)),
      ].join(','));
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'audit-log.csv'; a.click();
    URL.revokeObjectURL(url);
  }
}
