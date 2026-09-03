/**
 * account-type.ts — Account Type master (CRUD).
 * Functions: list_account_types, save_account_type, delete_account_type, next_type_code
 */

import { rpc } from '../lib/rpc';
import { ctx, roleLevel, getSession } from '../lib/session';

interface AccType {
  acc_type:      string;
  acc_type_desc: string;
  acc_class:     string;
  bal_type:      string;
  parent_code:   string | null;
  tran_level:    boolean;
  acc_group:     string | null;
  active:        boolean;
  depth:         number;
  has_children:  boolean;
}

const CLASS_LABEL: Record<string, string> = {
  A: 'Asset', L: 'Liability', E: 'Equity', I: 'Income', X: 'Expense',
};
const CLASS_COLOR: Record<string, string> = {
  A: '#0284C7', L: '#DC2626', E: '#059669', I: '#7C3AED', X: '#D97706',
};

let _rows: AccType[] = [];
let _editCode: string | null = null;   // null = new
let _canEdit    = false;
let _filter: 'all' | 'active' | 'inactive' = 'all';
let _collapsed  = new Set<string>();   // collapsed parent codes

// ---------- public entry point ----------

export async function init(el: HTMLElement): Promise<void> {
  const s = getSession();
  _canEdit   = !!s && roleLevel(s) >= 2;
  _filter    = 'all';
  _collapsed = new Set();

  el.innerHTML = `
    <div class="page-header">
      <span class="page-title">Account Type</span>
      ${_canEdit ? `<button id="at-add" class="btn btn-primary">+ Add Root</button>` : ''}
    </div>

    <!-- Toolbar: filter + expand/collapse -->
    <div class="toolbar" style="gap:8px;margin-bottom:12px">
      <select id="at-filter" class="at-select">
        <option value="all">All</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </select>
      <button id="at-expand-all"   class="btn btn-secondary" style="font-size:.8rem;padding:5px 10px">Expand All</button>
      <button id="at-collapse-all" class="btn btn-secondary" style="font-size:.8rem;padding:5px 10px">Collapse All</button>
    </div>

    <div id="at-msg" hidden style="padding:8px 12px;border-radius:6px;margin-bottom:10px;font-size:.875rem"></div>

    <div style="display:flex;gap:16px;align-items:flex-start">

      <!-- Table -->
      <div style="flex:1;overflow-x:auto">
        <table class="data-table" id="at-table" style="font-size:.9rem">
          <thead>
            <tr>
              <th style="min-width:160px">Code / Description</th>
              <th>Class</th>
              <th style="text-align:center">Bal</th>
              <th style="text-align:center">Posting</th>
              <th>Group</th>
              <th style="text-align:center">Active</th>
              ${_canEdit ? `<th style="text-align:right;padding-right:12px">Actions</th>` : ''}
            </tr>
          </thead>
          <tbody id="at-body">
            <tr><td colspan="7" class="loading-msg">Loading…</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Edit Panel (hidden by default) -->
      <div id="at-panel" hidden style="
        width:300px;flex-shrink:0;background:var(--surface);
        border:1px solid var(--border);border-radius:8px;padding:20px;
        position:sticky;top:0;
      ">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <strong id="at-panel-title" style="font-size:1rem">Add Account Type</strong>
          <button id="at-panel-close" style="background:none;border:none;cursor:pointer;font-size:1.3rem;color:var(--muted);line-height:1">&times;</button>
        </div>
        <form id="at-form">
          <div class="field" style="margin-bottom:12px">
            <label>Type Code <span style="color:red">*</span></label>
            <input id="at-code" type="text" required maxlength="20" placeholder="auto-suggested" />
            <div id="at-code-note" hidden style="font-size:.72rem;color:var(--muted);margin-top:3px">Code is fixed once created</div>
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>Description <span style="color:red">*</span></label>
            <input id="at-desc" type="text" required maxlength="80" />
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>Parent Type</label>
            <select id="at-parent"></select>
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>Class</label>
            <div id="at-class-display" style="
              padding:7px 10px;border:1px solid var(--border);border-radius:5px;
              font-size:.875rem;color:var(--muted);background:var(--bg);
            ">Inherited from parent</div>
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>Account Group</label>
            <input id="at-group" type="text" maxlength="20" placeholder="e.g. CASH, BANK" />
          </div>
          <div style="margin-bottom:16px">
            <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer">
              <input id="at-tran" type="checkbox" checked style="margin-top:3px" />
              <span style="font-size:.875rem;line-height:1.4">
                Posting level<br>
                <span style="font-size:.75rem;color:var(--muted)">Accounts can be created under it</span>
              </span>
            </label>
          </div>
          <div style="margin-bottom:16px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input id="at-active" type="checkbox" checked />
              <span style="font-size:.875rem">Active</span>
            </label>
          </div>
          <div id="at-form-err" hidden style="color:#DC2626;font-size:.8rem;margin-bottom:10px;padding:6px 8px;background:#FEF2F2;border-radius:5px"></div>
          <div style="display:flex;gap:8px">
            <button type="button" id="at-cancel" class="btn btn-secondary" style="flex:1">Cancel</button>
            <button type="submit" id="at-save"   class="btn btn-primary"   style="flex:1">Save Type</button>
          </div>
        </form>
      </div>

    </div>
  `;

  // Wire toolbar
  el.querySelector('#at-filter')?.addEventListener('change', e => {
    _filter = (e.target as HTMLSelectElement).value as typeof _filter;
    renderTable(el);
  });
  el.querySelector('#at-expand-all')?.addEventListener('click',  () => { _collapsed.clear();              renderTable(el); });
  el.querySelector('#at-collapse-all')?.addEventListener('click', () => { _rows.filter(r => r.has_children).forEach(r => _collapsed.add(r.acc_type)); renderTable(el); });

  // Wire panel
  el.querySelector('#at-add')?.addEventListener('click',        () => openPanel(el, null, null));
  el.querySelector('#at-panel-close')?.addEventListener('click', () => closePanel(el));
  el.querySelector('#at-cancel')?.addEventListener('click',      () => closePanel(el));
  el.querySelector('#at-form')?.addEventListener('submit',       (e) => handleSave(e, el));

  // Auto-suggest code when parent changes
  el.querySelector<HTMLSelectElement>('#at-parent')?.addEventListener('change', async () => {
    if (_editCode !== null) return;
    const parent = el.querySelector<HTMLSelectElement>('#at-parent')!.value || null;
    updateClassDisplay(el, parent);
    try {
      const code = await rpc<string>('next_type_code', { ...ctx(), p_parent: parent });
      el.querySelector<HTMLInputElement>('#at-code')!.value = Array.isArray(code) ? code[0] : code;
    } catch { /* ignore */ }
  });

  await loadList(el);
}

// ---------- data ----------

async function loadList(el: HTMLElement): Promise<void> {
  try {
    const rows = await rpc<AccType[]>('list_account_types', { ...ctx(), p_status: 'all' });
    _rows = Array.isArray(rows) ? rows : [];
    renderTable(el);
    populateParentSelect(el);
  } catch (err) {
    showMsg(el, `Load failed: ${err instanceof Error ? err.message : err}`, 'error');
  }
}

// ---------- render ----------

function visibleRows(): AccType[] {
  const statusOk = (r: AccType) =>
    _filter === 'all' ? true : _filter === 'active' ? r.active : !r.active;

  // Build set of hidden codes (ancestor collapsed)
  const hidden = new Set<string>();
  for (const r of _rows) {
    if (_collapsed.has(r.acc_type)) {
      // mark all descendants hidden
      markDescendantsHidden(r.acc_type, hidden);
    }
  }

  return _rows.filter(r => statusOk(r) && !hidden.has(r.acc_type));
}

function markDescendantsHidden(parentCode: string, hidden: Set<string>): void {
  for (const r of _rows) {
    if (r.parent_code === parentCode) {
      hidden.add(r.acc_type);
      markDescendantsHidden(r.acc_type, hidden);
    }
  }
}

function renderTable(el: HTMLElement): void {
  const body = el.querySelector<HTMLElement>('#at-body')!;
  const rows = visibleRows();

  if (!_rows.length) {
    body.innerHTML = `<tr><td colspan="7" class="loading-msg">No account types found</td></tr>`;
    return;
  }
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7" class="loading-msg">No records match the filter</td></tr>`;
    return;
  }

  body.innerHTML = rows.map(r => {
    const indent    = r.depth * 18;
    const color     = CLASS_COLOR[r.acc_class] ?? '#78716C';
    const isCollapsed = _collapsed.has(r.acc_type);
    const toggleBtn = r.has_children
      ? `<button class="at-toggle btn-icon" data-code="${r.acc_type}" title="${isCollapsed ? 'Expand' : 'Collapse'}" style="margin-right:2px;font-size:.7rem">${isCollapsed ? '▸' : '▾'}</button>`
      : `<span style="display:inline-block;width:18px"></span>`;

    return `
      <tr data-code="${r.acc_type}" style="${!r.active ? 'opacity:.55' : ''}">
        <td style="padding-left:${8 + indent}px;white-space:nowrap">
          <div style="display:flex;align-items:center;gap:4px">
            ${toggleBtn}
            <span style="font-family:monospace;font-size:.85rem;color:var(--muted)">${r.acc_type}</span>
            <span style="font-size:.9rem">${r.acc_type_desc}</span>
            ${r.tran_level ? `<span class="badge badge-posted" style="font-size:.65rem;padding:1px 6px">posting</span>` : ''}
          </div>
        </td>
        <td><span style="font-size:.78rem;font-weight:600;color:${color}">${CLASS_LABEL[r.acc_class] ?? r.acc_class}</span></td>
        <td style="text-align:center;font-size:.78rem;color:var(--muted)">${r.bal_type === 'D' ? 'Dr' : 'Cr'}</td>
        <td style="text-align:center">${r.tran_level ? '✓' : ''}</td>
        <td style="font-size:.78rem">${r.acc_group ?? ''}</td>
        <td style="text-align:center">${r.active ? '✓' : '<span style="color:var(--muted)">—</span>'}</td>
        ${_canEdit ? `
        <td style="text-align:right;white-space:nowrap;padding-right:8px">
          <button class="at-child btn btn-secondary" data-code="${r.acc_type}" style="font-size:.75rem;padding:3px 8px;margin-right:2px">+ Child</button>
          <button class="at-edit  btn btn-secondary" data-code="${r.acc_type}" style="font-size:.75rem;padding:3px 8px;margin-right:2px">Edit</button>
          ${!r.has_children ? `<button class="at-del btn btn-danger" data-code="${r.acc_type}" style="font-size:.75rem;padding:3px 8px">Delete</button>` : ''}
        </td>` : ''}
      </tr>
    `;
  }).join('');

  // Bind row actions
  body.querySelectorAll<HTMLElement>('.at-toggle').forEach(btn =>
    btn.addEventListener('click', () => {
      const code = btn.dataset['code']!;
      if (_collapsed.has(code)) _collapsed.delete(code); else _collapsed.add(code);
      renderTable(el);
    })
  );
  body.querySelectorAll<HTMLElement>('.at-child').forEach(btn =>
    btn.addEventListener('click', () => openPanel(el, null, btn.dataset['code']!))
  );
  body.querySelectorAll<HTMLElement>('.at-edit').forEach(btn =>
    btn.addEventListener('click', () => openPanel(el, btn.dataset['code']!, null))
  );
  body.querySelectorAll<HTMLElement>('.at-del').forEach(btn =>
    btn.addEventListener('click', () => handleDelete(el, btn.dataset['code']!))
  );
}

function populateParentSelect(el: HTMLElement, exclude?: string): void {
  const sel = el.querySelector<HTMLSelectElement>('#at-parent')!;
  const cur = sel.value;
  sel.innerHTML = `<option value="">(none — root level)</option>` +
    _rows
      .filter(r => r.acc_type !== exclude)
      .map(r => {
        const pad = ' '.repeat(r.depth * 3);
        return `<option value="${r.acc_type}">${pad}${r.acc_type} — ${r.acc_type_desc}</option>`;
      }).join('');
  sel.value = cur;
}

// ---------- panel ----------

function updateClassDisplay(el: HTMLElement, parentCode: string | null): void {
  const display = el.querySelector<HTMLElement>('#at-class-display')!;
  if (!parentCode) {
    display.textContent = 'Inherited from parent';
    display.style.color = 'var(--muted)';
    return;
  }
  const parent = _rows.find(r => r.acc_type === parentCode);
  if (parent) {
    const label = CLASS_LABEL[parent.acc_class] ?? parent.acc_class;
    const color = CLASS_COLOR[parent.acc_class] ?? '#78716C';
    display.innerHTML = `<span style="font-weight:600;color:${color}">${label}</span> <span style="font-size:.75rem;color:var(--muted)">(inherited, not editable)</span>`;
  } else {
    display.textContent = 'Inherited from parent';
    display.style.color = 'var(--muted)';
  }
}

function openPanel(el: HTMLElement, code: string | null, forceParent: string | null): void {
  const panel      = el.querySelector<HTMLElement>('#at-panel')!;
  const titleEl    = el.querySelector<HTMLElement>('#at-panel-title')!;
  const codeInput  = el.querySelector<HTMLInputElement>('#at-code')!;
  const codeNote   = el.querySelector<HTMLElement>('#at-code-note')!;
  const descInput  = el.querySelector<HTMLInputElement>('#at-desc')!;
  const parentSel  = el.querySelector<HTMLSelectElement>('#at-parent')!;
  const groupInput = el.querySelector<HTMLInputElement>('#at-group')!;
  const tranChk    = el.querySelector<HTMLInputElement>('#at-tran')!;
  const activeChk  = el.querySelector<HTMLInputElement>('#at-active')!;
  const errEl      = el.querySelector<HTMLElement>('#at-form-err')!;

  errEl.hidden = true;
  _editCode = code;

  populateParentSelect(el, code ?? undefined);

  if (code) {
    // Edit mode
    const row = _rows.find(r => r.acc_type === code);
    if (!row) return;
    titleEl.textContent  = 'Edit Account Type';
    codeInput.value      = row.acc_type;
    codeInput.readOnly   = true;
    codeInput.style.background = 'var(--bg)';
    codeNote.hidden      = false;
    descInput.value      = row.acc_type_desc;
    parentSel.value      = row.parent_code ?? '';
    parentSel.disabled   = true;
    groupInput.value     = row.acc_group ?? '';
    tranChk.checked      = row.tran_level;
    activeChk.checked    = row.active;
    updateClassDisplay(el, row.parent_code);
  } else {
    // Add mode (possibly with pre-selected parent for + Child)
    titleEl.textContent  = forceParent ? '+ Add Child Type' : 'Add Account Type';
    codeInput.value      = '';
    codeInput.readOnly   = false;
    codeInput.style.background = '';
    codeNote.hidden      = true;
    descInput.value      = '';
    parentSel.value      = forceParent ?? '';
    parentSel.disabled   = false;
    groupInput.value     = '';
    tranChk.checked      = true;
    activeChk.checked    = true;
    updateClassDisplay(el, forceParent);

    // Auto-suggest code for the pre-selected parent
    if (forceParent) {
      rpc<string>('next_type_code', { ...ctx(), p_parent: forceParent })
        .then(code => {
          const v = Array.isArray(code) ? code[0] : code;
          (el.querySelector<HTMLInputElement>('#at-code')!).value = v;
        })
        .catch(() => {/* ignore */});
    }
  }

  panel.hidden = false;
  descInput.focus();
}

function closePanel(el: HTMLElement): void {
  el.querySelector<HTMLElement>('#at-panel')!.hidden = true;
  _editCode = null;
}

// ---------- save / delete ----------

async function handleSave(e: Event, el: HTMLElement): Promise<void> {
  e.preventDefault();
  const codeInput  = el.querySelector<HTMLInputElement>('#at-code')!;
  const descInput  = el.querySelector<HTMLInputElement>('#at-desc')!;
  const parentSel  = el.querySelector<HTMLSelectElement>('#at-parent')!;
  const groupInput = el.querySelector<HTMLInputElement>('#at-group')!;
  const tranChk    = el.querySelector<HTMLInputElement>('#at-tran')!;
  const activeChk  = el.querySelector<HTMLInputElement>('#at-active')!;
  const errEl      = el.querySelector<HTMLElement>('#at-form-err')!;
  const saveBtn    = el.querySelector<HTMLButtonElement>('#at-save')!;

  errEl.hidden     = true;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  try {
    await rpc('save_account_type', {
      ...ctx(),
      p_acc_type:      codeInput.value.trim().toUpperCase(),
      p_acc_type_desc: descInput.value.trim(),
      p_parent:        parentSel.value || null,
      p_tran_level:    tranChk.checked,
      p_acc_group:     groupInput.value.trim().toUpperCase() || null,
      p_active:        activeChk.checked,
    });
    closePanel(el);
    showMsg(el, 'Saved successfully', 'success');
    await loadList(el);
  } catch (err) {
    errEl.textContent = err instanceof Error ? err.message : 'Save failed';
    errEl.hidden = false;
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Type';
  }
}

async function handleDelete(el: HTMLElement, code: string): Promise<void> {
  const row = _rows.find(r => r.acc_type === code);
  if (!confirm(`Delete "${code} — ${row?.acc_type_desc}"?\nThis cannot be undone.`)) return;
  try {
    await rpc('delete_account_type', { ...ctx(), p_acc_type: code });
    showMsg(el, `Deleted ${code}`, 'success');
    await loadList(el);
  } catch (err) {
    showMsg(el, `Delete failed: ${err instanceof Error ? err.message : err}`, 'error');
  }
}

// ---------- helpers ----------

function showMsg(el: HTMLElement, text: string, type: 'success' | 'error'): void {
  const msg = el.querySelector<HTMLElement>('#at-msg');
  if (!msg) return;
  msg.textContent      = text;
  msg.style.background = type === 'success' ? '#ECFDF5' : '#FEF2F2';
  msg.style.color      = type === 'success' ? '#059669' : '#DC2626';
  msg.style.border     = `1px solid ${type === 'success' ? '#A7F3D0' : '#FECACA'}`;
  msg.hidden = false;
  setTimeout(() => { msg.hidden = true; }, 3500);
}
