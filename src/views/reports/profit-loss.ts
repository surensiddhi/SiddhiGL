/** profit-loss.ts — Profit & Loss report */

import { profitLoss } from '../../services/report';
import { isoToBs, bsToIso } from '../../lib/bs-calendar';

interface PlRow {
  section:    string;        // 'SALES' | 'COGS' | 'OTHER_INCOME' | 'OPERATING_EXP'
  sub_label:  string | null; // trading-mode COGS breakdown labels
  acc_type:   string | null;
  account_no: string | null;
  name:       string;
  amount:     number;
  grp:        string | null; // raw account group, independent of mode
}

const TRADING_GROUPS = new Set(['SALES', 'PURCHASE', 'DIRECT_EXP', 'OPEN_STOCK', 'CLOSE_STOCK']);

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
function firstOfMonthIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function fmt(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ── styles ───────────────────────────────────────────────── */
function injectStyles(): void {
  if (document.getElementById('pl-styles')) return;
  const s = document.createElement('style');
  s.id = 'pl-styles';
  s.textContent = `
    #pl-filter {
      display: grid;
      grid-template-columns: auto 1fr auto 1fr;
      align-items: center;
      gap: 6px 10px;
      margin-bottom: 14px;
    }
    #pl-filter label {
      font-size: 13px;
      color: var(--muted);
      white-space: nowrap;
    }
    #pl-filter input, #pl-filter select {
      font-size: 13px;
      padding: 5px 8px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: var(--input-bg, var(--card-bg));
      color: var(--text);
      width: 100%;
      box-sizing: border-box;
    }
    #pl-filter select { padding-right: 6px; }
    .pl-btn-row {
      grid-column: 1 / -1;
      display: flex;
      gap: 8px;
      margin-top: 4px;
    }
    .pl-btn-row button {
      padding: 5px 16px;
      font-size: 13px;
      border: 1px solid var(--border);
      border-radius: 4px;
      cursor: pointer;
      background: var(--card-bg);
      color: var(--text);
    }
    .pl-btn-row button.primary {
      background: #D97706;
      color: #fff;
      border-color: #D97706;
    }
    #pl-wrap { overflow-x: auto; }
    #pl-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      table-layout: fixed;
    }
    #pl-table thead th {
      background: #111827;
      color: #fff;
      padding: 7px 10px;
      text-align: left;
      font-weight: 600;
    }
    #pl-table thead th.num { text-align: right; padding-right: 14px; }
    #pl-table td {
      padding: 5px 10px;
      border-bottom: 1px solid var(--border);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    /* section header */
    .pl-section-hdr td {
      background: #0369a1;
      color: #fff;
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 0.04em;
    }
    /* sub-group header (trading mode COGS breakdown) */
    .pl-sub-hdr td {
      font-weight: 700;
      color: var(--text);
      background: var(--row-alt, #f5f7fa);
    }
    .pl-acct td { color: var(--text); }
    /* section / sub total */
    .pl-total td {
      font-weight: 700;
      border-top: 1px solid #c0c0c0;
    }
    /* gross / net profit */
    .pl-profit td {
      background: #d1fae5;
      color: #065f46;
      font-weight: 700;
      border-top: 2px solid #aaa;
    }
    .pl-loss td {
      background: #fee2e2;
      color: #991b1b;
      font-weight: 700;
      border-top: 2px solid #aaa;
    }
    .pl-note {
      margin-top: 10px;
      font-size: 12px;
      color: #b45309;
      font-style: italic;
    }
  `;
  document.head.appendChild(s);
}

/* ── main ─────────────────────────────────────────────────── */
export function init(el: HTMLElement): void {
  injectStyles();

  const fromIso = firstOfMonthIso();
  const toIso   = todayIso();

  el.innerHTML = `
    <div class="page-header">
      <span class="page-title">Profit &amp; Loss</span>
    </div>
    <div class="card">
      <div id="pl-filter">
        <label>From (Nep)</label>
        <input id="pl-from-nep" type="text" value="${isoToNep(fromIso)}" placeholder="YYYY-MM-DD">
        <label>To (Nep)</label>
        <input id="pl-to-nep" type="text" value="${isoToNep(toIso)}" placeholder="YYYY-MM-DD">

        <label>From (Eng)</label>
        <input id="pl-from-eng" type="date" value="${fromIso}">
        <label>To (Eng)</label>
        <input id="pl-to-eng" type="date" value="${toIso}">

        <label>Status</label>
        <select id="pl-status" class="at-select">
          <option value="posted">Posted</option>
          <option value="all">All</option>
          <option value="pending">Pending</option>
        </select>
        <div></div><div></div>

        <div class="pl-btn-row">
          <button class="primary" id="pl-fetch">Fetch</button>
          <button id="pl-csv">CSV</button>
          <button id="pl-print">Print / PDF</button>
        </div>
      </div>

      <div id="pl-wrap">
        <table id="pl-table">
          <colgroup>
            <col style="width:90px">
            <col>
            <col style="width:160px">
          </colgroup>
          <thead>
            <tr>
              <th>Code</th>
              <th>Account / Group</th>
              <th class="num">Amount</th>
            </tr>
          </thead>
          <tbody id="pl-body">
            <tr><td colspan="3" style="text-align:center;color:var(--muted);padding:20px">
              Set dates and click Fetch.
            </td></tr>
          </tbody>
        </table>
      </div>
      <div id="pl-note" class="pl-note" hidden></div>
    </div>
  `;

  const fromNep  = el.querySelector<HTMLInputElement>('#pl-from-nep')!;
  const toNep    = el.querySelector<HTMLInputElement>('#pl-to-nep')!;
  const fromEng  = el.querySelector<HTMLInputElement>('#pl-from-eng')!;
  const toEng    = el.querySelector<HTMLInputElement>('#pl-to-eng')!;
  const statusSl = el.querySelector<HTMLSelectElement>('#pl-status')!;
  const body     = el.querySelector<HTMLTableSectionElement>('#pl-body')!;
  const note     = el.querySelector<HTMLElement>('#pl-note')!;

  fromNep.addEventListener('change', () => { const iso = nepToIso(fromNep.value.trim()); if (iso) fromEng.value = iso; });
  toNep.addEventListener('change',   () => { const iso = nepToIso(toNep.value.trim());   if (iso) toEng.value   = iso; });
  fromEng.addEventListener('change', () => { if (fromEng.value) fromNep.value = isoToNep(fromEng.value); });
  toEng.addEventListener('change',   () => { if (toEng.value)   toNep.value   = isoToNep(toEng.value); });

  let lastRows: PlRow[] = [];

  async function fetchData(): Promise<void> {
    const from   = fromEng.value || fromIso;
    const to     = toEng.value   || toIso;
    const status = statusSl.value as 'posted' | 'pending' | 'all';

    body.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--muted);padding:20px">Loading…</td></tr>`;
    note.hidden = true;

    try {
      const rows = (await profitLoss({ from, to, status })) as PlRow[];
      render(rows);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      body.innerHTML = `<tr><td colspan="3" style="color:red;padding:10px">${msg}</td></tr>`;
    }
  }

  el.querySelector('#pl-fetch')!.addEventListener('click', fetchData);
  el.querySelector('#pl-print')!.addEventListener('click', () => window.print());
  el.querySelector('#pl-csv')!.addEventListener('click', () => exportCsv());

  function render(rows: PlRow[]): void {
    lastRows = rows;

    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--muted);padding:20px">No data.</td></tr>`;
      note.hidden = true;
      return;
    }

    const isTrading = rows.some(r => r.section === 'SALES' || r.section === 'COGS');
    const html: string[] = [];

    function renderPlainSection(sec: string, label: string): number {
      const items = rows.filter(r => r.section === sec);
      if (!items.length) return 0;
      const total = items.reduce((s, r) => s + (r.amount ?? 0), 0);

      html.push(`<tr class="pl-section-hdr"><td colspan="3">${label}</td></tr>`);
      for (const r of items) {
        html.push(`<tr class="pl-acct">
          <td style="padding-left:20px">${r.account_no ?? ''}</td>
          <td style="padding-left:${r.account_no ? '20px' : '10px'}">${r.name}</td>
          <td style="text-align:right;padding-right:14px">${fmt(r.amount)}</td>
        </tr>`);
      }
      html.push(`<tr class="pl-total">
        <td></td>
        <td>Total ${label}</td>
        <td style="text-align:right;padding-right:14px">${fmt(total)}</td>
      </tr>`);
      return total;
    }

    let netProfit: number;

    if (isTrading) {
      const salesTotal = renderPlainSection('SALES', 'Sales');

      /* COGS grouped by sub_label */
      const cogsItems = rows.filter(r => r.section === 'COGS');
      let cogsTotal = 0;
      if (cogsItems.length) {
        html.push(`<tr class="pl-section-hdr"><td colspan="3">Cost of Goods Sold</td></tr>`);
        const bySub = new Map<string, PlRow[]>();
        for (const r of cogsItems) {
          const key = r.sub_label ?? 'Other';
          if (!bySub.has(key)) bySub.set(key, []);
          bySub.get(key)!.push(r);
        }
        for (const [label, items] of bySub) {
          const subTotal = items.reduce((s, r) => s + (r.amount ?? 0), 0);
          cogsTotal += subTotal;
          html.push(`<tr class="pl-sub-hdr"><td></td><td colspan="2">${label}</td></tr>`);
          for (const r of items) {
            html.push(`<tr class="pl-acct">
              <td style="padding-left:20px">${r.account_no ?? ''}</td>
              <td style="padding-left:${r.account_no ? '20px' : '10px'}">${r.name}</td>
              <td style="text-align:right;padding-right:14px">${fmt(r.amount)}</td>
            </tr>`);
          }
        }
        html.push(`<tr class="pl-total">
          <td></td><td>Total Cost of Goods Sold</td>
          <td style="text-align:right;padding-right:14px">${fmt(cogsTotal)}</td>
        </tr>`);
      }

      const grossProfit = salesTotal - cogsTotal;
      html.push(`<tr class="${grossProfit >= 0 ? 'pl-profit' : 'pl-loss'}">
        <td></td><td>Gross Profit</td>
        <td style="text-align:right;padding-right:14px">${fmt(grossProfit)}</td>
      </tr>`);

      const otherIncomeTotal = renderPlainSection('OTHER_INCOME', 'Other Income');
      const opExpTotal       = renderPlainSection('OPERATING_EXP', 'Operating Expenses');

      netProfit = grossProfit + otherIncomeTotal - opExpTotal;
    } else {
      const incomeTotal  = renderPlainSection('OTHER_INCOME', 'Income');
      const expenseTotal = renderPlainSection('OPERATING_EXP', 'Expenses');
      netProfit = incomeTotal - expenseTotal;
    }

    html.push(`<tr class="${netProfit >= 0 ? 'pl-profit' : 'pl-loss'}">
      <td></td><td>Net Profit</td>
      <td style="text-align:right;padding-right:14px">${fmt(netProfit)}</td>
    </tr>`);

    body.innerHTML = html.join('');

    /* service-mode-but-trading-activity note */
    const hasTradingActivity = rows.some(r => r.grp && TRADING_GROUPS.has(r.grp));
    if (!isTrading && hasTradingActivity) {
      note.textContent = 'Trading accounts have activity, but this report is in Service mode (set in Settings). Switch to Trading there to see Gross Profit.';
      note.hidden = false;
    } else {
      note.hidden = true;
    }
  }

  function exportCsv(): void {
    if (!lastRows.length) return;
    const lines = ['Section,Sub Label,Account No,Name,Amount'];
    for (const r of lastRows) {
      lines.push([r.section, r.sub_label ?? '', r.account_no ?? '', r.name, r.amount].join(','));
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'profit-loss.csv'; a.click();
    URL.revokeObjectURL(url);
  }
}
