/**
 * item-master.ts — Item Master. Each item bundles a default rate + the
 * sales/purchase GL account it posts to, so Sales/Purchase bill lines can
 * pick an item and have description/rate/account fill in, or skip items
 * entirely and pick a GL account directly (same as a JV line).
 *
 * tracking_mode is the per-item hash-vs-tracked switch (locked design):
 * 'NONE' = hash/bucket item, no quantity ledger; 'QTY' = quantity tracked
 * in item_trans with weighted-average valuation. Chosen per item, not
 * globally, so both kinds can coexist.
 *
 * RPCs: item_list, item_save, item_set_active, item_group_list
 */

import { rpc } from '../lib/rpc';
import { ctx, roleLevel, getSession } from '../lib/session';
import { lookupData } from '../services/lookup';
import { escHtml, escAttr } from '../lib/ui-helpers';

interface Item {
  item_code:            string;
  item_name:            string;
  unit:                 string | null;
  sales_account_no:     string | null;
  purchase_account_no:  string | null;
  default_rate:         number;
  taxable:              boolean;
  active:               boolean;
  tracking_mode:        'NONE' | 'QTY';
  item_group_code:      string | null;
  item_group_name:      string | null;
}

interface ItemGroupOpt { code: string; name: string; }
let _groups: ItemGroupOpt[] = [];

let _rows:   Item[] = [];
let _canEdit = false;
let _filter: 'active' | 'inactive' | 'all' = 'active';
let _search  = '';

export async function init(el: HTMLElement): Promise<void> {
  const s = getSession();
  _canEdit = !!s && roleLevel(s) >= 3; // manager+, matches item_save's server-side check
  _filter  = 'active';
  _search  = '';

  el.innerHTML = `
    <div class="page-header">
      <span class="page-title">Item Master</span>
      ${_canEdit ? `<button id="im-add" class="btn btn-primary">+ Add Item</button>` : ''}
    </div>

    <div class="toolbar" style="gap:8px;margin-bottom:12px">
      <select id="im-filter" class="at-select">
        <option value="active" selected>Active</option>
        <option value="all">All</option>
        <option value="inactive">Inactive</option>
      </select>
      <input id="im-search" type="text" placeholder="Search code or name…"
        style="flex:1;max-width:260px;border:1px solid var(--border);border-radius:5px;
               padding:5px 10px;font-size:.875rem;background:var(--surface);color:var(--text)" />
    </div>

    <div id="im-msg" hidden style="padding:8px 12px;border-radius:6px;margin-bottom:10px;font-size:.875rem"></div>

    <div style="display:flex;gap:16px;align-items:flex-start">

      <div style="flex:1;overflow-x:auto">
        <table class="data-table" style="font-size:.9rem">
          <thead>
            <tr>
              <th style="min-width:100px">Code</th>
              <th>Name</th>
              <th>Unit</th>
              <th>Group</th>
              <th>Sales A/c</th>
              <th>Purchase A/c</th>
              <th style="text-align:right">Rate</th>
              <th style="text-align:center">VAT</th>
              <th style="text-align:center">Tracking</th>
              <th style="text-align:center">Status</th>
              ${_canEdit ? `<th style="text-align:right;padding-right:12px">Actions</th>` : ''}
            </tr>
          </thead>
          <tbody id="im-body">
            <tr><td colspan="11" class="loading-msg">Loading…</td></tr>
          </tbody>
        </table>
      </div>

      <div id="im-panel" hidden style="
        width:320px;flex-shrink:0;background:var(--surface);
        border:1px solid var(--border);border-radius:8px;padding:20px;
        position:sticky;top:0;
      ">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <strong id="im-panel-title" style="font-size:1rem">Add Item</strong>
          <button id="im-panel-close" style="background:none;border:none;cursor:pointer;font-size:1.3rem;color:var(--muted);line-height:1">&times;</button>
        </div>
        <form id="im-form">
          <div class="field" style="margin-bottom:12px">
            <label>Code <span style="color:red">*</span></label>
            <input id="im-code" type="text" required maxlength="30" placeholder="e.g. ITM001" />
            <div id="im-code-note" hidden style="font-size:.72rem;color:var(--muted);margin-top:3px">Code is fixed once created</div>
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>Name <span style="color:red">*</span></label>
            <input id="im-name" type="text" required maxlength="120" />
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>Unit</label>
            <input id="im-unit" type="text" maxlength="20" placeholder="pcs, kg, hr… (optional)" />
          </div>
          <div class="field" style="margin-bottom:12px;position:relative">
            <label>Sales Account</label>
            <input id="im-sales-acct" type="text" placeholder="code or name" autocomplete="off" />
            <div id="im-sales-drop" hidden style="position:absolute;top:100%;left:0;right:0;z-index:200;
              background:var(--surface);border:1px solid var(--border);border-radius:5px;
              box-shadow:0 4px 14px rgba(0,0,0,.14);max-height:180px;overflow-y:auto"></div>
          </div>
          <div class="field" style="margin-bottom:12px;position:relative">
            <label>Purchase Account</label>
            <input id="im-purch-acct" type="text" placeholder="code or name" autocomplete="off" />
            <div id="im-purch-drop" hidden style="position:absolute;top:100%;left:0;right:0;z-index:200;
              background:var(--surface);border:1px solid var(--border);border-radius:5px;
              box-shadow:0 4px 14px rgba(0,0,0,.14);max-height:180px;overflow-y:auto"></div>
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>Default Rate</label>
            <input id="im-rate" type="number" min="0" step="0.01" value="0" style="text-align:right;font-family:monospace" />
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>Item Group</label>
            <select id="im-group">
              <option value="">— none —</option>
            </select>
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>Tracking</label>
            <select id="im-tracking">
              <option value="QTY">Quantity tracked (stock ledger + expiry/batch)</option>
              <option value="NONE">Hash / bucket (no quantity ledger)</option>
            </select>
          </div>
          <div style="margin-bottom:10px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input id="im-taxable" type="checkbox" checked />
              <span style="font-size:.875rem">Taxable (VAT applies on bills)</span>
            </label>
          </div>
          <div style="margin-bottom:16px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input id="im-active" type="checkbox" checked />
              <span style="font-size:.875rem">Active</span>
            </label>
          </div>
          <div id="im-form-err" hidden style="color:#DC2626;font-size:.8rem;margin-bottom:10px;padding:6px 8px;background:#FEF2F2;border-radius:5px"></div>
          <div style="display:flex;gap:8px">
            <button type="button" id="im-cancel" class="btn btn-secondary" style="flex:1">Cancel</button>
            <button type="submit" id="im-save"   class="btn btn-primary"   style="flex:1">Save</button>
          </div>
        </form>
      </div>

    </div>
  `;

  el.querySelector('#im-filter')?.addEventListener('change', e => {
    _filter = (e.target as HTMLSelectElement).value as typeof _filter;
    renderTable(el);
  });
  el.querySelector<HTMLInputElement>('#im-search')?.addEventListener('input', e => {
    _search = (e.target as HTMLInputElement).value.trim().toLowerCase();
    renderTable(el);
  });

  el.querySelector('#im-add')?.addEventListener('click',         () => openPanel(el, null));
  el.querySelector('#im-panel-close')?.addEventListener('click', () => closePanel(el));
  el.querySelector('#im-cancel')?.addEventListener('click',      () => closePanel(el));
  el.querySelector('#im-form')?.addEventListener('submit',       (e) => handleSave(e, el));

  wireAcctTypeahead(el, 'sales');
  wireAcctTypeahead(el, 'purch');

  await loadList(el);
}

// ── data ─────────────────────────────────────────────────────────────────────

async function loadList(el: HTMLElement): Promise<void> {
  try {
    const [rows, groups] = await Promise.all([
      rpc<Item[]>('item_list', { ...ctx(), p_include_inactive: true }),
      rpc<ItemGroupOpt[]>('item_group_list', { ...ctx(), p_include_inactive: false }),
    ]);
    _rows   = Array.isArray(rows)   ? rows   : [];
    _groups = Array.isArray(groups) ? groups : [];
    populateGroupSelect(el);
    renderTable(el);
  } catch (err) {
    showMsg(el, `Load failed: ${err instanceof Error ? err.message : err}`, 'error');
  }
}

function populateGroupSelect(el: HTMLElement, current?: string): void {
  const sel = el.querySelector<HTMLSelectElement>('#im-group');
  if (!sel) return;
  const cur = current ?? sel.value;
  sel.innerHTML = `<option value="">— none —</option>` +
    _groups.map(g => `<option value="${escAttr(g.code)}">${escHtml(g.code)} — ${escHtml(g.name)}</option>`).join('');
  sel.value = cur ?? '';
}

function filtered(): Item[] {
  return _rows.filter(r => {
    const statusOk = _filter === 'all' ? true : _filter === 'active' ? r.active : !r.active;
    const searchOk = !_search ||
      r.item_code.toLowerCase().includes(_search) || r.item_name.toLowerCase().includes(_search);
    return statusOk && searchOk;
  });
}

function renderTable(el: HTMLElement): void {
  const body = el.querySelector<HTMLElement>('#im-body')!;
  const rows = filtered();

  if (!_rows.length) { body.innerHTML = `<tr><td colspan="11" class="loading-msg">No items found</td></tr>`; return; }
  if (!rows.length)  { body.innerHTML = `<tr><td colspan="11" class="loading-msg">No records match the filter</td></tr>`; return; }

  body.innerHTML = rows.map(r => `
    <tr style="${!r.active ? 'opacity:.55' : ''}">
      <td style="font-family:monospace;font-weight:600;font-size:.88rem">${escHtml(r.item_code)}</td>
      <td>${escHtml(r.item_name)}</td>
      <td>${escHtml(r.unit ?? '')}</td>
      <td style="font-size:.82rem;color:var(--muted)">${escHtml(r.item_group_name ?? '—')}</td>
      <td style="font-family:monospace;font-size:.82rem">${escHtml(r.sales_account_no ?? '—')}</td>
      <td style="font-family:monospace;font-size:.82rem">${escHtml(r.purchase_account_no ?? '—')}</td>
      <td style="text-align:right;font-family:monospace">${r.default_rate.toFixed(2)}</td>
      <td style="text-align:center">${r.taxable ? '✓' : '—'}</td>
      <td style="text-align:center;font-size:.75rem">${r.tracking_mode === 'QTY' ? 'Qty' : 'Hash'}</td>
      <td style="text-align:center">
        ${r.active ? `<span class="badge badge-approved">active</span>` : `<span class="badge badge-pending">inactive</span>`}
      </td>
      ${_canEdit ? `
      <td style="text-align:right;white-space:nowrap;padding-right:8px">
        <button class="im-edit btn btn-secondary" data-code="${escAttr(r.item_code)}" style="font-size:.75rem;padding:3px 8px;margin-right:4px">Edit</button>
        <button class="im-toggle btn ${r.active ? 'btn-secondary' : 'btn-primary'}" data-code="${escAttr(r.item_code)}" data-active="${r.active}"
          style="font-size:.75rem;padding:3px 8px">${r.active ? 'Deactivate' : 'Activate'}</button>
      </td>` : ''}
    </tr>
  `).join('');

  body.querySelectorAll<HTMLElement>('.im-edit').forEach(btn =>
    btn.addEventListener('click', () => openPanel(el, btn.dataset['code']!)));
  body.querySelectorAll<HTMLElement>('.im-toggle').forEach(btn =>
    btn.addEventListener('click', () => handleToggle(el, btn.dataset['code']!, btn.dataset['active'] === 'true')));
}

// ── panel ─────────────────────────────────────────────────────────────────────

let _origCode: string | null = null;

function openPanel(el: HTMLElement, code: string | null): void {
  const panel     = el.querySelector<HTMLElement>('#im-panel')!;
  const titleEl   = el.querySelector<HTMLElement>('#im-panel-title')!;
  const codeIn    = el.querySelector<HTMLInputElement>('#im-code')!;
  const codeNote  = el.querySelector<HTMLElement>('#im-code-note')!;
  const nameIn    = el.querySelector<HTMLInputElement>('#im-name')!;
  const unitIn    = el.querySelector<HTMLInputElement>('#im-unit')!;
  const salesIn   = el.querySelector<HTMLInputElement>('#im-sales-acct')!;
  const purchIn   = el.querySelector<HTMLInputElement>('#im-purch-acct')!;
  const rateIn    = el.querySelector<HTMLInputElement>('#im-rate')!;
  const trackSel  = el.querySelector<HTMLSelectElement>('#im-tracking')!;
  const taxChk    = el.querySelector<HTMLInputElement>('#im-taxable')!;
  const activeChk = el.querySelector<HTMLInputElement>('#im-active')!;
  const errEl     = el.querySelector<HTMLElement>('#im-form-err')!;

  errEl.hidden = true;
  _origCode = code;

  if (code) {
    const row = _rows.find(r => r.item_code === code);
    if (!row) return;
    titleEl.textContent = 'Edit Item';
    codeIn.value = row.item_code; codeNote.hidden = false;
    nameIn.value = row.item_name;
    unitIn.value = row.unit ?? '';
    salesIn.value = row.sales_account_no ?? '';
    purchIn.value = row.purchase_account_no ?? '';
    rateIn.value  = String(row.default_rate);
    taxChk.checked = row.taxable;
    activeChk.checked = row.active;
    populateGroupSelect(el, row.item_group_code ?? '');
    trackSel.value = row.tracking_mode ?? 'QTY';
  } else {
    titleEl.textContent = 'Add Item';
    codeIn.value = ''; codeNote.hidden = true;
    nameIn.value = ''; unitIn.value = ''; salesIn.value = ''; purchIn.value = '';
    rateIn.value = '0'; taxChk.checked = true; activeChk.checked = true;
    populateGroupSelect(el, '');
    trackSel.value = 'QTY';
  }

  panel.hidden = false;
  (code ? nameIn : codeIn).focus();
}

function closePanel(el: HTMLElement): void {
  el.querySelector<HTMLElement>('#im-panel')!.hidden = true;
}

// ── account typeahead (sales / purchase account fields) ───────────────────────

function wireAcctTypeahead(el: HTMLElement, which: 'sales' | 'purch'): void {
  const input = el.querySelector<HTMLInputElement>(`#im-${which}-acct`)!;
  const drop  = el.querySelector<HTMLElement>(`#im-${which}-drop`)!;
  let timer: ReturnType<typeof setTimeout>;

  const search = async (term: string) => {
    try {
      const res = await lookupData('accounts', term);
      if (!res.rows.length) { drop.hidden = true; return; }
      drop.innerHTML = res.rows.map(r => `
        <div class="im-di" data-v="${escAttr(r.value)}"
          style="padding:6px 10px;cursor:pointer;font-size:.82rem;border-bottom:1px solid var(--border);
                 display:flex;gap:8px;align-items:center">
          <span style="font-family:monospace;font-weight:600;flex-shrink:0">${escHtml(r.value)}</span>
          <span style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.label)}</span>
        </div>`).join('');
      drop.hidden = false;
      drop.querySelectorAll<HTMLElement>('.im-di').forEach(item => {
        item.addEventListener('mouseenter', () => item.style.background = 'var(--border)');
        item.addEventListener('mouseleave', () => item.style.background = '');
        item.addEventListener('mousedown', () => {
          input.value = item.dataset['v']!;
          drop.hidden = true;
        });
      });
    } catch { drop.hidden = true; }
  };

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => search(input.value.trim()), 250); });
  input.addEventListener('focus', () => search(input.value.trim()));
  input.addEventListener('blur',  () => { setTimeout(() => { drop.hidden = true; }, 200); });
}

// ── save / toggle ─────────────────────────────────────────────────────────────

async function handleSave(e: Event, el: HTMLElement): Promise<void> {
  e.preventDefault();
  const codeIn    = el.querySelector<HTMLInputElement>('#im-code')!;
  const nameIn    = el.querySelector<HTMLInputElement>('#im-name')!;
  const unitIn    = el.querySelector<HTMLInputElement>('#im-unit')!;
  const salesIn   = el.querySelector<HTMLInputElement>('#im-sales-acct')!;
  const purchIn   = el.querySelector<HTMLInputElement>('#im-purch-acct')!;
  const rateIn    = el.querySelector<HTMLInputElement>('#im-rate')!;
  const groupSel  = el.querySelector<HTMLSelectElement>('#im-group')!;
  const trackSel  = el.querySelector<HTMLSelectElement>('#im-tracking')!;
  const taxChk    = el.querySelector<HTMLInputElement>('#im-taxable')!;
  const activeChk = el.querySelector<HTMLInputElement>('#im-active')!;
  const errEl     = el.querySelector<HTMLElement>('#im-form-err')!;
  const saveBtn   = el.querySelector<HTMLButtonElement>('#im-save')!;

  errEl.hidden = true;
  saveBtn.disabled = true; saveBtn.textContent = 'Saving…';

  try {
    await rpc('item_save', {
      ...ctx(),
      p_item_code:            codeIn.value.trim(),
      p_item_name:            nameIn.value.trim(),
      p_unit:                 unitIn.value.trim() || null,
      p_sales_account_no:     salesIn.value.trim() || null,
      p_purchase_account_no:  purchIn.value.trim() || null,
      p_default_rate:         parseFloat(rateIn.value) || 0,
      p_taxable:              taxChk.checked,
      p_active:               activeChk.checked,
      p_tracking_mode:        trackSel.value,
      p_item_group_code:      groupSel.value || null,
      p_orig_code:            _origCode,
    });
    closePanel(el);
    showMsg(el, 'Item saved', 'success');
    await loadList(el);
  } catch (err) {
    errEl.textContent = err instanceof Error ? err.message : 'Save failed';
    errEl.hidden = false;
  } finally {
    saveBtn.disabled = false; saveBtn.textContent = 'Save';
  }
}

async function handleToggle(el: HTMLElement, code: string, currentlyActive: boolean): Promise<void> {
  const action = currentlyActive ? 'Deactivate' : 'Activate';
  if (!confirm(`${action} item "${code}"?`)) return;
  try {
    await rpc('item_set_active', { ...ctx(), p_item_code: code, p_active: !currentlyActive });
    showMsg(el, `${action}d ${code}`, 'success');
    await loadList(el);
  } catch (err) {
    showMsg(el, `Failed: ${err instanceof Error ? err.message : err}`, 'error');
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function showMsg(el: HTMLElement, text: string, type: 'success' | 'error'): void {
  const msg = el.querySelector<HTMLElement>('#im-msg');
  if (!msg) return;
  msg.textContent = text;
  msg.style.background = type === 'success' ? '#ECFDF5' : '#FEF2F2';
  msg.style.color      = type === 'success' ? '#059669' : '#DC2626';
  msg.style.border     = `1px solid ${type === 'success' ? '#A7F3D0' : '#FECACA'}`;
  msg.hidden = false;
  setTimeout(() => { msg.hidden = true; }, 3500);
}
