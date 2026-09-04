/** aging-report.ts — Aging Report (Receivables / Payables) */

import { aging } from '../../services/report';
import { isoToBs, bsToIso } from '../../lib/bs-calendar';

interface AgingRow {
  party_type: string;
  party_code: string;
  party_name: string;
  last_date:  string | null;
  age_days:   number;
  bucket:     number; // 0=Current 1=1-30 2=31-60 3=61-90 4=91-120 5=120+
  balance:    number;
}

const BUCKET_LABELS = ['Current', '1-30', '31-60', '61-90', '91-120', '120+'];

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
function fmt(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ── styles ───────────────────────────────────────────────── */
function injectStyles(): void {
  if (document.getElementById('ar-styles')) return;
  const s = document.createElement('style');
  s.id = 'ar-styles';
  s.textContent = `
    #ar-filter {
      display: grid;
      grid-template-columns: auto 1fr auto 1fr;
      align-items: center;
      gap: 6px 10px;
      margin-bottom: 14px;
    }
    #ar-filter label {
      font-size: 13px;
      color: var(--muted);
      white-space: nowrap;
    }
    #ar-filter input, #ar-filter select {
      font-size: 13px;
      padding: 5px 8px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: var(--input-bg, var(--card-bg));
      color: var(--text);
      width: 100%;
      box-sizing: border-box;
    }
    #ar-filter select { padding-right: 6px; }
    .ar-btn-row {
      grid-column: 1 / -1;
      display: flex;
      gap: 8px;
      margin-top: 4px;
      align-items: center;
    }
    .ar-btn-row button {
      padding: 5px 16px;
      font-size: 13px;
      border: 1px solid var(--border);
      border-radius: 4px;
      cursor: pointer;
      background: var(--card-bg);
      color: var(--text);
    }
    .ar-btn-row button.primary {
      background: #D97706;
      color: #fff;
      border-color: #D97706;
    }
    .ar-btn-row input#ar-find {
      flex: 1;
      max-width: 240px;
      font-size: 13px;
      padding: 5px 8px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: var(--input-bg, var(--card-bg));
      color: var(--text);
    }
    .ar-summary {
      margin-left: auto;
      font-size: 12px;
      color: var(--muted);
    }
    #ar-wrap { overflow-x: auto; }
    #ar-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      table-layout: fixed;
    }
    #ar-table thead th {
      background: #111827;
      color: #fff;
      padding: 7px 10px;
      text-align: left;
      font-weight: 600;
    }
    #ar-table thead th.num { text-align: right; padding-right: 14px; }
    #ar-table td {
      padding: 6px 10px;
      border-bottom: 1px solid var(--border);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #ar-table td.num { text-align: right; padding-right: 14px; }
    #ar-table tbody tr:hover td { background: color-mix(in srgb, #D97706 4%, transparent); }
    .ar-totals td {
      font-weight: 700;
      background: var(--row-alt, #f5f7fa);
      border-top: 2px solid #aaa;
    }
  `;
  document.head.appendChild(s);
}

/* ── main ─────────────────────────────────────────────────── */
export function init(el: HTMLElement): void {
  injectStyles();

  const today = todayIso();

  el.innerHTML = `
    <div class="page-header">
      <span class="page-title">Aging Report</span>
    </div>
    <div class="card">
      <div id="ar-filter">
        <label>Mode</label>
        <select id="ar-mode" class="at-select">
          <option value="receivable">Receivables (customers)</option>
          <option value="payable">Payables (suppliers)</option>
        </select>

        <label>As of (Nep)</label>
        <input id="ar-nep" type="text" value="${isoToNep(today)}" placeholder="YYYY-MM-DD">

        <label>As of (Eng)</label>
        <input id="ar-eng" type="date" value="${today}">

        <label>Status</label>
        <select id="ar-status" class="at-select">
          <option value="posted">Posted</option>
          <option value="all">All</option>
          <option value="pending">Pending</option>
        </select>

        <div class="ar-btn-row">
          <button class="primary" id="ar-fetch">Fetch</button>
          <input id="ar-find" type="text" placeholder="Find party...">
          <button id="ar-csv">CSV</button>
          <button id="ar-print">Print / PDF</button>
          <span class="ar-summary" id="ar-summary"></span>
        </div>
      </div>

      <div id="ar-wrap">
        <table id="ar-table">
          <colgroup>
            <col>
            <col style="width:100px"><col style="width:100px"><col style="width:100px">
            <col style="width:100px"><col style="width:100px"><col style="width:110px">
            <col style="width:120px">
          </colgroup>
          <thead>
            <tr>
              <th>Party</th>
              <th class="num">Current</th>
              <th class="num">1-30</th>
              <th class="num">31-60</th>
              <th class="num">61-90</th>
              <th class="num">91-120</th>
              <th class="num">120+</th>
              <th class="num">Total</th>
            </tr>
          </thead>
          <tbody id="ar-body">
            <tr><td colspan="8" style="text-align:center;color:var(--muted);padding:20px">
              Set date and click Fetch.
            </td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  const modeSl   = el.querySelector<HTMLSelectElement>('#ar-mode')!;
  const nepIn    = el.querySelector<HTMLInputElement>('#ar-nep')!;
  const engIn    = el.querySelector<HTMLInputElement>('#ar-eng')!;
  const statusSl = el.querySelector<HTMLSelectElement>('#ar-status')!;
  const findIn   = el.querySelector<HTMLInputElement>('#ar-find')!;
  const body     = el.querySelector<HTMLTableSectionElement>('#ar-body')!;
  const summary  = el.querySelector<HTMLElement>('#ar-summary')!;

  nepIn.addEventListener('change', () => { const iso = nepToIso(nepIn.value.trim()); if (iso) engIn.value = iso; });
  engIn.addEventListener('change', () => { if (engIn.value) nepIn.value = isoToNep(engIn.value); });

  let lastRows: AgingRow[] = [];

  async function fetchData(): Promise<void> {
    const asOf   = engIn.value || today;
    const mode   = modeSl.value as 'receivable' | 'payable';
    const status = statusSl.value as 'posted' | 'pending' | 'all';

    body.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:20px">Loading…</td></tr>`;
    summary.textContent = '';

    try {
      const rows = (await aging({ as_of: asOf, mode, status })) as AgingRow[];
      lastRows = rows;
      render(rows);
      const modeLabel = mode === 'payable' ? 'Payables' : 'Receivables';
      const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
      summary.textContent = `${modeLabel} | as of ${isoToNep(asOf)} | ${statusLabel}`;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      body.innerHTML = `<tr><td colspan="8" style="color:red;padding:10px">${msg}</td></tr>`;
    }
  }

  el.querySelector('#ar-fetch')!.addEventListener('click', fetchData);
  el.querySelector('#ar-print')!.addEventListener('click', () => window.print());
  el.querySelector('#ar-csv')!.addEventListener('click', () => exportCsv());
  findIn.addEventListener('input', () => render(lastRows));

  function render(rows: AgingRow[]): void {
    const q = findIn.value.trim().toLowerCase();
    const filtered = q
      ? rows.filter(r => r.party_name.toLowerCase().includes(q) || r.party_code.toLowerCase().includes(q))
      : rows;

    if (!filtered.length) {
      body.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:20px">No data.</td></tr>`;
      return;
    }

    const html: string[] = [];
    const totals = [0, 0, 0, 0, 0, 0];

    for (const r of filtered) {
      const buckets = [0, 0, 0, 0, 0, 0];
      buckets[r.bucket] = r.balance;
      for (let i = 0; i < 6; i++) totals[i] += buckets[i];
      const rowTotal = buckets.reduce((s, v) => s + v, 0);

      html.push(`<tr>
        <td>${r.party_code} ${r.party_name}</td>
        ${buckets.map(v => `<td class="num">${v ? fmt(v) : ''}</td>`).join('')}
        <td class="num">${fmt(rowTotal)}</td>
      </tr>`);
    }

    const grandTotal = totals.reduce((s, v) => s + v, 0);
    html.push(`<tr class="ar-totals">
      <td>Totals</td>
      ${totals.map(v => `<td class="num">${fmt(v)}</td>`).join('')}
      <td class="num">${fmt(grandTotal)}</td>
    </tr>`);

    body.innerHTML = html.join('');
  }

  function exportCsv(): void {
    if (!lastRows.length) return;
    const lines = ['Party Code,Party Name,Last Date,Age Days,Bucket,Balance'];
    for (const r of lastRows) {
      lines.push([r.party_code, r.party_name, r.last_date ?? '', r.age_days, BUCKET_LABELS[r.bucket], r.balance].join(','));
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'aging-report.csv'; a.click();
    URL.revokeObjectURL(url);
  }
}
