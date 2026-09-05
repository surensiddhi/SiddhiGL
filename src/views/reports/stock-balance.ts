/**
 * reports/stock-balance.ts — Stock Balance report.
 * Qty balance + weighted-average valuation for QTY-tracked items, computed
 * from item_trans. Hash/'NONE' items don't carry a quantity ledger and are
 * excluded — there's nothing to balance for them.
 *
 * RPC: item_stock_balance
 */

import { rpc } from '../../lib/rpc';
import { ctx } from '../../lib/session';
import { fmt, escHtml, q } from '../../lib/ui-helpers';

interface StockRow {
  item_code:      string;
  item_name:      string;
  unit:           string | null;
  qty_in:         number;
  qty_out:        number;
  balance_qty:    number;
  avg_rate:       number;
  balance_value:  number;
}

export async function init(el: HTMLElement): Promise<void> {
  el.innerHTML = `
    <div class="page-header">
      <span class="page-title">Stock Balance</span>
    </div>

    <div class="toolbar" style="gap:8px;margin-bottom:12px">
      <input id="sb-search" type="text" placeholder="Search item code or name…"
        style="flex:1;max-width:280px;border:1px solid var(--border);border-radius:5px;
               padding:5px 10px;font-size:.875rem;background:var(--surface);color:var(--text)" />
    </div>

    <div style="overflow-x:auto">
      <table class="data-table" style="min-width:800px">
        <thead>
          <tr>
            <th>Item</th>
            <th>Unit</th>
            <th style="text-align:right">Qty In</th>
            <th style="text-align:right">Qty Out</th>
            <th style="text-align:right">Balance Qty</th>
            <th style="text-align:right">Avg Rate</th>
            <th style="text-align:right">Balance Value</th>
          </tr>
        </thead>
        <tbody id="sb-body"><tr><td colspan="7" class="loading-msg">Loading…</td></tr></tbody>
      </table>
    </div>
  `;

  let rows: StockRow[] = [];
  const render = () => {
    const term = q<HTMLInputElement>(el, '#sb-search').value.trim().toLowerCase();
    const filtered = !term ? rows : rows.filter(r =>
      r.item_code.toLowerCase().includes(term) || r.item_name.toLowerCase().includes(term));
    const body = q<HTMLElement>(el, '#sb-body');
    if (!filtered.length) { body.innerHTML = `<tr><td colspan="7" class="loading-msg">No stock-tracked items with movement</td></tr>`; return; }
    body.innerHTML = filtered.map(r => `
      <tr>
        <td>${escHtml(r.item_name)} <span style="color:var(--muted);font-size:.78rem">(${escHtml(r.item_code)})</span></td>
        <td>${escHtml(r.unit ?? '')}</td>
        <td style="text-align:right;font-family:monospace">${r.qty_in}</td>
        <td style="text-align:right;font-family:monospace">${r.qty_out}</td>
        <td style="text-align:right;font-family:monospace;font-weight:700">${r.balance_qty}</td>
        <td style="text-align:right;font-family:monospace">${fmt(r.avg_rate)}</td>
        <td style="text-align:right;font-family:monospace;font-weight:700">${fmt(r.balance_value)}</td>
      </tr>
    `).join('');
  };

  q(el, '#sb-search').addEventListener('input', render);

  try {
    rows = await rpc<StockRow[]>('item_stock_balance', { ...ctx(), p_term: null });
    render();
  } catch (err) {
    q<HTMLElement>(el, '#sb-body').innerHTML =
      `<tr><td colspan="7" class="loading-msg">Load failed: ${err instanceof Error ? err.message : err}</td></tr>`;
  }
}
