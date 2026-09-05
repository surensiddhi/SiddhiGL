/**
 * reports/expiry-report.ts — Near-Expiry Report.
 * Report-only (locked design decision): batch_no + expiry_date are captured
 * at purchase and surfaced here so near-expiring stock can be found; there's
 * no auto-FEFO costing on sales tied to this.
 *
 * RPC: item_expiry_report
 */

import { rpc } from '../../lib/rpc';
import { ctx } from '../../lib/session';
import { escHtml, q } from '../../lib/ui-helpers';

interface ExpiryRow {
  item_code:    string;
  item_name:    string;
  batch_no:     string | null;
  expiry_date:  string;
  qty_in:       number;
  qty_out:      number;
  balance_qty:  number;
}

function daysUntil(iso: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(iso);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export async function init(el: HTMLElement): Promise<void> {
  el.innerHTML = `
    <div class="page-header">
      <span class="page-title">Near-Expiry Report</span>
    </div>

    <div class="toolbar" style="gap:8px;margin-bottom:12px;align-items:center">
      <label style="font-size:.8rem;color:var(--muted)">Within</label>
      <select id="er-days" class="at-select">
        <option value="30">30 days</option>
        <option value="60">60 days</option>
        <option value="90" selected>90 days</option>
        <option value="180">180 days</option>
      </select>
      <button id="er-fetch" class="btn btn-primary" style="font-size:.85rem">Fetch</button>
    </div>

    <div style="overflow-x:auto">
      <table class="data-table" style="min-width:800px">
        <thead>
          <tr>
            <th>Item</th>
            <th>Batch</th>
            <th>Expiry Date</th>
            <th style="text-align:right">Days Left</th>
            <th style="text-align:right">Balance Qty</th>
          </tr>
        </thead>
        <tbody id="er-body"><tr><td colspan="5" class="loading-msg">Loading…</td></tr></tbody>
      </table>
    </div>
  `;

  q(el, '#er-fetch').addEventListener('click', () => load(el));
  await load(el);
}

async function load(el: HTMLElement): Promise<void> {
  const days = Number(q<HTMLSelectElement>(el, '#er-days').value);
  const body = q<HTMLElement>(el, '#er-body');
  body.innerHTML = `<tr><td colspan="5" class="loading-msg">Loading…</td></tr>`;
  try {
    const rows = await rpc<ExpiryRow[]>('item_expiry_report', { ...ctx(), p_days_ahead: days });
    if (!rows?.length) { body.innerHTML = `<tr><td colspan="5" class="loading-msg">No batches expiring within ${days} days</td></tr>`; return; }
    body.innerHTML = rows.map(r => {
      const left = daysUntil(r.expiry_date);
      const urgent = left <= 15;
      return `
      <tr style="${urgent ? 'background:#FEF2F2' : ''}">
        <td>${escHtml(r.item_name)} <span style="color:var(--muted);font-size:.78rem">(${escHtml(r.item_code)})</span></td>
        <td style="font-family:monospace">${escHtml(r.batch_no ?? '—')}</td>
        <td>${r.expiry_date}</td>
        <td style="text-align:right;font-family:monospace;${urgent ? 'color:#DC2626;font-weight:700' : ''}">${left}</td>
        <td style="text-align:right;font-family:monospace;font-weight:700">${r.balance_qty}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    body.innerHTML = `<tr><td colspan="5" class="loading-msg">Load failed: ${err instanceof Error ? err.message : err}</td></tr>`;
  }
}
