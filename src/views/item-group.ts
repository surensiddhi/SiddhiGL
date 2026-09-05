/**
 * item-group.ts — Item Group master (CRUD).
 * Flat list with one optional parent level (not a full recursive tree like
 * account_type) — locked design decision for grouping items (e.g. Medicines,
 * Groceries, with an optional sub-group under a parent group).
 *
 * RPCs: item_group_list, item_group_save, item_group_set_active
 */

import { rpc } from '../lib/rpc';
import { ctx, roleLevel, getSession } from '../lib/session';
import { escHtml, escAttr } from '../lib/ui-helpers';

interface ItemGroup {
  code:         string;
  name:         string;
  parent_code:  string | null;
  parent_name:  string | null;
  active:       boolean;
}

let _rows:   ItemGroup[] = [];
let _canEdit = false;
let _filter: 'active' | 'inactive' | 'all' = 'active';
let _search  = '';
let _origCode: string | null = null;

export async function init(el: HTMLElement): Promise<void> {
  const s = getSession();
  _canEdit = !!s && roleLevel(s) >= 3; // manager+, matches item_group_save's server-side check
  _filter  = 'active';
  _search  = '';

  el.innerHTML = `
    <div class="page-header">
      <span class="page-title">Item Group</span>
      ${_canEdit ? `<button id="ig-add" class="btn btn-primary">+ Add Group</button>` : ''}
    </div>

    <div class="toolbar" style="gap:8px;margin-bottom:12px">
      <select id="ig-filter" class="at-select">
        <option value="active" selected>Active</option>
        <option value="all">All</option>
        <option value="inactive">Inactive</option>
      </select>
      <input id="ig-search" type="text" placeholder="Search code or name…"
        style="flex:1;max-width:260px;border:1px solid var(--border);border-radius:5px;
               padding:5px 10px;font-size:.875rem;background:var(--surface);color:var(--text)" />
    </div>

    <div id="ig-msg" hidden style="padding:8px 12px;border-radius:6px;margin-bottom:10px;font-size:.875rem"></div>

    <div style="display:flex;gap:16px;align-items:flex-start">

      <div style="flex:1;overflow-x:auto">
        <table class="data-table" style="font-size:.9rem">
          <thead>
            <tr>
              <th style="min-width:100px">Code</th>
              <th>Name</th>
              <th>Parent Group</th>
              <th style="text-align:center">Status</th>
              ${_canEdit ? `<th style="text-align:right;padding-right:12px">Actions</th>` : ''}
            </tr>
          </thead>
          <tbody id="ig-body">
            <tr><td colspan="5" class="loading-msg">Loading…</td></tr>
          </tbody>
        </table>
      </div>

      <div id="ig-panel" hidden style="
        width:300px;flex-shrink:0;background:var(--surface);
        border:1px solid var(--border);border-radius:8px;padding:20px;
        position:sticky;top:0;
      ">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <strong id="ig-panel-title" style="font-size:1rem">Add Group</strong>
          <button id="ig-panel-close" style="background:none;border:none;cursor:pointer;font-size:1.3rem;color:var(--muted);line-height:1">&times;</button>
        </div>
        <form id="ig-form">
          <div class="field" style="margin-bottom:12px">
            <label>Code <span style="color:red">*</span></label>
            <input id="ig-code" type="text" required maxlength="20" placeholder="e.g. MED" style="text-transform:uppercase" />
            <div id="ig-code-note" hidden style="font-size:.72rem;color:var(--muted);margin-top:3px">Code is fixed once created</div>
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>Name <span style="color:red">*</span></label>
            <input id="ig-name" type="text" required maxlength="80" />
          </div>
          <div class="field" style="margin-bottom:14px">
            <label>Parent Group (optional)</label>
            <select id="ig-parent">
              <option value="">— none (top level) —</option>
            </select>
          </div>
          <div style="margin-bottom:16px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input id="ig-active" type="checkbox" checked />
              <span style="font-size:.875rem">Active</span>
            </label>
          </div>
          <div id="ig-form-err" hidden style="color:#DC2626;font-size:.8rem;margin-bottom:10px;padding:6px 8px;background:#FEF2F2;border-radius:5px"></div>
          <div style="display:flex;gap:8px">
            <button type="button" id="ig-cancel" class="btn btn-secondary" style="flex:1">Cancel</button>
            <button type="submit" id="ig-save"   class="btn btn-primary"   style="flex:1">Save</button>
          </div>
        </form>
      </div>

    </div>
  `;

  el.querySelector('#ig-filter')?.addEventListener('change', e => {
    _filter = (e.target as HTMLSelectElement).value as typeof _filter;
    renderTable(el);
  });
  el.querySelector<HTMLInputElement>('#ig-search')?.addEventListener('input', e => {
    _search = (e.target as HTMLInputElement).value.trim().toLowerCase();
    renderTable(el);
  });

  el.querySelector('#ig-add')?.addEventListener('click',         () => openPanel(el, null));
  el.querySelector('#ig-panel-close')?.addEventListener('click', () => closePanel(el));
  el.querySelector('#ig-cancel')?.addEventListener('click',      () => closePanel(el));
  el.querySelector('#ig-form')?.addEventListener('submit',       (e) => handleSave(e, el));

  el.querySelector<HTMLInputElement>('#ig-code')?.addEventListener('input', e => {
    const inp = e.target as HTMLInputElement;
    const pos = inp.selectionStart ?? inp.value.length;
    inp.value = inp.value.toUpperCase();
    inp.setSelectionRange(pos, pos);
  });

  await loadList(el);
}

async function loadList(el: HTMLElement): Promise<void> {
  try {
    const rows = await rpc<ItemGroup[]>('item_group_list', { ...ctx(), p_include_inactive: true });
    _rows = Array.isArray(rows) ? rows : [];
    renderTable(el);
    populateParentSelect(el);
  } catch (err) {
    showMsg(el, `Load failed: ${err instanceof Error ? err.message : err}`, 'error');
  }
}

function filtered(): ItemGroup[] {
  return _rows.filter(r => {
    const statusOk = _filter === 'all' ? true : _filter === 'active' ? r.active : !r.active;
    const searchOk = !_search ||
      r.code.toLowerCase().includes(_search) || r.name.toLowerCase().includes(_search);
    return statusOk && searchOk;
  });
}

function renderTable(el: HTMLElement): void {
  const body = el.querySelector<HTMLElement>('#ig-body')!;
  const rows = filtered();

  if (!_rows.length) { body.innerHTML = `<tr><td colspan="5" class="loading-msg">No item groups found</td></tr>`; return; }
  if (!rows.length)  { body.innerHTML = `<tr><td colspan="5" class="loading-msg">No records match the filter</td></tr>`; return; }

  body.innerHTML = rows.map(r => `
    <tr style="${!r.active ? 'opacity:.55' : ''}">
      <td style="font-family:monospace;font-weight:600;font-size:.88rem">${escHtml(r.code)}</td>
      <td>${escHtml(r.name)}</td>
      <td style="font-size:.82rem;color:var(--muted)">${escHtml(r.parent_name ?? '—')}</td>
      <td style="text-align:center">
        ${r.active ? `<span class="badge badge-approved">active</span>` : `<span class="badge badge-pending">inactive</span>`}
      </td>
      ${_canEdit ? `
      <td style="text-align:right;white-space:nowrap;padding-right:8px">
        <button class="ig-edit btn btn-secondary" data-code="${escAttr(r.code)}" style="font-size:.75rem;padding:3px 8px;margin-right:4px">Edit</button>
        <button class="ig-toggle btn ${r.active ? 'btn-secondary' : 'btn-primary'}" data-code="${escAttr(r.code)}" data-active="${r.active}"
          style="font-size:.75rem;padding:3px 8px">${r.active ? 'Deactivate' : 'Activate'}</button>
      </td>` : ''}
    </tr>
  `).join('');

  body.querySelectorAll<HTMLElement>('.ig-edit').forEach(btn =>
    btn.addEventListener('click', () => openPanel(el, btn.dataset['code']!)));
  body.querySelectorAll<HTMLElement>('.ig-toggle').forEach(btn =>
    btn.addEventListener('click', () => handleToggle(el, btn.dataset['code']!, btn.dataset['active'] === 'true')));
}

function populateParentSelect(el: HTMLElement, excludeCode?: string, current?: string): void {
  const sel = el.querySelector<HTMLSelectElement>('#ig-parent');
  if (!sel) return;
  const cur = current ?? sel.value;
  sel.innerHTML = `<option value="">— none (top level) —</option>` +
    _rows.filter(g => g.code !== excludeCode).map(g =>
      `<option value="${escAttr(g.code)}">${escHtml(g.code)} — ${escHtml(g.name)}</option>`
    ).join('');
  sel.value = cur ?? '';
}

// ── panel ─────────────────────────────────────────────────────────────────────

function openPanel(el: HTMLElement, code: string | null): void {
  const panel    = el.querySelector<HTMLElement>('#ig-panel')!;
  const titleEl  = el.querySelector<HTMLElement>('#ig-panel-title')!;
  const codeIn   = el.querySelector<HTMLInputElement>('#ig-code')!;
  const codeNote = el.querySelector<HTMLElement>('#ig-code-note')!;
  const nameIn   = el.querySelector<HTMLInputElement>('#ig-name')!;
  const activeChk= el.querySelector<HTMLInputElement>('#ig-active')!;
  const errEl    = el.querySelector<HTMLElement>('#ig-form-err')!;

  errEl.hidden = true;
  _origCode = code;

  if (code) {
    const row = _rows.find(r => r.code === code);
    if (!row) return;
    titleEl.textContent      = 'Edit Item Group';
    codeIn.value             = row.code;
    codeIn.readOnly          = true;
    codeIn.style.background  = 'var(--bg)';
    codeNote.hidden          = false;
    nameIn.value             = row.name;
    activeChk.checked        = row.active;
    populateParentSelect(el, row.code, row.parent_code ?? '');
  } else {
    titleEl.textContent      = 'Add Item Group';
    codeIn.value             = '';
    codeIn.readOnly          = false;
    codeIn.style.background  = '';
    codeNote.hidden          = true;
    nameIn.value             = '';
    activeChk.checked        = true;
    populateParentSelect(el, undefined, '');
  }

  panel.hidden = false;
  (code ? nameIn : codeIn).focus();
}

function closePanel(el: HTMLElement): void {
  el.querySelector<HTMLElement>('#ig-panel')!.hidden = true;
}

// ── save / toggle ─────────────────────────────────────────────────────────────

async function handleSave(e: Event, el: HTMLElement): Promise<void> {
  e.preventDefault();
  const codeIn   = el.querySelector<HTMLInputElement>('#ig-code')!;
  const nameIn   = el.querySelector<HTMLInputElement>('#ig-name')!;
  const parentSel= el.querySelector<HTMLSelectElement>('#ig-parent')!;
  const activeChk= el.querySelector<HTMLInputElement>('#ig-active')!;
  const errEl    = el.querySelector<HTMLElement>('#ig-form-err')!;
  const saveBtn  = el.querySelector<HTMLButtonElement>('#ig-save')!;

  errEl.hidden = true;
  saveBtn.disabled = true; saveBtn.textContent = 'Saving…';

  try {
    await rpc('item_group_save', {
      ...ctx(),
      p_code:        codeIn.value.trim().toUpperCase(),
      p_name:        nameIn.value.trim(),
      p_parent_code: parentSel.value || null,
      p_active:      activeChk.checked,
      p_orig_code:   _origCode,
    });
    closePanel(el);
    showMsg(el, 'Item group saved', 'success');
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
  if (!confirm(`${action} item group "${code}"?`)) return;
  try {
    await rpc('item_group_set_active', { ...ctx(), p_code: code, p_active: !currentlyActive });
    showMsg(el, `${action}d ${code}`, 'success');
    await loadList(el);
  } catch (err) {
    showMsg(el, `Failed: ${err instanceof Error ? err.message : err}`, 'error');
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function showMsg(el: HTMLElement, text: string, type: 'success' | 'error'): void {
  const msg = el.querySelector<HTMLElement>('#ig-msg');
  if (!msg) return;
  msg.textContent = text;
  msg.style.background = type === 'success' ? '#ECFDF5' : '#FEF2F2';
  msg.style.color      = type === 'success' ? '#059669' : '#DC2626';
  msg.style.border     = `1px solid ${type === 'success' ? '#A7F3D0' : '#FECACA'}`;
  msg.hidden = false;
  setTimeout(() => { msg.hidden = true; }, 3500);
}
