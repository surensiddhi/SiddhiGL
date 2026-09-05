/**
 * party-master.ts — Party master (CRUD).
 * RPCs: list_parties, save_party, delete_party, next_party_code, lk_control_accounts
 *
 * Verified signatures:
 *   list_parties(p_party_type, p_tenant, p_caller, p_status, p_term) -> incl. due_days
 *   save_party(p_tenant, p_caller, p_party_type, p_party_code, p_party_name,
 *              p_control_account_no, p_address, p_mobile, p_email,
 *              p_tax_number, p_tax_type, p_active, p_due_days, p_orig_code)
 *   delete_party(p_tenant, p_caller, p_party_type, p_party_code)
 *   next_party_code(p_tenant, p_caller, p_party_type)
 *   lk_control_accounts(p_tenant, p_caller, p_term)
 *
 * due_days: credit due-days for this party. When blank, Sales/Purchase bills
 * fall back to the company-wide default (Company Settings > Credit Terms).
 */

import { rpc } from '../lib/rpc';
import { ctx, roleLevel, getSession } from '../lib/session';
import { lookupData } from '../services/lookup';

interface Party {
  party_code:         string;
  party_name:         string;
  party_type:         string;
  control_account_no: string;
  active:             boolean;
  address?:           string;
  mobile?:            string;
  email?:             string;
  tax_number?:        string;
  tax_type?:          string;
  due_days?:          number | null;
}

interface ControlAcct {
  value: string;
  label: string;
}

interface PartyTypeOpt { value: string; label: string; }

// Party types are tenant-defined (see the `party_types` table — e.g. NDS uses
// codes 'C'/'D', not generic labels), so they're fetched live via lk_party_types
// rather than hardcoded. This also fixes an edit-mode bug: a hardcoded list of
// guessed codes couldn't match a real party's actual party_type, leaving the
// (disabled) Party Type dropdown looking blank/unpopulated when editing.
const TYPE_PALETTE = ['#0284C7', '#7C3AED', '#059669', '#D97706', '#DB2777', '#78716C'];

const TAX_TYPES = ['', 'PAN', 'VAT', 'TIN'];

let _rows:       Party[]        = [];
let _partyTypes: PartyTypeOpt[] = [];
let _ctrlAccts:  ControlAcct[] = [];
let _editCode:   string | null = null;
let _canEdit     = false;
let _filter: 'active' | 'inactive' | 'all' = 'active';
let _typeFilter  = '';
let _search      = '';

// ── entry point ──────────────────────────────────────────────────────────────

export async function init(el: HTMLElement): Promise<void> {
  const s = getSession();
  _canEdit    = !!s && roleLevel(s) >= 2;
  _filter     = 'active';
  _typeFilter = '';
  _search     = '';

  el.innerHTML = `
    <div class="page-header">
      <span class="page-title">Parties</span>
      ${_canEdit ? `<button id="pm-add" class="btn btn-primary">+ New Party</button>` : ''}
    </div>

    <div class="toolbar" style="gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <select id="pm-type-filter" class="at-select">
        <option value="">All Types</option>
      </select>
      <select id="pm-status-filter" class="at-select">
        <option value="active" selected>Active</option>
        <option value="all">All</option>
        <option value="inactive">Inactive</option>
      </select>
      <input id="pm-search" type="text" placeholder="Search code or name…"
        style="flex:1;max-width:260px;border:1px solid var(--border);border-radius:5px;
               padding:5px 10px;font-size:.875rem;background:var(--surface);color:var(--text)" />
    </div>

    <div id="pm-msg" hidden style="padding:8px 12px;border-radius:6px;margin-bottom:10px;font-size:.875rem"></div>

    <div style="display:flex;gap:16px;align-items:flex-start">

      <!-- Table -->
      <div style="flex:1;overflow-x:auto">
        <table class="data-table" style="font-size:.9rem">
          <thead>
            <tr>
              <th style="min-width:90px">Code</th>
              <th>Name</th>
              <th>Type</th>
              <th>Control Account</th>
              <th style="text-align:center">Status</th>
              ${_canEdit ? `<th style="text-align:right;padding-right:12px">Actions</th>` : ''}
            </tr>
          </thead>
          <tbody id="pm-body">
            <tr><td colspan="6" class="loading-msg">Loading…</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Edit Panel -->
      <div id="pm-panel" hidden style="
        width:310px;flex-shrink:0;background:var(--surface);
        border:1px solid var(--border);border-radius:8px;padding:20px;
        position:sticky;top:0;
      ">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <strong id="pm-panel-title" style="font-size:1rem">New Party</strong>
          <button id="pm-panel-close" style="background:none;border:none;cursor:pointer;font-size:1.3rem;color:var(--muted);line-height:1">&times;</button>
        </div>
        <form id="pm-form">
          <div class="field" style="margin-bottom:12px">
            <label>Party Type <span style="color:red">*</span></label>
            <select id="pm-type" required>
              <option value="">— select type —</option>
            </select>
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>Party Code <span style="color:red">*</span></label>
            <input id="pm-code" type="text" required maxlength="20" placeholder="auto-suggested" />
            <div id="pm-code-note" hidden style="font-size:.72rem;color:var(--muted);margin-top:3px">Fixed once created</div>
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>Party Name <span style="color:red">*</span></label>
            <input id="pm-name" type="text" required maxlength="120" />
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>Control Account <span style="color:red">*</span></label>
            <select id="pm-ctrl-acct" required>
              <option value="">— select account —</option>
            </select>
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>Address</label>
            <input id="pm-address" type="text" maxlength="200" />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
            <div class="field">
              <label>Mobile</label>
              <input id="pm-mobile" type="text" maxlength="20" />
            </div>
            <div class="field">
              <label>Email</label>
              <input id="pm-email" type="email" maxlength="80" />
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
            <div class="field">
              <label>Tax Number</label>
              <input id="pm-tax-no" type="text" maxlength="20" />
            </div>
            <div class="field">
              <label>Tax Type</label>
              <select id="pm-tax-type">
                ${TAX_TYPES.map(t => `<option value="${t}">${t || '(none)'}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field" style="margin-bottom:14px">
            <label>Credit Due Days</label>
            <input id="pm-due-days" type="number" min="0" step="1" placeholder="blank = use company default" />
          </div>
          <div style="margin-bottom:16px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input id="pm-active" type="checkbox" checked />
              <span style="font-size:.875rem">Active</span>
            </label>
          </div>
          <div id="pm-form-err" hidden style="color:#DC2626;font-size:.8rem;margin-bottom:10px;padding:6px 8px;background:#FEF2F2;border-radius:5px"></div>
          <div style="display:flex;gap:8px">
            <button type="button" id="pm-cancel" class="btn btn-secondary" style="flex:1">Cancel</button>
            <button type="submit" id="pm-save"   class="btn btn-primary"   style="flex:1">Save Party</button>
          </div>
        </form>
      </div>

    </div>
  `;

  // Toolbar events
  el.querySelector('#pm-type-filter')?.addEventListener('change', e => {
    _typeFilter = (e.target as HTMLSelectElement).value;
    renderTable(el);
  });
  el.querySelector('#pm-status-filter')?.addEventListener('change', e => {
    _filter = (e.target as HTMLSelectElement).value as typeof _filter;
    renderTable(el);
  });
  el.querySelector<HTMLInputElement>('#pm-search')?.addEventListener('input', e => {
    _search = (e.target as HTMLInputElement).value.trim().toLowerCase();
    renderTable(el);
  });

  // Panel events
  el.querySelector('#pm-add')?.addEventListener('click',        () => openPanel(el, null, null));
  el.querySelector('#pm-panel-close')?.addEventListener('click', () => closePanel(el));
  el.querySelector('#pm-cancel')?.addEventListener('click',      () => closePanel(el));
  el.querySelector('#pm-form')?.addEventListener('submit',       (e) => handleSave(e, el));

  // Auto-suggest code when party type changes (add mode only)
  el.querySelector<HTMLSelectElement>('#pm-type')?.addEventListener('change', async () => {
    if (_editCode !== null) return;
    const ptype = (el.querySelector<HTMLSelectElement>('#pm-type')!).value;
    if (!ptype) return;
    try {
      const code = await rpc<string>('next_party_code', { ...ctx(), p_party_type: ptype });
      (el.querySelector<HTMLInputElement>('#pm-code')!).value = Array.isArray(code) ? code[0] : code;
    } catch { /* ignore */ }
  });

  await loadData(el);
}

// ── data ─────────────────────────────────────────────────────────────────────

async function loadData(el: HTMLElement): Promise<void> {
  try {
    const [rows, ctrlRaw, typesRes] = await Promise.all([
      rpc<Party[]>('list_parties', { ...ctx(), p_party_type: null, p_status: 'all', p_term: null }),
      rpc<{ value: string; label: string }[]>('lk_control_accounts', { ...ctx(), p_term: null }),
      lookupData('party_types'),
    ]);
    _rows      = Array.isArray(rows)    ? rows    : [];
    _ctrlAccts = Array.isArray(ctrlRaw) ? ctrlRaw : [];
    _partyTypes = typesRes.rows.map(r => ({ value: r.value, label: r.label }));
    populateTypeSelects(el);
    renderTable(el);
    populateCtrlAccounts(el);
  } catch (err) {
    showMsg(el, `Load failed: ${err instanceof Error ? err.message : err}`, 'error');
  }
}

function typeLabel(value: string): string {
  return _partyTypes.find(t => t.value === value)?.label ?? value;
}

function typeColor(value: string): string {
  const idx = _partyTypes.findIndex(t => t.value === value);
  return TYPE_PALETTE[(idx < 0 ? 0 : idx) % TYPE_PALETTE.length]!;
}

function populateTypeSelects(el: HTMLElement): void {
  const filterSel = el.querySelector<HTMLSelectElement>('#pm-type-filter');
  const formSel    = el.querySelector<HTMLSelectElement>('#pm-type');
  const optsHtml = _partyTypes.map(t => `<option value="${t.value}">${t.label}</option>`).join('');
  if (filterSel) {
    const cur = filterSel.value;
    filterSel.innerHTML = `<option value="">All Types</option>` + optsHtml;
    filterSel.value = cur;
  }
  if (formSel) {
    const cur = formSel.value;
    formSel.innerHTML = `<option value="">— select type —</option>` + optsHtml;
    formSel.value = cur;
  }
}

// ── render ────────────────────────────────────────────────────────────────────

function filtered(): Party[] {
  return _rows.filter(p => {
    const statusOk =
      _filter === 'all'    ? true :
      _filter === 'active' ? p.active : !p.active;
    const typeOk   = !_typeFilter || p.party_type === _typeFilter;
    const searchOk = !_search ||
      p.party_code.toLowerCase().includes(_search) ||
      p.party_name.toLowerCase().includes(_search);
    return statusOk && typeOk && searchOk;
  });
}

function ctrlLabel(no: string): string {
  return _ctrlAccts.find(a => a.value === no)?.label ?? no;
}

function renderTable(el: HTMLElement): void {
  const body = el.querySelector<HTMLElement>('#pm-body')!;
  const rows = filtered();

  if (!_rows.length) {
    body.innerHTML = `<tr><td colspan="6" class="loading-msg">No parties found</td></tr>`;
    return;
  }
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="6" class="loading-msg">No records match the filter</td></tr>`;
    return;
  }

  body.innerHTML = rows.map(p => {
    return `
    <tr style="${!p.active ? 'opacity:.55' : ''}">
      <td style="font-family:monospace;font-size:.88rem">${p.party_code}</td>
      <td>${p.party_name}</td>
      <td><span style="font-size:.78rem;font-weight:600;color:${typeColor(p.party_type)}">${typeLabel(p.party_type)}</span></td>
      <td style="font-size:.82rem;color:var(--muted)">${ctrlLabel(p.control_account_no)}</td>
      <td style="text-align:center">
        ${p.active
          ? `<span class="badge badge-approved">active</span>`
          : `<span class="badge badge-pending">inactive</span>`}
      </td>
      ${_canEdit ? `
      <td style="text-align:right;white-space:nowrap;padding-right:8px">
        <button class="pm-edit btn btn-secondary" data-code="${p.party_code}" data-type="${p.party_type}" style="font-size:.75rem;padding:3px 8px;margin-right:4px">Edit</button>
        <button class="pm-del  btn btn-danger"    data-code="${p.party_code}" data-type="${p.party_type}" style="font-size:.75rem;padding:3px 8px">Delete</button>
      </td>` : ''}
    </tr>`;
  }).join('');

  body.querySelectorAll<HTMLElement>('.pm-edit').forEach(btn =>
    btn.addEventListener('click', () => openPanel(el, btn.dataset['code']!, btn.dataset['type']!))
  );
  body.querySelectorAll<HTMLElement>('.pm-del').forEach(btn =>
    btn.addEventListener('click', () => handleDelete(el, btn.dataset['code']!, btn.dataset['type']!))
  );
}

function populateCtrlAccounts(el: HTMLElement, current?: string): void {
  const sel = el.querySelector<HTMLSelectElement>('#pm-ctrl-acct')!;
  const cur = current ?? sel.value;
  sel.innerHTML = `<option value="">— select account —</option>` +
    _ctrlAccts.map(a =>
      `<option value="${a.value}" ${a.value === cur ? 'selected' : ''}>${a.value} — ${a.label}</option>`
    ).join('');
  if (cur) sel.value = cur;
}

// ── panel ─────────────────────────────────────────────────────────────────────

function openPanel(el: HTMLElement, code: string | null, ptype: string | null): void {
  const panel     = el.querySelector<HTMLElement>('#pm-panel')!;
  const titleEl   = el.querySelector<HTMLElement>('#pm-panel-title')!;
  const typeSel   = el.querySelector<HTMLSelectElement>('#pm-type')!;
  const codeIn    = el.querySelector<HTMLInputElement>('#pm-code')!;
  const codeNote  = el.querySelector<HTMLElement>('#pm-code-note')!;
  const nameIn    = el.querySelector<HTMLInputElement>('#pm-name')!;
  const ctrlSel   = el.querySelector<HTMLSelectElement>('#pm-ctrl-acct')!;
  const addrIn    = el.querySelector<HTMLInputElement>('#pm-address')!;
  const mobileIn  = el.querySelector<HTMLInputElement>('#pm-mobile')!;
  const emailIn   = el.querySelector<HTMLInputElement>('#pm-email')!;
  const taxNoIn   = el.querySelector<HTMLInputElement>('#pm-tax-no')!;
  const taxTypeSel= el.querySelector<HTMLSelectElement>('#pm-tax-type')!;
  const dueDaysIn = el.querySelector<HTMLInputElement>('#pm-due-days')!;
  const activeChk = el.querySelector<HTMLInputElement>('#pm-active')!;
  const errEl     = el.querySelector<HTMLElement>('#pm-form-err')!;

  errEl.hidden = true;
  _editCode = code;

  populateCtrlAccounts(el, code ? (_rows.find(p => p.party_code === code && p.party_type === ptype)?.control_account_no ?? '') : '');

  if (code && ptype) {
    const party = _rows.find(p => p.party_code === code && p.party_type === ptype);
    if (!party) return;
    titleEl.textContent      = 'Edit Party';
    typeSel.value            = party.party_type;
    typeSel.disabled         = true;
    codeIn.value             = party.party_code;
    codeIn.readOnly          = true;
    codeIn.style.background  = 'var(--bg)';
    codeNote.hidden          = false;
    nameIn.value             = party.party_name;
    ctrlSel.value            = party.control_account_no;
    addrIn.value             = party.address ?? '';
    mobileIn.value           = party.mobile ?? '';
    emailIn.value            = party.email ?? '';
    taxNoIn.value            = party.tax_number ?? '';
    taxTypeSel.value         = party.tax_type ?? '';
    dueDaysIn.value          = party.due_days != null ? String(party.due_days) : '';
    activeChk.checked        = party.active;
  } else {
    titleEl.textContent      = 'New Party';
    typeSel.value            = '';
    typeSel.disabled         = false;
    codeIn.value             = '';
    codeIn.readOnly          = false;
    codeIn.style.background  = '';
    codeNote.hidden          = true;
    nameIn.value             = '';
    ctrlSel.value            = '';
    addrIn.value             = '';
    mobileIn.value           = '';
    emailIn.value            = '';
    taxNoIn.value            = '';
    taxTypeSel.value         = '';
    dueDaysIn.value          = '';
    activeChk.checked        = true;
  }

  panel.hidden = false;
  nameIn.focus();
}

function closePanel(el: HTMLElement): void {
  el.querySelector<HTMLElement>('#pm-panel')!.hidden = true;
  const typeSel = el.querySelector<HTMLSelectElement>('#pm-type');
  if (typeSel) typeSel.disabled = false;
  _editCode = null;
}

// ── save / delete ─────────────────────────────────────────────────────────────

async function handleSave(e: Event, el: HTMLElement): Promise<void> {
  e.preventDefault();
  const typeSel   = el.querySelector<HTMLSelectElement>('#pm-type')!;
  const codeIn    = el.querySelector<HTMLInputElement>('#pm-code')!;
  const nameIn    = el.querySelector<HTMLInputElement>('#pm-name')!;
  const ctrlSel   = el.querySelector<HTMLSelectElement>('#pm-ctrl-acct')!;
  const addrIn    = el.querySelector<HTMLInputElement>('#pm-address')!;
  const mobileIn  = el.querySelector<HTMLInputElement>('#pm-mobile')!;
  const emailIn   = el.querySelector<HTMLInputElement>('#pm-email')!;
  const taxNoIn   = el.querySelector<HTMLInputElement>('#pm-tax-no')!;
  const taxTypeSel= el.querySelector<HTMLSelectElement>('#pm-tax-type')!;
  const dueDaysIn = el.querySelector<HTMLInputElement>('#pm-due-days')!;
  const activeChk = el.querySelector<HTMLInputElement>('#pm-active')!;
  const errEl     = el.querySelector<HTMLElement>('#pm-form-err')!;
  const saveBtn   = el.querySelector<HTMLButtonElement>('#pm-save')!;

  errEl.hidden     = true;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  try {
    await rpc('save_party', {
      ...ctx(),
      p_party_type:       typeSel.value,
      p_party_code:       codeIn.value.trim(),
      p_party_name:       nameIn.value.trim(),
      p_control_account_no: ctrlSel.value,
      p_address:          addrIn.value.trim()   || null,
      p_mobile:           mobileIn.value.trim() || null,
      p_email:            emailIn.value.trim()  || null,
      p_tax_number:       taxNoIn.value.trim()  || null,
      p_tax_type:         taxTypeSel.value      || null,
      p_active:           activeChk.checked,
      p_due_days:         dueDaysIn.value.trim() ? Number(dueDaysIn.value) : null,
      p_orig_code:        _editCode ?? codeIn.value.trim(),
    });
    closePanel(el);
    showMsg(el, 'Party saved successfully', 'success');
    await loadData(el);
  } catch (err) {
    errEl.textContent = err instanceof Error ? err.message : 'Save failed';
    errEl.hidden = false;
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Party';
  }
}

async function handleDelete(el: HTMLElement, code: string, ptype: string): Promise<void> {
  const party = _rows.find(p => p.party_code === code && p.party_type === ptype);
  if (!confirm(`Delete party "${code} — ${party?.party_name}"?\nThis cannot be undone.`)) return;
  try {
    await rpc('delete_party', { ...ctx(), p_party_type: ptype, p_party_code: code });
    showMsg(el, `Deleted ${code}`, 'success');
    await loadData(el);
  } catch (err) {
    showMsg(el, `Delete failed: ${err instanceof Error ? err.message : err}`, 'error');
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function showMsg(el: HTMLElement, text: string, type: 'success' | 'error'): void {
  const msg = el.querySelector<HTMLElement>('#pm-msg');
  if (!msg) return;
  msg.textContent      = text;
  msg.style.background = type === 'success' ? '#ECFDF5' : '#FEF2F2';
  msg.style.color      = type === 'success' ? '#059669' : '#DC2626';
  msg.style.border     = `1px solid ${type === 'success' ? '#A7F3D0' : '#FECACA'}`;
  msg.hidden = false;
  setTimeout(() => { msg.hidden = true; }, 3500);
}
