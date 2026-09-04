/**
 * trial-balance.ts — Trial Balance report.
 * DB: get_trial_balance(p_tenant, p_caller, p_from_date date, p_to_date date,
 *                       p_branch? text, p_status text DEFAULT 'posted')
 *   → TABLE(account_no, name, acc_type, acc_class, opening, period_dr, period_cr, closing)
 */

import { trialBalance } from '../../services/report';
import { isoToBs, bsToIso } from '../../lib/bs-calendar';

// ── Types ──────────────────────────────────────────────────────────────────────

interface TBRow {
  account_no: string;
  name:       string;
  acc_type:   string;
  acc_class:  string;
  opening:    number;
  period_dr:  number;
  period_cr:  number;
  closing:    number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function isoToNep(iso: string): string {
  const bs = isoToBs(iso);
  return bs ? bs.replace(/\//g, '-') : '';
}

function toISO(bs: string): string {
  return bsToIso(bs.replace(/-/g, '/')) ?? '';
}

function todayIso(): string { return new Date().toISOString().slice(0, 10); }

/** Nepal fiscal year starts Shrawan 1 (BS month 04). */
function fyStartIso(): string {
  const bsToday = isoToBs(todayIso()) ?? '';           // "YYYY/MM/DD"
  if (!bsToday) return todayIso();
  const [y, m] = bsToday.split('/').map(Number);
  const fyYear = (m >= 4) ? y : y - 1;                // Shrawan=month 4
  return bsToIso(`${fyYear}/04/01`) ?? todayIso();
}

function fmt(n: number): string {
  if (n === 0) return '0.00';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── init ───────────────────────────────────────────────────────────────────────

export function init(el: HTMLElement): void {
  let allRows:    TBRow[] = [];
  let filterTerm = '';
  let loading    = false;

  const defaultFrom = fyStartIso();
  const defaultTo   = todayIso();

  // ── Shell ────────────────────────────────────────────────────────────────────

  el.innerHTML = `
    <div class="page-header">
      <span class="page-title">Trial Balance</span>
    </div>

    <div class="card" style="padding:16px 20px 12px">

      <!-- Date + status controls -->
      <div style="display:grid;grid-template-columns:auto 1fr auto 1fr;gap:8px 12px;
                  align-items:center;margin-bottom:12px;font-size:.875rem">

        <label style="font-weight:700;color:var(--text);white-space:nowrap">From (Nep)</label>
        <input id="tb-from-bs" type="text" placeholder="YYYY-MM-DD"
          style="border:1px solid var(--border);border-radius:5px;padding:5px 10px;
                 font-size:.875rem;background:var(--surface);color:var(--text);width:100%;box-sizing:border-box" />

        <label style="font-weight:700;color:var(--text);white-space:nowrap">To (Nep)</label>
        <input id="tb-to-bs" type="text" placeholder="YYYY-MM-DD"
          style="border:1px solid var(--border);border-radius:5px;padding:5px 10px;
                 font-size:.875rem;background:var(--surface);color:var(--text);width:100%;box-sizing:border-box" />

        <label style="font-weight:700;color:var(--text);white-space:nowrap">From (Eng)</label>
        <input id="tb-from-ad" type="date"
          style="border:1px solid var(--border);border-radius:5px;padding:5px 10px;
                 font-size:.875rem;background:var(--surface);color:var(--text);width:100%;box-sizing:border-box" />

        <label style="font-weight:700;color:var(--text);white-space:nowrap">To (Eng)</label>
        <input id="tb-to-ad" type="date"
          style="border:1px solid var(--border);border-radius:5px;padding:5px 10px;
                 font-size:.875rem;background:var(--surface);color:var(--text);width:100%;box-sizing:border-box" />

        <label style="font-weight:700;color:var(--text)">Status</label>
        <div style="grid-column:2 / -1">
          <select id="tb-status" class="at-select" style="width:180px">
            <option value="all">All</option>
            <option value="posted" selected>Posted</option>
            <option value="pending">Pending/Approved</option>
          </select>
        </div>

      </div>

      <!-- Toolbar -->
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button id="tb-fetch" class="btn btn-primary" style="min-width:80px">Fetch</button>
        <input id="tb-search" type="text" placeholder="Find account no or name…"
          style="flex:1;min-width:180px;max-width:300px;border:1px solid var(--border);
                 border-radius:5px;padding:5px 10px;font-size:.875rem;
                 background:var(--surface);color:var(--text)" />
        <button id="tb-csv"   class="btn btn-secondary">CSV</button>
        <button id="tb-print" class="btn btn-secondary">Print / PDF</button>
        <span   id="tb-range" style="margin-left:auto;color:var(--muted);font-size:.78rem"></span>
      </div>

    </div>

    <!-- Results -->
    <div class="card" style="padding:0;margin-top:12px">
      <div id="tb-body" style="overflow-x:auto">
        <div class="loading-msg" style="color:var(--muted)">
          Set the date range and press Fetch.
        </div>
      </div>
    </div>
  `;

  // ── Wire date inputs ───────────────────────────────────────────────────────

  const fromBS = el.querySelector<HTMLInputElement>('#tb-from-bs')!;
  const toBS   = el.querySelector<HTMLInputElement>('#tb-to-bs')!;
  const fromAD = el.querySelector<HTMLInputElement>('#tb-from-ad')!;
  const toAD   = el.querySelector<HTMLInputElement>('#tb-to-ad')!;

  // Set defaults
  fromAD.value = defaultFrom;
  toAD.value   = defaultTo;
  fromBS.value = isoToNep(defaultFrom);
  toBS.value   = isoToNep(defaultTo);

  // BS → AD sync
  fromBS.addEventListener('change', () => {
    const iso = toISO(fromBS.value);
    if (iso) fromAD.value = iso;
    else fromBS.value = isoToNep(fromAD.value);
  });
  toBS.addEventListener('change', () => {
    const iso = toISO(toBS.value);
    if (iso) toAD.value = iso;
    else toBS.value = isoToNep(toAD.value);
  });

  // AD → BS sync
  fromAD.addEventListener('change', () => {
    if (fromAD.value) fromBS.value = isoToNep(fromAD.value);
  });
  toAD.addEventListener('change', () => {
    if (toAD.value) toBS.value = isoToNep(toAD.value);
  });

  // ── Controls ───────────────────────────────────────────────────────────────

  const statusSel  = el.querySelector<HTMLSelectElement>('#tb-status')!;
  const searchInp  = el.querySelector<HTMLInputElement>('#tb-search')!;
  const rangeLabel = el.querySelector<HTMLElement>('#tb-range')!;

  el.querySelector('#tb-fetch')!.addEventListener('click', () => fetch());

  searchInp.addEventListener('input', () => {
    filterTerm = searchInp.value.trim().toLowerCase();
    renderTable();
  });

  el.querySelector('#tb-csv')!.addEventListener('click', exportCsv);
  el.querySelector('#tb-print')!.addEventListener('click', printReport);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  async function fetch(): Promise<void> {
    if (loading) return;
    const fromIso = fromAD.value;
    const toIso   = toAD.value;
    if (!fromIso || !toIso) { alert('Please set both From and To dates.'); return; }
    if (fromIso > toIso)    { alert('From date must be before To date.'); return; }

    loading = true;
    el.querySelector('#tb-body')!.innerHTML = '<div class="loading-msg">Loading…</div>';

    try {
      const status = statusSel.value as 'posted' | 'pending' | 'all';
      const data   = await trialBalance(fromIso, toIso, status) as TBRow[];
      allRows = (data ?? []).map(r => ({
        ...r,
        opening:   Number(r.opening   ?? 0),
        period_dr: Number(r.period_dr ?? 0),
        period_cr: Number(r.period_cr ?? 0),
        closing:   Number(r.closing   ?? 0),
      }));
      rangeLabel.textContent =
        `${statusSel.options[statusSel.selectedIndex].text} | ${fromIso} to ${toIso}`;
      filterTerm = '';
      searchInp.value = '';
      renderTable();
    } catch (err: unknown) {
      el.querySelector('#tb-body')!.innerHTML =
        `<div class="error-msg">${err instanceof Error ? err.message : 'Failed to load'}</div>`;
    } finally {
      loading = false;
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  function filtered(): TBRow[] {
    if (!filterTerm) return allRows;
    return allRows.filter(r =>
      r.account_no.toLowerCase().includes(filterTerm) ||
      r.name.toLowerCase().includes(filterTerm)
    );
  }

  function renderTable(): void {
    const tbody = el.querySelector('#tb-body')!;
    const rows  = filtered();

    if (!rows.length) {
      tbody.innerHTML = `<div class="loading-msg">No accounts found.</div>`;
      return;
    }

    let totOp = 0, totDr = 0, totCr = 0, totCl = 0;
    rows.forEach(r => {
      totOp += r.opening;
      totDr += r.period_dr;
      totCr += r.period_cr;
      totCl += r.closing;
    });

    tbody.innerHTML = `
      <table class="data-table" id="tb-table">
        <thead>
          <tr style="background:var(--bg)">
            <th style="width:100px">Account</th>
            <th>Name</th>
            <th style="width:140px;text-align:right">Opening</th>
            <th style="width:140px;text-align:right">Period Dr</th>
            <th style="width:140px;text-align:right">Period Cr</th>
            <th style="width:140px;text-align:right">Closing</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td style="font-family:monospace;font-size:.85rem">${esc(r.account_no)}</td>
              <td style="font-size:.875rem">${esc(r.name)}</td>
              <td style="text-align:right;font-family:monospace;font-size:.85rem;
                         color:${r.opening < 0 ? '#b91c1c' : 'inherit'}">
                ${fmt(r.opening)}
              </td>
              <td style="text-align:right;font-family:monospace;font-size:.85rem">
                ${r.period_dr ? fmt(r.period_dr) : ''}
              </td>
              <td style="text-align:right;font-family:monospace;font-size:.85rem">
                ${r.period_cr ? fmt(r.period_cr) : ''}
              </td>
              <td style="text-align:right;font-family:monospace;font-size:.85rem;
                         color:${r.closing < 0 ? '#b91c1c' : 'inherit'}">
                ${fmt(r.closing)}
              </td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr style="border-top:2px solid var(--border);background:var(--bg);font-weight:700">
            <td colspan="2" style="font-size:.85rem;padding:6px 8px;color:var(--muted)">
              Total (${rows.length} accounts)
            </td>
            <td style="text-align:right;font-family:monospace;font-size:.88rem;padding:6px 8px;
                       color:${totOp < 0 ? '#b91c1c' : 'inherit'}">
              ${fmt(totOp)}
            </td>
            <td style="text-align:right;font-family:monospace;font-size:.88rem;padding:6px 8px">
              ${fmt(totDr)}
            </td>
            <td style="text-align:right;font-family:monospace;font-size:.88rem;padding:6px 8px">
              ${fmt(totCr)}
            </td>
            <td style="text-align:right;font-family:monospace;font-size:.88rem;padding:6px 8px;
                       color:${totCl < 0 ? '#b91c1c' : 'inherit'}">
              ${fmt(totCl)}
            </td>
          </tr>
        </tfoot>
      </table>
    `;
  }

  // ── CSV export ─────────────────────────────────────────────────────────────

  function exportCsv(): void {
    const rows = filtered();
    if (!rows.length) { alert('No data to export.'); return; }

    const header = ['Account', 'Name', 'Opening', 'Period Dr', 'Period Cr', 'Closing'];
    const lines  = [header.join(',')];
    rows.forEach(r => {
      lines.push([
        r.account_no,
        `"${r.name.replace(/"/g, '""')}"`,
        r.opening,
        r.period_dr,
        r.period_cr,
        r.closing,
      ].join(','));
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `trial-balance-${fromAD.value}-to-${toAD.value}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Print ──────────────────────────────────────────────────────────────────

  function printReport(): void {
    const rows = filtered();
    if (!rows.length) { alert('No data to print.'); return; }

    let totOp = 0, totDr = 0, totCr = 0, totCl = 0;
    rows.forEach(r => {
      totOp += r.opening;
      totDr += r.period_dr;
      totCr += r.period_cr;
      totCl += r.closing;
    });

    const html = `<!DOCTYPE html><html><head>
      <title>Trial Balance</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 11pt; margin: 20px; }
        h2   { margin-bottom: 4px; }
        p    { margin: 0 0 12px; color: #555; font-size: 10pt; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ccc; padding: 4px 8px; font-size: 10pt; }
        th { background: #f0f0f0; text-align: left; }
        td.num { text-align: right; font-family: monospace; }
        tfoot td { font-weight: bold; background: #f8f8f8; }
        .neg { color: #b91c1c; }
      </style>
    </head><body>
      <h2>Trial Balance</h2>
      <p>${fromAD.value} to ${toAD.value} &nbsp;|&nbsp; ${statusSel.options[statusSel.selectedIndex].text}</p>
      <table>
        <thead>
          <tr>
            <th>Account</th><th>Name</th>
            <th style="text-align:right">Opening</th>
            <th style="text-align:right">Period Dr</th>
            <th style="text-align:right">Period Cr</th>
            <th style="text-align:right">Closing</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${r.account_no}</td>
              <td>${r.name}</td>
              <td class="num${r.opening < 0 ? ' neg' : ''}">${fmt(r.opening)}</td>
              <td class="num">${r.period_dr ? fmt(r.period_dr) : ''}</td>
              <td class="num">${r.period_cr ? fmt(r.period_cr) : ''}</td>
              <td class="num${r.closing < 0 ? ' neg' : ''}">${fmt(r.closing)}</td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="2">Total (${rows.length} accounts)</td>
            <td class="num${totOp < 0 ? ' neg' : ''}">${fmt(totOp)}</td>
            <td class="num">${fmt(totDr)}</td>
            <td class="num">${fmt(totCr)}</td>
            <td class="num${totCl < 0 ? ' neg' : ''}">${fmt(totCl)}</td>
          </tr>
        </tfoot>
      </table>
    </body></html>`;

    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) { alert('Pop-up blocked. Allow pop-ups for this site.'); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  }
}
