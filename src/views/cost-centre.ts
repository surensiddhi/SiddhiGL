/**
 * cost-centre.ts — Cost Centre master (CRUD).
 * RPCs: cc_list, cc_save, cc_set_active
 * No delete — deactivate only.
 *
 * Verified signatures:
 *   cc_list(p_include_inactive:bool, p_tenant, p_caller)
 *   cc_save(p_tenant, p_caller, p_code, p_name, p_active)
 *   cc_set_active(p_tenant, p_caller, p_code, p_active)
 */

import { rpc } from '../lib/rpc';
import { ctx, roleLevel, getSession } from '../lib/session';

interface CostCentre {
  code:   string;
  name:   string;
  active: boolean;
}

let _rows:    CostCentre[] = [];
let _canEdit  = false;
let _filter: 'active' | 'inactive' | 'all' = 'active';
let _search   = '';

// ── entry point ──────────────────────────────────────────────────────────────

export async function init(el: HTMLElement): Promise<void> {
  const s = getSession();
  _canEdit  = !!s && roleLevel(s) >= 2;
  _filter   = 'active';
  _search   = '';

  el.innerHTML = `
    <div class="page-header">
      <span class="page-title">Cost Centre</span>
      ${_canEdit ? `<button id="cc-add" class="btn btn-primary">+ Add</button>` : ''}
    </div>

    <div class="toolbar" style="gap:8px;margin-bottom:12px">
      <select id="cc-filter" class="at-select">
        <option value="active" selected>Active</option>
        <option value="all">All</option>
        <option value="inactive">Inactive</option>
      </select>
      <input id="cc-search" type="text" placeholder="Search code or name…"
        style="flex:1;max-width:260px;border:1px solid var(--border);border-radius:5px;
               padding:5px 10px;font-size:.875rem;background:var(--surface);color:var(--text)" />
    </div>

    <div id="cc-msg" hidden style="padding:8px 12px;border-radius:6px;margin-bottom:10px;font-size:.875rem"></div>

    <div style="display:flex;gap:16px;align-items:flex-start">

      <!-- Table -->
      <div style="flex:1;overflow-x:auto">
        <table class="data-table" style="font-size:.9rem">
          <thead>
            <tr>
              <th style="min-width:100px">Code</th>
              <th>Name</th>
              <th style="text-align:center">Status</th>
              ${_canEdit ? `<th style="text-align:right;padding-right:12px">Actions</th>` : ''}
            </tr>
          </thead>
          <tbody id="cc-body">
            <tr><td colspan="4" class="loading-msg">Loading…</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Edit Panel -->
      <div id="cc-panel" hidden style="
        width:280px;flex-shrink:0;background:var(--surface);
        border:1px solid var(--border);border-radius:8px;padding:20px;
        position:sticky;top:0;
      ">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <strong id="cc-panel-title" style="font-size:1rem">Add Cost Centre</strong>
          <button id="cc-panel-close" style="background:none;border:none;cursor:pointer;font-size:1.3rem;color:var(--muted);line-height:1">&times;</button>
        </div>
        <form id="cc-form">
          <div class="field" style="margin-bottom:12px">
            <label>Code <span style="color:red">*</span></label>
            <input id="cc-code" type="text" required maxlength="20"
              placeholder="e.g. HQ, BRANCH1"
              style="text-transform:uppercase" />
            <div id="cc-code-note" hidden style="font-size:.72rem;color:var(--muted);margin-top:3px">Code is fixed once created</div>
          </div>
          <div class="field" style="margin-bottom:14px">
            <label>Name <span style="color:red">*</span></label>
            <input id="cc-name" type="text" required maxlength="80" />
          </div>
          <div style="margin-bottom:16px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input id="cc-active" type="checkbox" checked />
              <span style="font-size:.875rem">Active</span>
            </label>
          </div>
          <div id="cc-form-err" hidden style="color:#DC2626;font-size:.8rem;margin-bottom:10px;padding:6px 8px;background:#FEF2F2;border-radius:5px"></div>
          <div style="display:flex;gap:8px">
            <button type="button" id="cc-cancel" class="btn btn-secondary" style="flex:1">Cancel</button>
            <button type="submit" id="cc-save"   class="btn btn-primary"   style="flex:1">Save</button>
          </div>
        </form>
      </div>

    </div>
  `;

  // Toolbar
  el.querySelector('#cc-filter')?.addEventListener('change', e => {
    _filter = (e.target as HTMLSelectElement).value as typeof _filter;
    renderTable(el);
  });
  el.querySelector<HTMLInputElement>('#cc-search')?.addEventListener('input', e => {
    _search = (e.target as HTMLInputElement).value.trim().toLowerCase();
    renderTable(el);
  });

  // Panel
  el.querySelector('#cc-add')?.addEventListener('click',        () => openPanel(el, null));
  el.querySelector('#cc-panel-close')?.addEventListener('click', () => closePanel(el));
  el.querySelector('#cc-cancel')?.addEventListener('click',      () => closePanel(el));
  el.querySelector('#cc-form')?.addEventListener('submit',       (e) => handleSave(e, el));

  // Auto-uppercase code
  el.querySelector<HTMLInputElement>('#cc-code')?.addEventListener('input', e => {
    const inp = e.target as HTMLInputElement;
    const pos = inp.selectionStart ?? inp.value.length;
    inp.value = inp.value.toUpperCase();
    inp.setSelectionRange(pos, pos);
  });

  await loadList(el);
}

// ── data ─────────────────────────────────────────────────────────────────────

async function loadList(el: HTMLElement): Promise<void> {
  try {
    const rows = await rpc<CostCentre[]>('cc_list', { ...ctx(), p_include_inactive: true });
    _rows = Array.isArray(rows) ? rows : [];
    renderTable(el);
  } catch (err) {
    showMsg(el, `Load failed: ${err instanceof Error ? err.message : err}`, 'error');
  }
}

// ── render ────────────────────────────────────────────────────────────────────

function filtered(): CostCentre[] {
  return _rows.filter(r => {
    const statusOk =
      _filter === 'all'    ? true :
      _filter === 'active' ? r.active : !r.active;
    const searchOk = !_search ||
      r.code.toLowerCase().includes(_search) ||
      r.name.toLowerCase().includes(_search);
    return statusOk && searchOk;
  });
}

function renderTable(el: HTMLElement): void {
  const body = el.querySelector<HTMLElement>('#cc-body')!;
  const rows = filtered();

  if (!_rows.length) {
    body.innerHTML = `<tr><td colspan="4" class="loading-msg">No cost centres found</td></tr>`;
    return;
  }
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="4" class="loading-msg">No records match the filter</td></tr>`;
    return;
  }

  body.innerHTML = rows.map(r => `
    <tr style="${!r.active ? 'opacity:.55' : ''}">
      <td style="font-family:monospace;font-weight:600;font-size:.88rem">${r.code}</td>
      <td>${r.name}</td>
      <td style="text-align:center">
        ${r.active
          ? `<span class="badge badge-approved">active</span>`
          : `<span class="badge badge-pending">inactive</span>`}
      </td>
      ${_canEdit ? `
      <td style="text-align:right;white-space:nowrap;padding-right:8px">
        <button class="cc-edit btn btn-secondary" data-code="${r.code}" style="font-size:.75rem;padding:3px 8px;margin-right:4px">Edit</button>
        <button class="cc-toggle btn ${r.active ? 'btn-secondary' : 'btn-primary'}" data-code="${r.code}" data-active="${r.active}"
          style="font-size:.75rem;padding:3px 8px">${r.active ? 'Deactivate' : 'Activate'}</button>
      </td>` : ''}
    </tr>
  `).join('');

  body.querySelectorAll<HTMLElement>('.cc-edit').forEach(btn =>
    btn.addEventListener('click', () => openPanel(el, btn.dataset['code']!))
  );
  body.querySelectorAll<HTMLElement>('.cc-toggle').forEach(btn =>
    btn.addEventListener('click', () => handleToggle(el, btn.dataset['code']!, btn.dataset['active'] === 'true'))
  );
}

// ── panel ─────────────────────────────────────────────────────────────────────

function openPanel(el: HTMLElement, code: string | null): void {
  const panel    = el.querySelector<HTMLElement>('#cc-panel')!;
  const titleEl  = el.querySelector<HTMLElement>('#cc-panel-title')!;
  const codeIn   = el.querySelector<HTMLInputElement>('#cc-code')!;
  const codeNote = el.querySelector<HTMLElement>('#cc-code-note')!;
  const nameIn   = el.querySelector<HTMLInputElement>('#cc-name')!;
  const activeChk= el.querySelector<HTMLInputElement>('#cc-active')!;
  const errEl    = el.querySelector<HTMLElement>('#cc-form-err')!;

  errEl.hidden = true;

  if (code) {
    const row = _rows.find(r => r.code === code);
    if (!row) return;
    titleEl.textContent      = 'Edit Cost Centre';
    codeIn.value             = row.code;
    codeIn.readOnly          = true;
    codeIn.style.background  = 'var(--bg)';
    codeNote.hidden          = false;
    nameIn.value             = row.name;
    activeChk.checked        = row.active;
  } else {
    titleEl.textContent      = 'Add Cost Centre';
    codeIn.value             = '';
    codeIn.readOnly          = false;
    codeIn.style.background  = '';
    codeNote.hidden          = true;
    nameIn.value             = '';
    activeChk.checked        = true;
  }

  panel.hidden = false;
  (code ? nameIn : codeIn).focus();
}

function closePanel(el: HTMLElement): void {
  el.querySelector<HTMLElement>('#cc-panel')!.hidden = true;
}

// ── save / toggle ─────────────────────────────────────────────────────────────

async function handleSave(e: Event, el: HTMLElement): Promise<void> {
  e.preventDefault();
  const codeIn   = el.querySelector<HTMLInputElement>('#cc-code')!;
  const nameIn   = el.querySelector<HTMLInputElement>('#cc-name')!;
  const activeChk= el.querySelector<HTMLInputElement>('#cc-active')!;
  const errEl    = el.querySelector<HTMLElement>('#cc-form-err')!;
  const saveBtn  = el.querySelector<HTMLButtonElement>('#cc-save')!;

  errEl.hidden     = true;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  try {
    await rpc('cc_save', {
      ...ctx(),
      p_code:   codeIn.value.trim().toUpperCase(),
      p_name:   nameIn.value.trim(),
      p_active: activeChk.checked,
    });
    closePanel(el);
    showMsg(el, 'Cost centre saved', 'success');
    await loadList(el);
  } catch (err) {
    errEl.textContent = err instanceof Error ? err.message : 'Save failed';
    errEl.hidden = false;
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
  }
}

async function handleToggle(el: HTMLElement, code: string, currentlyActive: boolean): Promise<void> {
  const action = currentlyActive ? 'Deactivate' : 'Activate';
  if (!confirm(`${action} cost centre "${code}"?`)) return;
  try {
    await rpc('cc_set_active', { ...ctx(), p_code: code, p_active: !currentlyActive });
    showMsg(el, `${action}d ${code}`, 'success');
    await loadList(el);
  } catch (err) {
    showMsg(el, `Failed: ${err instanceof Error ? err.message : err}`, 'error');
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function showMsg(el: HTMLElement, text: string, type: 'success' | 'error'): void {
  const msg = el.querySelector<HTMLElement>('#cc-msg');
  if (!msg) return;
  msg.textContent      = text;
  msg.style.background = type === 'success' ? '#ECFDF5' : '#FEF2F2';
  msg.style.color      = type === 'success' ? '#059669' : '#DC2626';
  msg.style.border     = `1px solid ${type === 'success' ? '#A7F3D0' : '#FECACA'}`;
  msg.hidden = false;
  setTimeout(() => { msg.hidden = true; }, 3500);
}
