/**
 * stock-adjustment.ts — Stock Adjustment (Lost / Damaged items).
 * Posts its own GL entry (Dr expense a/c, Cr inventory a/c) since this
 * movement has no accompanying bill; writes item_trans only for QTY-tracked
 * items (hash/'NONE' items get the GL posting only — no stock ledger row).
 *
 * RPCs: adj_save, adj_list
 */

import { rpc } from '../lib/rpc';
import { ctx, roleLevel, getSession } from '../lib/session';
import { lookupData } from '../services/lookup';
import { todayIso, toBS, fmt, escHtml, escAttr, q } from '../lib/ui-helpers';

interface AdjRow {
  id:        number;
  adj_no:    string;
  adj_date:  string;
  item_code: string;
  item_name: string;
  qty:       number;
  rate:      number;
  value:     number;
  reason:    'LOST' | 'DAMAGED';
  status:    string;
}

let _canEdit = false;
let _selectedItem: { code: string; name: string } | null = null;

export async function init(el: HTMLElement): Promise<void> {
  const s = getSession();
  _canEdit = !!s && roleLevel(s) >= 3; // manager+, matches adj_save's server-side check
  _selectedItem = null;

  el.innerHTML = `
    <div class="page-header">
      <span class="page-title">Stock Adjustment</span>
    </div>

    <div id="sa-alert" hidden style="padding:10px 16px;border-radius:6px;margin-bottom:14px;
      font-size:.85rem;border:1px solid transparent"></div>

    ${_canEdit ? `
    <div class="card" style="padding:20px 24px;margin-bottom:20px">
      <h3 style="margin:0 0 16px">New Adjustment</h3>
      <form id="sa-form">
        <div class="form-grid" style="margin-bottom:14px">
          <div class="field" style="position:relative">
            <label>Item <span style="color:red">*</span></label>
            <input id="sa-item-in" type="text" placeholder="item code or name" autocomplete="off" />
            <div id="sa-item-drop" hidden style="position:absolute;top:100%;left:0;right:0;z-index:200;
              background:var(--surface);border:1px solid var(--border);border-radius:5px;
              box-shadow:0 4px 14px rgba(0,0,0,.14);max-height:200px;overflow-y:auto"></div>
            <div id="sa-item-name" style="font-size:.72rem;color:var(--muted);margin-top:3px;min-height:14px"></div>
          </div>
          <div class="field">
            <label>Date</label>
            <input id="sa-date" type="date" value="${todayIso()}" />
          </div>
        </div>

        <div class="form-grid" style="margin-bottom:14px">
          <div class="field">
            <label>Qty <span style="color:red">*</span></label>
            <input id="sa-qty" type="number" min="0.01" step="0.01" style="text-align:right;font-family:monospace" />
          </div>
          <div class="field">
            <label>Rate <span style="color:red">*</span></label>
            <input id="sa-rate" type="number" min="0" step="0.01" value="0" style="text-align:right;font-family:monospace" />
          </div>
          <div class="field">
            <label>Reason <span style="color:red">*</span></label>
            <select id="sa-reason" class="at-select">
              <option value="LOST">Lost</option>
              <option value="DAMAGED">Damaged</option>
            </select>
          </div>
        </div>

        <div class="form-grid" style="margin-bottom:14px">
          <div class="field" style="position:relative">
            <label>Expense Account <span style="color:red">*</span></label>
            <input id="sa-exp-in" type="text" placeholder="code or name" autocomplete="off" />
            <div id="sa-exp-drop" hidden style="position:absolute;top:100%;left:0;right:0;z-index:200;
              background:var(--surface);border:1px solid var(--border);border-radius:5px;
              box-shadow:0 4px 14px rgba(0,0,0,.14);max-height:200px;overflow-y:auto"></div>
          </div>
          <div class="field" style="position:relative">
            <label>Inventory Account <span style="color:red">*</span></label>
            <input id="sa-inv-in" type="text" placeholder="code or name" autocomplete="off" />
            <div id="sa-inv-drop" hidden style="position:absolute;top:100%;left:0;right:0;z-index:200;
              background:var(--surface);border:1px solid var(--border);border-radius:5px;
              box-shadow:0 4px 14px rgba(0,0,0,.14);max-height:200px;overflow-y:auto"></div>
          </div>
        </div>

        <div class="field" style="margin-bottom:18px">
          <label>Remarks</label>
          <input id="sa-remarks" type="text" maxlength="200" placeholder="optional" />
        </div>

        <div id="sa-form-err" hidden style="color:#DC2626;font-size:.8rem;margin-bottom:12px;padding:6px 8px;background:#FEF2F2;border-radius:5px"></div>
        <button type="submit" id="sa-save" class="btn btn-primary">Save Adjustment</button>
      </form>
    </div>` : ''}

    <div class="card" style="padding:20px 24px">
      <h3 style="margin:0 0 16px">Recent Adjustments</h3>
      <div style="overflow-x:auto">
        <table class="data-table" style="min-width:700px">
          <thead>
            <tr>
              <th>Adj No</th>
              <th>Date</th>
              <th>Item</th>
              <th style="text-align:right">Qty</th>
              <th style="text-align:right">Rate</th>
              <th style="text-align:right">Value</th>
              <th>Reason</th>
              <th style="text-align:center">Status</th>
            </tr>
          </thead>
          <tbody id="sa-body"><tr><td colspan="8" class="loading-msg">Loading…</td></tr></tbody>
        </table>
      </div>
    </div>
  `;

  if (_canEdit) {
    wireItemTypeahead(el);
    wireAcctTypeahead(el, 'sa-exp-in', 'sa-exp-drop');
    wireAcctTypeahead(el, 'sa-inv-in', 'sa-inv-drop');
    q(el, '#sa-form').addEventListener('submit', (e) => handleSave(e, el));
  }

  await loadList(el);
}

function wireItemTypeahead(el: HTMLElement): void {
  const input = q<HTMLInputElement>(el, '#sa-item-in');
  const drop  = q<HTMLElement>(el, '#sa-item-drop');
  const nameEl= q<HTMLElement>(el, '#sa-item-name');
  let timer: ReturnType<typeof setTimeout>;

  const search = async (term: string) => {
    try {
      const res = await lookupData('items', term);
      if (!res.rows.length) { drop.hidden = true; return; }
      drop.innerHTML = res.rows.map(r => `
        <div class="sa-idi" data-v="${escAttr(r.value)}" data-l="${escAttr(r.label)}"
          style="padding:6px 10px;cursor:pointer;font-size:.82rem;border-bottom:1px solid var(--border);
                 display:flex;gap:8px;align-items:center">
          <span style="font-family:monospace;font-weight:600;flex-shrink:0">${escHtml(r.value)}</span>
          <span style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.label)}</span>
        </div>`).join('');
      drop.hidden = false;
      drop.querySelectorAll<HTMLElement>('.sa-idi').forEach(item => {
        item.addEventListener('mouseenter', () => item.style.background = 'var(--border)');
        item.addEventListener('mouseleave', () => item.style.background = '');
        item.addEventListener('mousedown', () => {
          const code = item.dataset['v']!, name = item.dataset['l']!;
          input.value = code; nameEl.textContent = name;
          _selectedItem = { code, name };
          drop.hidden = true;
        });
      });
    } catch { drop.hidden = true; }
  };

  input.addEventListener('input', () => {
    _selectedItem = null;
    clearTimeout(timer); timer = setTimeout(() => search(input.value.trim()), 250);
  });
  input.addEventListener('focus', () => search(input.value.trim()));
  input.addEventListener('blur',  () => { setTimeout(() => { drop.hidden = true; }, 200); });
}

function wireAcctTypeahead(el: HTMLElement, inputId: string, dropId: string): void {
  const input = q<HTMLInputElement>(el, `#${inputId}`);
  const drop  = q<HTMLElement>(el, `#${dropId}`);
  let timer: ReturnType<typeof setTimeout>;

  const search = async (term: string) => {
    try {
      const res = await lookupData('accounts', term);
      if (!res.rows.length) { drop.hidden = true; return; }
      drop.innerHTML = res.rows.map(r => `
        <div class="${inputId}-di" data-v="${escAttr(r.value)}"
          style="padding:6px 10px;cursor:pointer;font-size:.82rem;border-bottom:1px solid var(--border);
                 display:flex;gap:8px;align-items:center">
          <span style="font-family:monospace;font-weight:600;flex-shrink:0">${escHtml(r.value)}</span>
          <span style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.label)}</span>
        </div>`).join('');
      drop.hidden = false;
      drop.querySelectorAll<HTMLElement>(`.${inputId}-di`).forEach(item => {
        item.addEventListener('mouseenter', () => item.style.background = 'var(--border)');
        item.addEventListener('mouseleave', () => item.style.background = '');
        item.addEventListener('mousedown', () => { input.value = item.dataset['v']!; drop.hidden = true; });
      });
    } catch { drop.hidden = true; }
  };

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => search(input.value.trim()), 250); });
  input.addEventListener('focus', () => search(input.value.trim()));
  input.addEventListener('blur',  () => { setTimeout(() => { drop.hidden = true; }, 200); });
}

async function handleSave(e: Event, el: HTMLElement): Promise<void> {
  e.preventDefault();
  const itemIn   = q<HTMLInputElement>(el, '#sa-item-in');
  const dateIn   = q<HTMLInputElement>(el, '#sa-date');
  const qtyIn    = q<HTMLInputElement>(el, '#sa-qty');
  const rateIn   = q<HTMLInputElement>(el, '#sa-rate');
  const reasonSel= q<HTMLSelectElement>(el, '#sa-reason');
  const expIn    = q<HTMLInputElement>(el, '#sa-exp-in');
  const invIn    = q<HTMLInputElement>(el, '#sa-inv-in');
  const remarksIn= q<HTMLInputElement>(el, '#sa-remarks');
  const errEl    = q<HTMLElement>(el, '#sa-form-err');
  const saveBtn  = q<HTMLButtonElement>(el, '#sa-save');

  errEl.hidden = true;

  const itemCode = _selectedItem?.code || itemIn.value.trim();
  if (!itemCode)              { errEl.textContent = 'Please select an item.'; errEl.hidden = false; return; }
  if (!qtyIn.value || Number(qtyIn.value) <= 0) { errEl.textContent = 'Qty must be greater than zero.'; errEl.hidden = false; return; }
  if (!expIn.value.trim())    { errEl.textContent = 'Expense account is required.'; errEl.hidden = false; return; }
  if (!invIn.value.trim())    { errEl.textContent = 'Inventory account is required.'; errEl.hidden = false; return; }

  saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
  try {
    const { p_tenant, p_caller } = ctx();
    const [result] = await rpc<{ id: number; adj_no: string }[]>('adj_save', {
      payload: {
        tenant: p_tenant, caller: p_caller,
        item_code: itemCode,
        qty: Number(qtyIn.value), rate: Number(rateIn.value) || 0,
        reason: reasonSel.value,
        expense_account_no: expIn.value.trim(),
        inventory_account_no: invIn.value.trim(),
        remarks: remarksIn.value.trim() || null,
        adj_date: dateIn.value || todayIso(),
      },
    });
    showAlert(el, `Saved as <strong>${result?.adj_no ?? 'adjustment'}</strong>`, 'success');
    itemIn.value = ''; qtyIn.value = ''; rateIn.value = '0'; remarksIn.value = '';
    expIn.value = ''; invIn.value = ''; q<HTMLElement>(el, '#sa-item-name').textContent = '';
    _selectedItem = null;
    await loadList(el);
  } catch (err) {
    errEl.textContent = err instanceof Error ? err.message : 'Save failed';
    errEl.hidden = false;
  } finally {
    saveBtn.disabled = false; saveBtn.textContent = 'Save Adjustment';
  }
}

async function loadList(el: HTMLElement): Promise<void> {
  const body = q<HTMLElement>(el, '#sa-body');
  try {
    const rows = await rpc<AdjRow[]>('adj_list', { ...ctx(), p_from: null, p_to: null });
    if (!rows?.length) { body.innerHTML = `<tr><td colspan="8" class="loading-msg">No adjustments recorded</td></tr>`; return; }
    body.innerHTML = rows.map(r => `
      <tr>
        <td style="font-family:monospace;font-weight:600;font-size:.85rem">${escHtml(r.adj_no)}</td>
        <td style="font-size:.85rem">${r.adj_date}<div style="font-size:.7rem;color:var(--muted)">${toBS(r.adj_date)}</div></td>
        <td>${escHtml(r.item_name)} <span style="color:var(--muted);font-size:.78rem">(${escHtml(r.item_code)})</span></td>
        <td style="text-align:right;font-family:monospace">${r.qty}</td>
        <td style="text-align:right;font-family:monospace">${fmt(r.rate)}</td>
        <td style="text-align:right;font-family:monospace;font-weight:700">${fmt(r.value)}</td>
        <td><span class="badge ${r.reason === 'LOST' ? 'badge-pending' : 'badge-approved'}">${r.reason.toLowerCase()}</span></td>
        <td style="text-align:center">${escHtml(r.status)}</td>
      </tr>
    `).join('');
  } catch (err) {
    body.innerHTML = `<tr><td colspan="8" class="loading-msg">Load failed: ${err instanceof Error ? err.message : err}</td></tr>`;
  }
}

function showAlert(el: HTMLElement, html: string, type: 'error' | 'success'): void {
  const a = el.querySelector<HTMLElement>('#sa-alert');
  if (!a) return;
  const styles = {
    error:   { bg: '#FEF2F2', color: '#991B1B', border: '#FECACA' },
    success: { bg: '#ECFDF5', color: '#065F46', border: '#A7F3D0' },
  };
  const s = styles[type];
  a.innerHTML = html;
  a.style.background = s.bg; a.style.color = s.color; a.style.borderColor = s.border;
  a.hidden = false;
  setTimeout(() => { a.hidden = true; }, 4000);
}
