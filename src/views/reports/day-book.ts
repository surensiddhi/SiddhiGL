/**
 * day-book.ts — Day Book report
 *
 * Displays all vouchers in a date range, grouped by voucher.
 * Each voucher renders as:
 *   1. Voucher header row  — date (BS + AD), voucher_no, tran_type, description
 *   2. Detail rows         — account, particulars / party, debit, credit
 *   3. Voucher footer row  — "Voucher total" with summed Dr / Cr
 * Followed by a Grand Total row.
 */

import { dayBook }           from '../../services/report';
import { isoToBs, bsToIso } from '../../lib/bs-calendar';

// ── Types ────────────────────────────────────────────────────────────────────

interface DayBookRow {
  head_id:          number;
  voucher_no:       string | null;
  voucher_date:     string;         // ISO date "YYYY-MM-DD"
  voucher_date_nep: string | null;  // BS date already computed by DB
  tran_type:        string | null;
  voucher_desc:     string | null;
  line_no:          number;
  account_no:       string | null;
  account_name:     string | null;
  particulars:      string | null;
  party_type:       string | null;
  party_code:       string | null;
  party_name:       string | null;
  debit:            number | null;
  credit:           number | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoToNep(iso: string): string {
  const bs = isoToBs(iso);
  if (!bs) return iso;
  return bs.replace(/\//g, '-');
}

function nepToIso(nep: string): string | null {
  return bsToIso(nep.replace(/-/g, '/'));
}

/** Default from-date: start of current BS fiscal year (Baisakh 1). */
function defaultFrom(): string {
  const bsToday = isoToBs(todayIso()) ?? '';
  const fyYear  = bsToday
    ? (parseInt(bsToday.split('/')[1] ?? '1') < 4
        ? parseInt(bsToday.split('/')[0] ?? '2081') - 1
        : parseInt(bsToday.split('/')[0] ?? '2081'))
    : 2081;
  return bsToIso(`${fyYear}/04/01`) ?? todayIso();
}

function fmt(n: number | null | undefined): string {
  if (n == null || n === 0) return '';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function h(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── View ─────────────────────────────────────────────────────────────────────

export function init(el: HTMLElement): void {

  const fromAdDef = defaultFrom();
  const toAdDef   = todayIso();
  const fromBsDef = isoToNep(fromAdDef);
  const toBsDef   = isoToNep(toAdDef);

  // Inject scoped styles once
  if (!document.getElementById('db-styles')) {
    const s = document.createElement('style');
    s.id = 'db-styles';
    s.textContent = `
      /* Day Book — column headers */
      #db-table thead th {
        background: #111827;
        color: #fff;
        font-weight: 600;
        border-color: #374151;
      }
      /* Clip long text so rows stay uniform height */
      #db-table td {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* Day Book — voucher header row */
      .db-voucher-hdr {
        background: #eeeeee;
        color: #111827;
        font-weight: 600;
        padding: 6px 10px !important;
      }
      .db-voucher-hdr .db-date-ad { color: #555; font-size: .88em; margin-left: 2px; }
      .db-voucher-hdr .db-voucher-no { letter-spacing: .02em; }
      .db-voucher-hdr .db-tran-type {
        background: rgba(0,0,0,.08);
        border-radius: 3px;
        padding: 1px 6px;
        font-size: .82em;
      }
      .db-voucher-hdr .db-desc { color: #444; font-style: italic; }
      /* Debit / Credit header right padding — inline padding handles data cells */
      #db-table th:nth-child(3),
      #db-table th:nth-child(4) {
        padding-right: 14px;
      }
      /* Day Book — footer label */
      .db-voucher-footer-label {
        text-align: right;
        font-style: italic;
        color: var(--muted);
      }
    `;
    document.head.appendChild(s);
  }

  el.innerHTML = `
<div class="page-header">
  <span class="page-title">Day Book</span>
</div>

<div class="card" style="padding:16px 20px 12px">

  <!-- Date grid: label · input · label · input (same layout as General Ledger) -->
  <div style="display:grid;grid-template-columns:auto 1fr auto 1fr;gap:8px 12px;
              align-items:center;margin-bottom:12px;font-size:.875rem">

    <label style="font-weight:700;color:var(--text);white-space:nowrap">From (Nep)</label>
    <input id="db-from-bs" type="text" placeholder="YYYY-MM-DD" value="${fromBsDef}"
      style="border:1px solid var(--border);border-radius:5px;padding:5px 10px;
             font-size:.875rem;background:var(--surface);color:var(--text);
             width:100%;box-sizing:border-box">

    <label style="font-weight:700;color:var(--text);white-space:nowrap">To (Nep)</label>
    <input id="db-to-bs" type="text" placeholder="YYYY-MM-DD" value="${toBsDef}"
      style="border:1px solid var(--border);border-radius:5px;padding:5px 10px;
             font-size:.875rem;background:var(--surface);color:var(--text);
             width:100%;box-sizing:border-box">

    <label style="font-weight:700;color:var(--text);white-space:nowrap">From (Eng)</label>
    <input id="db-from-ad" type="date" value="${fromAdDef}"
      style="border:1px solid var(--border);border-radius:5px;padding:5px 10px;
             font-size:.875rem;background:var(--surface);color:var(--text);
             width:100%;box-sizing:border-box">

    <label style="font-weight:700;color:var(--text);white-space:nowrap">To (Eng)</label>
    <input id="db-to-ad" type="date" value="${toAdDef}"
      style="border:1px solid var(--border);border-radius:5px;padding:5px 10px;
             font-size:.875rem;background:var(--surface);color:var(--text);
             width:100%;box-sizing:border-box">

  </div>

  <!-- Toolbar -->
  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
    <button id="db-fetch" class="btn btn-primary" style="min-width:80px">Fetch</button>
    <select id="db-status" class="at-select" style="width:170px">
      <option value="pending">Pending / Approved</option>
      <option value="posted">Posted</option>
      <option value="all">All</option>
    </select>
    <select id="db-tran-type" class="at-select" style="width:110px">
      <option value="">All Types</option>
      <option value="JV">JV</option>
      <option value="PV">PV</option>
      <option value="RV">RV</option>
      <option value="VOID">VOID</option>
    </select>
    <input id="db-find" type="text" placeholder="Find account / party / narration…"
      style="flex:1;min-width:180px;max-width:320px;border:1px solid var(--border);
             border-radius:5px;padding:5px 10px;font-size:.875rem;
             background:var(--surface);color:var(--text)">
    <button id="db-csv"   class="btn btn-secondary">CSV</button>
    <button id="db-print" class="btn btn-secondary">Print / PDF</button>
    <span   id="db-status-label" style="margin-left:auto;color:var(--muted);font-size:.78rem"></span>
  </div>

</div>

<div id="db-result" style="margin-top:12px"></div>
`;

  // ── Element refs ──────────────────────────────────────────────────────────
  const fromBsEl    = el.querySelector<HTMLInputElement>('#db-from-bs')!;
  const toBsEl      = el.querySelector<HTMLInputElement>('#db-to-bs')!;
  const fromAdEl    = el.querySelector<HTMLInputElement>('#db-from-ad')!;
  const toAdEl      = el.querySelector<HTMLInputElement>('#db-to-ad')!;
  const statusEl    = el.querySelector<HTMLSelectElement>('#db-status')!;
  const tranTypeEl  = el.querySelector<HTMLSelectElement>('#db-tran-type')!;
  const findEl      = el.querySelector<HTMLInputElement>('#db-find')!;
  const fetchBtn    = el.querySelector<HTMLButtonElement>('#db-fetch')!;
  const csvBtn      = el.querySelector<HTMLButtonElement>('#db-csv')!;
  const printBtn    = el.querySelector<HTMLButtonElement>('#db-print')!;
  const statusLabel = el.querySelector<HTMLSpanElement>('#db-status-label')!;
  const resultEl    = el.querySelector<HTMLDivElement>('#db-result')!;

  let allRows: DayBookRow[] = [];

  // ── Date sync ─────────────────────────────────────────────────────────────

  fromBsEl.addEventListener('change', () => {
    const iso = nepToIso(fromBsEl.value.trim());
    if (iso) fromAdEl.value = iso;
    else     fromBsEl.value = isoToNep(fromAdEl.value);
  });
  toBsEl.addEventListener('change', () => {
    const iso = nepToIso(toBsEl.value.trim());
    if (iso) toAdEl.value = iso;
    else     toBsEl.value = isoToNep(toAdEl.value);
  });
  fromAdEl.addEventListener('change', () => { if (fromAdEl.value) fromBsEl.value = isoToNep(fromAdEl.value); });
  toAdEl.addEventListener('change',   () => { if (toAdEl.value)   toBsEl.value   = isoToNep(toAdEl.value);   });

  // ── Find filter ───────────────────────────────────────────────────────────

  findEl.addEventListener('input', applyFind);

  function applyFind(): void {
    const term = findEl.value.trim().toLowerCase();
    resultEl.querySelectorAll<HTMLElement>('.db-voucher').forEach(vEl => {
      if (!term) {
        vEl.style.display = '';
        vEl.querySelectorAll<HTMLElement>('.db-detail').forEach(r => r.style.display = '');
        return;
      }
      const hdrText = (vEl.querySelector('.db-voucher-hdr')?.textContent ?? '').toLowerCase();
      const hdrHit  = hdrText.includes(term);
      let   anyLine = false;
      vEl.querySelectorAll<HTMLElement>('.db-detail').forEach(r => {
        const hit = r.textContent!.toLowerCase().includes(term);
        r.style.display = hit ? '' : 'none';
        if (hit) anyLine = true;
      });
      if (hdrHit) {
        // Show all detail lines when header matches
        vEl.querySelectorAll<HTMLElement>('.db-detail').forEach(r => r.style.display = '');
      }
      vEl.style.display = (hdrHit || anyLine) ? '' : 'none';
    });
  }

  // ── Fetch ─────────────────────────────────────────────────────────────────

  fetchBtn.addEventListener('click', fetchData);

  async function fetchData(): Promise<void> {
    const fromAd = fromAdEl.value;
    const toAd   = toAdEl.value;
    if (!fromAd || !toAd) { alert('Please enter date range.'); return; }

    fetchBtn.disabled    = true;
    fetchBtn.textContent = 'Loading…';
    resultEl.innerHTML   = '';
    statusLabel.textContent = '';

    try {
      const rows = await dayBook({
        from:      fromAd,
        to:        toAd,
        status:    statusEl.value as 'posted' | 'pending' | 'all',
        tran_type: tranTypeEl.value || undefined,
      }) as DayBookRow[];

      allRows = rows;
      renderTable(rows);

      const statusText = statusEl.options[statusEl.selectedIndex].text;
      statusLabel.textContent = `${statusText} | ${fromBsEl.value} – ${toBsEl.value}`;
    } catch (err: unknown) {
      resultEl.innerHTML = `<div class="alert alert-danger">Error: ${h(err)}</div>`;
    } finally {
      fetchBtn.disabled    = false;
      fetchBtn.textContent = 'Fetch';
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function renderTable(rows: DayBookRow[]): void {
    if (!rows.length) {
      resultEl.innerHTML = '<div class="card"><p style="color:var(--muted)">No records found for the selected range.</p></div>';
      return;
    }

    // Group rows by head_id (preserving order)
    const groups = new Map<number, DayBookRow[]>();
    for (const r of rows) {
      const g = groups.get(r.head_id);
      if (g) g.push(r);
      else   groups.set(r.head_id, [r]);
    }

    // Outer card + table
    resultEl.innerHTML = `
      <div class="card" style="padding:0; overflow-x:auto;" id="db-card">
        <table class="report-table" id="db-table"
               style="table-layout:fixed;width:100%">
          <colgroup>
            <col style="width:22%">
            <col>
            <col style="width:160px">
            <col style="width:160px">
          </colgroup>
          <thead>
            <tr>
              <th>Account</th>
              <th>Particulars / Party</th>
              <th style="text-align:right">Debit</th>
              <th style="text-align:right">Credit</th>
            </tr>
          </thead>
        </table>
      </div>`;

    const table = resultEl.querySelector<HTMLTableElement>('#db-table')!;
    let grandDr = 0, grandCr = 0;

    for (const [, lines] of groups) {
      const first = lines[0];

      // ── Dates ─────────────────────────────────────────────────────────────
      const adDate = String(first.voucher_date).slice(0, 10);
      const bsDate = first.voucher_date_nep
        ? String(first.voucher_date_nep).replace(/\//g, '-')
        : isoToNep(adDate);

      const voucherNo   = first.voucher_no  ?? '';
      const voucherDesc = first.voucher_desc ?? '';
      const tranType    = first.tran_type    ?? '';

      // ── Voucher totals ─────────────────────────────────────────────────────
      const vDr = lines.reduce((s, r) => s + (r.debit  ?? 0), 0);
      const vCr = lines.reduce((s, r) => s + (r.credit ?? 0), 0);
      grandDr += vDr;
      grandCr += vCr;

      // ── Build <tbody> per voucher (for find-filter toggling) ───────────────
      const vBody = document.createElement('tbody');
      vBody.className = 'db-voucher';

      // 1. Voucher header row
      const hdrTr = document.createElement('tr');
      hdrTr.className = 'db-voucher-header-row';
      const hdrTd = document.createElement('td');
      hdrTd.colSpan = 4;
      hdrTd.className = 'db-voucher-hdr';
      hdrTd.innerHTML =
        `<span class="db-date-bs">${h(bsDate)}</span>` +
        `<span class="db-date-ad">(${h(adDate)})</span>` +
        ` &nbsp;·&nbsp; ` +
        `<span class="db-voucher-no">${h(voucherNo)}</span>` +
        ` &nbsp;·&nbsp; ` +
        `<span class="db-tran-type">${h(tranType)}</span>` +
        (voucherDesc ? ` &nbsp;·&nbsp; <span class="db-desc">${h(voucherDesc)}</span>` : '');
      hdrTr.appendChild(hdrTd);
      vBody.appendChild(hdrTr);

      // 2. Detail rows (one per tran_detail line)
      for (const r of lines) {
        const acct  = [r.account_no, r.account_name].filter(Boolean).join(' ');
        const party = r.party_name
          ? `<span class="db-party" style="color:var(--muted); font-size:.85em"> · ${h(r.party_name)}</span>`
          : '';
        const dTr = document.createElement('tr');
        dTr.className = 'db-detail';
        dTr.innerHTML =
          `<td>${h(acct)}</td>` +
          `<td>${h(r.particulars ?? '')}${party}</td>` +
          `<td style="text-align:right; padding-right:14px">${fmt(r.debit)}</td>` +
          `<td style="text-align:right; padding-right:14px">${fmt(r.credit)}</td>`;
        vBody.appendChild(dTr);
      }

      // 3. Voucher footer / total row
      const ftrTr = document.createElement('tr');
      ftrTr.className = 'db-voucher-footer-row';
      ftrTr.innerHTML =
        `<td colspan="2" class="db-voucher-footer-label">Voucher total</td>` +
        `<td style="text-align:right; padding-right:14px; font-weight:600">${fmtNum(vDr)}</td>` +
        `<td style="text-align:right; padding-right:14px; font-weight:600">${fmtNum(vCr)}</td>`;
      vBody.appendChild(ftrTr);

      // Spacer between vouchers
      const spcTr = document.createElement('tr');
      spcTr.className = 'db-spacer';
      spcTr.innerHTML = '<td colspan="4" style="height:6px; background:var(--bg-alt, #f8f8f8)"></td>';
      vBody.appendChild(spcTr);

      table.appendChild(vBody);
    }

    // ── Grand total ──────────────────────────────────────────────────────────
    const gtBody = document.createElement('tbody');
    const gtTr   = document.createElement('tr');
    gtTr.className = 'db-grand-total-row';
    gtTr.innerHTML =
      `<td colspan="2" style="text-align:right; font-weight:700; border-top:2px solid var(--border)">Grand Total</td>` +
      `<td style="text-align:right; padding-right:14px; font-weight:700; border-top:2px solid var(--border)">${fmtNum(grandDr)}</td>` +
      `<td style="text-align:right; padding-right:14px; font-weight:700; border-top:2px solid var(--border)">${fmtNum(grandCr)}</td>`;
    gtBody.appendChild(gtTr);
    table.appendChild(gtBody);

    applyFind();
  }

  // ── CSV ───────────────────────────────────────────────────────────────────

  csvBtn.addEventListener('click', () => {
    if (!allRows.length) { alert('Fetch data first.'); return; }
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const cols = ['Date BS', 'Date AD', 'Voucher No', 'Type', 'Description',
                  'Account No', 'Account Name', 'Particulars', 'Party', 'Debit', 'Credit'];
    const lines: string[] = [cols.join(',')];

    for (const r of allRows) {
      const adDate = String(r.voucher_date).slice(0, 10);
      const bsDate = r.voucher_date_nep
        ? String(r.voucher_date_nep).replace(/\//g, '-')
        : isoToNep(adDate);
      lines.push([
        esc(bsDate), esc(adDate),
        esc(r.voucher_no), esc(r.tran_type), esc(r.voucher_desc),
        esc(r.account_no), esc(r.account_name),
        esc(r.particulars), esc(r.party_name),
        r.debit  ?? 0,
        r.credit ?? 0,
      ].join(','));
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a    = Object.assign(document.createElement('a'), {
      href:     URL.createObjectURL(blob),
      download: `day-book-${fromAdEl.value}-to-${toAdEl.value}.csv`,
    });
    a.click();
  });

  // ── Print / PDF ───────────────────────────────────────────────────────────

  printBtn.addEventListener('click', () => window.print());
}
