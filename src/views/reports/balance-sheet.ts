/** balance-sheet.ts — Balance Sheet report */

import { balanceSheet } from '../../services/report';
import { isoToBs, bsToIso } from '../../lib/bs-calendar';

interface BsRow {
  section:     string;
  group_code:  string;
  group_name:  string;
  account_no:  string | null;
  name:        string;
  amount:      number;
  is_computed: boolean;
}

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
  if (document.getElementById('bs-styles')) return;
  const s = document.createElement('style');
  s.id = 'bs-styles';
  s.textContent = `
    #bs-filter {
      display: grid;
      grid-template-columns: auto 1fr auto 1fr;
      align-items: center;
      gap: 6px 10px;
      margin-bottom: 14px;
    }
    #bs-filter label {
      font-size: 13px;
      color: var(--muted);
      white-space: nowrap;
    }
    #bs-filter input, #bs-filter select {
      font-size: 13px;
      padding: 5px 8px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: var(--input-bg, var(--card-bg));
      color: var(--text);
      width: 100%;
      box-sizing: border-box;
    }
    #bs-filter select { padding-right: 6px; }
    .bs-btn-row {
      grid-column: 1 / -1;
      display: flex;
      gap: 8px;
      margin-top: 4px;
    }
    .bs-btn-row button {
      padding: 5px 16px;
      font-size: 13px;
      border: 1px solid var(--border);
      border-radius: 4px;
      cursor: pointer;
      background: var(--card-bg);
      color: var(--text);
    }
    .bs-btn-row button.primary {
      background: #D97706;
      color: #fff;
      border-color: #D97706;
    }
    #bs-wrap {
      overflow-x: auto;
    }
    #bs-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      table-layout: fixed;
    }
    #bs-table thead th {
      background: #111827;
      color: #fff;
      padding: 7px 10px;
      text-align: left;
      font-weight: 600;
    }
    #bs-table thead th.num { text-align: right; padding-right: 14px; }
    #bs-table td {
      padding: 5px 10px;
      border-bottom: 1px solid var(--border);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    /* section header */
    .bs-section-hdr td {
      background: #0369a1;
      color: #fff;
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 0.04em;
    }
    /* group header */
    .bs-group-hdr td {
      font-weight: 700;
      color: var(--text);
      background: var(--row-alt, #f5f7fa);
    }
    /* account detail */
    .bs-acct td { color: var(--text); }
    /* computed profit row */
    .bs-computed td { color: #0d7e5a; font-style: italic; }
    /* group total */
    .bs-group-total td {
      font-style: italic;
      border-top: 1px solid #c0c0c0;
    }
    /* section total */
    .bs-section-total td {
      font-weight: 700;
      border-top: 2px solid #aaa;
    }
    /* balanced check */
    .bs-balanced td {
      background: #d1fae5;
      color: #065f46;
      font-weight: 700;
    }
    /* provisional note */
    .bs-provisional {
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

  const today    = todayIso();
  const todayNep = isoToNep(today);

  el.innerHTML = `
    <div class="page-header">
      <span class="page-title">Balance Sheet</span>
    </div>
    <div class="card">
      <div id="bs-filter">
        <label>As of (Nep)</label>
        <input id="bs-nep" type="text" value="${todayNep}" placeholder="YYYY-MM-DD">
        <label>As of (Eng)</label>
        <input id="bs-eng" type="date" value="${today}">

        <label>Status</label>
        <select id="bs-status" class="at-select">
          <option value="posted">Posted</option>
          <option value="all">All</option>
          <option value="pending">Pending</option>
        </select>
        <div></div><div></div>

        <div class="bs-btn-row">
          <button class="primary" id="bs-fetch">Fetch</button>
          <button id="bs-csv">CSV</button>
          <button id="bs-print">Print</button>
        </div>
      </div>

      <div id="bs-wrap">
        <table id="bs-table">
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
          <tbody id="bs-body">
            <tr><td colspan="3" style="text-align:center;color:var(--muted);padding:20px">
              Set date and click Fetch.
            </td></tr>
          </tbody>
        </table>
      </div>
      <div id="bs-note" class="bs-provisional" hidden></div>
    </div>
  `;

  /* ── sync date pickers ──────────────────────────────────── */
  const nepIn    = el.querySelector<HTMLInputElement>('#bs-nep')!;
  const engIn    = el.querySelector<HTMLInputElement>('#bs-eng')!;
  const statusSl = el.querySelector<HTMLSelectElement>('#bs-status')!;
  const body     = el.querySelector<HTMLTableSectionElement>('#bs-body')!;
  const note     = el.querySelector<HTMLElement>('#bs-note')!;

  nepIn.addEventListener('change', () => {
    const iso = nepToIso(nepIn.value.trim());
    if (iso) engIn.value = iso;
  });
  engIn.addEventListener('change', () => {
    if (engIn.value) nepIn.value = isoToNep(engIn.value);
  });

  /* ── fetch ──────────────────────────────────────────────── */
  async function fetch(): Promise<void> {
    const asOf   = engIn.value || today;
    const status = statusSl.value as 'posted' | 'pending' | 'all';

    body.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--muted);padding:20px">Loading…</td></tr>`;
    note.hidden = true;

    try {
      const rows = (await balanceSheet({ as_of: asOf, status })) as BsRow[];
      render(rows, status);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      body.innerHTML = `<tr><td colspan="3" style="color:red;padding:10px">${msg}</td></tr>`;
    }
  }

  el.querySelector('#bs-fetch')!.addEventListener('click', fetch);
  el.querySelector('#bs-print')!.addEventListener('click', () => window.print());
  el.querySelector('#bs-csv')!.addEventListener('click', () => exportCsv());

  /* ── render ─────────────────────────────────────────────── */
  let lastRows: BsRow[] = [];

  function render(rows: BsRow[], status: string): void {
    lastRows = rows;

    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--muted);padding:20px">No data.</td></tr>`;
      note.hidden = true;
      return;
    }

    /* group: section → groups → accounts */
    const sections: Map<string, Map<string, BsRow[]>> = new Map();
    for (const r of rows) {
      if (!sections.has(r.section)) sections.set(r.section, new Map());
      const groups = sections.get(r.section)!;
      if (!groups.has(r.group_code)) groups.set(r.group_code, []);
      groups.get(r.group_code)!.push(r);
    }

    const sectionOrder = ['ASSETS', 'LIABILITIES', 'EQUITY'];
    const sectionTotals: Record<string, number> = {};
    const html: string[] = [];

    for (const sec of sectionOrder) {
      const groups = sections.get(sec);
      if (!groups) continue;

      let secTotal = 0;

      /* section header */
      html.push(`<tr class="bs-section-hdr">
        <td colspan="3">${sec}</td>
      </tr>`);

      for (const [gCode, accts] of groups) {
        const gName = accts[0].group_name;
        const groupTotal = accts.reduce((s, r) => s + (r.amount ?? 0), 0);
        secTotal += groupTotal;

        /* group header */
        html.push(`<tr class="bs-group-hdr">
          <td>${gCode}</td>
          <td colspan="2">${gName}</td>
        </tr>`);

        /* account rows */
        for (const r of accts) {
          const cls  = r.is_computed ? 'bs-computed' : 'bs-acct';
          const code = r.account_no ?? '';
          html.push(`<tr class="${cls}">
            <td style="padding-left:20px">${code}</td>
            <td style="padding-left:${r.account_no ? '20px' : '10px'}">${r.name}</td>
            <td style="text-align:right;padding-right:14px">${fmt(r.amount)}</td>
          </tr>`);
        }

        /* group total */
        html.push(`<tr class="bs-group-total">
          <td></td>
          <td style="text-align:right;font-style:italic;color:var(--muted)">Total ${gName}</td>
          <td style="text-align:right;font-weight:700;padding-right:14px">${fmt(groupTotal)}</td>
        </tr>`);
      }

      /* section total */
      sectionTotals[sec] = secTotal;
      const secLabel = sec === 'ASSETS' ? 'Total Assets'
                     : sec === 'LIABILITIES' ? 'Total Liabilities'
                     : 'Total Equity';
      html.push(`<tr class="bs-section-total">
        <td></td>
        <td>${secLabel}</td>
        <td style="text-align:right;padding-right:14px">${fmt(secTotal)}</td>
      </tr>`);

      /* spacer between sections */
      if (sec !== sectionOrder[sectionOrder.length - 1]) {
        html.push(`<tr><td colspan="3" style="height:10px;border:none"></td></tr>`);
      }
    }

    /* balance check */
    const assets = sectionTotals['ASSETS'] ?? 0;
    const liab   = sectionTotals['LIABILITIES'] ?? 0;
    const eq     = sectionTotals['EQUITY'] ?? 0;
    const diff   = Math.abs(assets - (liab + eq));
    const balanced = diff < 0.005;

    if (balanced) {
      html.push(`<tr class="bs-balanced">
        <td colspan="3" style="text-align:center">
          Balanced &nbsp;·&nbsp; Total Assets ${fmt(assets)} = Liabilities + Equity ${fmt(liab + eq)}
        </td>
      </tr>`);
    } else {
      html.push(`<tr style="background:#fee2e2">
        <td colspan="3" style="text-align:center;color:#991b1b;font-weight:700">
          Out of balance by ${fmt(diff)} &nbsp;·&nbsp; Assets ${fmt(assets)} vs L+E ${fmt(liab + eq)}
        </td>
      </tr>`);
    }

    body.innerHTML = html.join('');

    /* provisional note */
    if (status !== 'posted') {
      const label = status === 'all' ? 'All' : 'Pending';
      note.textContent = `Provisional view (${label}): includes vouchers not yet posted.`;
      note.hidden = false;
    } else {
      note.hidden = true;
    }
  }

  /* ── CSV export ─────────────────────────────────────────── */
  function exportCsv(): void {
    if (!lastRows.length) return;
    const lines = ['Section,Group Code,Group Name,Account No,Name,Amount'];
    for (const r of lastRows) {
      lines.push([r.section, r.group_code, r.group_name, r.account_no ?? '', r.name, r.amount].join(','));
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'balance-sheet.csv'; a.click();
    URL.revokeObjectURL(url);
  }
}
