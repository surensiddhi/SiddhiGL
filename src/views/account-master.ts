/**
 * account-master.ts — Account Opening (Account Master) CRUD.
 * RPCs: list_accounts, save_account, delete_account, next_account_no
 *       list_account_types  (for type dropdown + description lookup)
 *
 * Verified signatures (from DB):
 *   list_accounts(p_tenant, p_status, p_acc_type, p_caller, p_term)
 *   save_account(p_tenant, p_caller, p_account_no, p_name, p_acc_type,
 *                p_requires_party, p_party_type, p_open_balance, p_open_date,
 *                p_active, p_ask_description)
 *   delete_account(p_tenant, p_caller, p_account_no)
 *   next_account_no(p_tenant, p_caller, p_acc_type)
 */

import { rpc } from '../lib/rpc';
import { ctx, roleLevel, getSession } from '../lib/session';

interface Account {
  account_no:      string;
  name:            string;
  acc_type:        string;
  active:          boolean;
  requires_party?: boolean;
  party_type?:     string;
  open_balance?:   number;
  open_date?:      string;
  ask_description?: boolean;
}

interface AccType {
  acc_type:      string;
  acc_type_desc: string;
  acc_class:     string;
  tran_level:    boolean;
  active:        boolean;
}

const CLASS_COLOR: Record<string, string> = {
  A: '#0284C7', L: '#DC2626', E: '#059669', I: '#7C3AED', X: '#D97706',
};

let _accounts: Account[] = [];
let _accTypes: AccType[]  = [];
let _editNo:   string | null = null;
let _canEdit   = false;
let _filter: 'active' | 'inactive' | 'all' = 'active';
let _search    = '';

// ── entry point ──────────────────────────────────────────────────────────────

export async function init(el: HTMLElement): Promise<void> {
  const s = getSession();
  _canEdit = !!s && roleLevel(s) >= 2;
  _filter  = 'active';
  _search  = '';

  el.innerHTML = `
    <div class="page-header">
      <span class="page-title">Accounts</span>
      ${_canEdit ? `<button id="am-add" class="btn btn-primary">+ New Account</button>` : ''}
    </div>

    <div class="toolbar" style="gap:8px;margin-bottom:12px">
      <select id="am-filter" class="at-select">
        <option value="active" selected>Active</option>
        <option value="all">All</option>
        <option value="inactive">Inactive</option>
      </select>
      <input id="am-search" type="text" placeholder="Search number or name…"
        style="flex:1;max-width:280px;border:1px solid var(--border);border-radius:5px;
               padding:5px 10px;font-size:.875rem;background:var(--surface);color:var(--text)" />
      <button id="am-search-btn" class="btn btn-primary"   style="padding:5px 14px">Search</button>
      <button id="am-clear-btn"  class="btn btn-secondary" style="padding:5px 14px">Clear</button>
    </div>

    <div id="am-msg" hidden style="padding:8px 12px;border-radius:6px;margin-bottom:10px;font-size:.875rem"></div>

    <div style="display:flex;gap:16px;align-items:flex-start">

      <!-- Table -->
      <div style="flex:1;overflow-x:auto">
        <table class="data-table" style="font-size:.9rem">
          <thead>
            <tr>
              <th style="min-width:90px">Account No</th>
              <th>Name</th>
              <th>Type</th>
              <th>Type Description</th>
              <th style="text-align:center">Status</th>
              ${_canEdit ? `<th style="text-align:right;padding-right:12px">Actions</th>` : ''}
            </tr>
          </thead>
          <tbody id="am-body">
            <tr><td colspan="6" class="loading-msg">Loading…</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Edit Panel -->
      <div id="am-panel" hidden style="
        width:300px;flex-shrink:0;background:var(--surface);
        border:1px solid var(--border);border-radius:8px;padding:20px;
        position:sticky;top:0;
      ">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <strong id="am-panel-title" style="font-size:1rem">New Account</strong>
          <button id="am-panel-close" style="background:none;border:none;cursor:pointer;font-size:1.3rem;color:var(--muted);line-height:1">&times;</button>
        </div>
        <form id="am-form">
          <div class="field" style="margin-bottom:12px">
            <label>Account No <span style="color:red">*</span></label>
            <input id="am-no" type="text" required maxlength="20" placeholder="auto-suggested" />
            <div id="am-no-note" hidden style="font-size:.72rem;color:var(--muted);margin-top:3px">Fixed once created</div>
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>Name <span style="color:red">*</span></label>
            <input id="am-name" type="text" required maxlength="100" />
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>Account Type <span style="color:red">*</span></label>
            <select id="am-type" required>
              <option value="">— select type —</option>
            </select>
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>Party Type</label>
            <select id="am-party-type">
              <option value="">(none)</option>
              <option value="customer">Customer</option>
              <option value="supplier">Supplier</option>
              <option value="employee">Employee</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
            <div class="field">
              <label>Opening Balance</label>
              <input id="am-open-bal" type="number" min="0" step="0.01" placeholder="0.00" style="text-align:right" />
            </div>
            <div class="field">
              <label>Opening Date</label>
              <input id="am-open-date" type="date" />
            </div>
          </div>
          <div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
              <input id="am-req-party" type="checkbox" />
              <span style="font-size:.875rem">Requires Party</span>
            </label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
              <input id="am-ask-desc" type="checkbox" />
              <span style="font-size:.875rem">Ask Description</span>
            </label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
              <input id="am-active" type="checkbox" checked />
              <span style="font-size:.875rem">Active</span>
            </label>
          </div>
          <div id="am-form-err" hidden style="color:#DC2626;font-size:.8rem;margin-bottom:10px;padding:6px 8px;background:#FEF2F2;border-radius:5px"></div>
          <div style="display:flex;gap:8px">
            <button type="button" id="am-cancel" class="btn btn-secondary" style="flex:1">Cancel</button>
            <button type="submit" id="am-save"   class="btn btn-primary"   style="flex:1">Save Account</button>
          </div>
        </form>
      </div>

    </div>
  `;

  // Toolbar events
  el.querySelector('#am-filter')?.addEventListener('change', e => {
    _filter = (e.target as HTMLSelectElement).value as typeof _filter;
    renderTable(el);
  });
  const doSearch = () => {
    _search = (el.querySelector<HTMLInputElement>('#am-search')!).value.trim().toLowerCase();
    renderTable(el);
  };
  el.querySelector('#am-search-btn')?.addEventListener('click', doSearch);
  el.querySelector<HTMLInputElement>('#am-search')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch();
  });
  el.querySelector('#am-clear-btn')?.addEventListener('click', () => {
    _search = '';
    (el.querySelector<HTMLInputElement>('#am-search')!).value = '';
    _filter = 'active';
    (el.querySelector<HTMLSelectElement>('#am-filter')!).value = 'active';
    renderTable(el);
  });

  // Panel events
  el.querySelector('#am-add')?.addEventListener('click',        () => openPanel(el, null));
  el.querySelector('#am-panel-close')?.addEventListener('click', () => closePanel(el));
  el.querySelector('#am-cancel')?.addEventListener('click',      () => closePanel(el));
  el.querySelector('#am-form')?.addEventListener('submit',       (e) => handleSave(e, el));

  // Auto-suggest account number when type changes
  el.querySelector<HTMLSelectElement>('#am-type')?.addEventListener('change', async () => {
    if (_editNo !== null) return;
    const accType = (el.querySelector<HTMLSelectElement>('#am-type')!).value;
    if (!accType) return;
    try {
      const no = await rpc<string>('next_account_no', { ...ctx(), p_acc_type: accType });
      (el.querySelector<HTMLInputElement>('#am-no')!).value = Array.isArray(no) ? no[0] : no;
    } catch { /* ignore */ }
  });

  await loadData(el);
}

// ── data ─────────────────────────────────────────────────────────────────────

async function loadData(el: HTMLElement): Promise<void> {
  try {
    const [accounts, types] = await Promise.all([
      rpc<Account[]>('list_accounts', { ...ctx(), p_status: 'all', p_acc_type: null, p_term: null }),
      rpc<AccType[]>('list_account_types', { ...ctx(), p_status: 'all' }),
    ]);
    _accounts = Array.isArray(accounts) ? accounts : [];
    _accTypes = Array.isArray(types)    ? types    : [];
    renderTable(el);
    populateTypeSelect(el);
  } catch (err) {
    showMsg(el, `Load failed: ${err instanceof Error ? err.message : err}`, 'error');
  }
}

// ── render ────────────────────────────────────────────────────────────────────

function filtered(): Account[] {
  return _accounts.filter(a => {
    const statusOk =
      _filter === 'all'    ? true :
      _filter === 'active' ? a.active : !a.active;
    const searchOk = !_search ||
      a.account_no.toLowerCase().includes(_search) ||
      a.name.toLowerCase().includes(_search);
    return statusOk && searchOk;
  });
}

function typeDesc(accType: string): string {
  return _accTypes.find(t => t.acc_type === accType)?.acc_type_desc ?? '';
}

function typeColor(accType: string): string {
  const t = _accTypes.find(t => t.acc_type === accType);
  return t ? (CLASS_COLOR[t.acc_class] ?? '#78716C') : '#78716C';
}

function renderTable(el: HTMLElement): void {
  const body = el.querySelector<HTMLElement>('#am-body')!;
  const rows = filtered();

  if (!_accounts.length) {
    body.innerHTML = `<tr><td colspan="6" class="loading-msg">No accounts found</td></tr>`;
    return;
  }
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="6" class="loading-msg">No records match the filter</td></tr>`;
    return;
  }

  body.innerHTML = rows.map(a => `
    <tr style="${!a.active ? 'opacity:.55' : ''}">
      <td style="font-family:monospace;font-size:.88rem">${a.account_no}</td>
      <td>${a.name}</td>
      <td><span style="font-family:monospace;font-size:.85rem;color:${typeColor(a.acc_type)}">${a.acc_type}</span></td>
      <td style="font-size:.85rem;color:var(--muted)">${typeDesc(a.acc_type)}</td>
      <td style="text-align:center">
        ${a.active
          ? `<span class="badge badge-approved">active</span>`
          : `<span class="badge badge-pending">inactive</span>`}
      </td>
      ${_canEdit ? `
      <td style="text-align:right;white-space:nowrap;padding-right:8px">
        <button class="am-edit btn btn-secondary" data-no="${a.account_no}" style="font-size:.75rem;padding:3px 8px;margin-right:4px">Edit</button>
        <button class="am-del  btn btn-danger"    data-no="${a.account_no}" style="font-size:.75rem;padding:3px 8px">Delete</button>
      </td>` : ''}
    </tr>
  `).join('');

  body.querySelectorAll<HTMLElement>('.am-edit').forEach(btn =>
    btn.addEventListener('click', () => openPanel(el, btn.dataset['no']!))
  );
  body.querySelectorAll<HTMLElement>('.am-del').forEach(btn =>
    btn.addEventListener('click', () => handleDelete(el, btn.dataset['no']!))
  );
}

function populateTypeSelect(el: HTMLElement, current?: string): void {
  const sel = el.querySelector<HTMLSelectElement>('#am-type')!;
  const cur = current ?? sel.value;
  const posting = _accTypes.filter(t => t.tran_level && t.active);
  sel.innerHTML = `<option value="">— select type —</option>` +
    posting.map(t =>
      `<option value="${t.acc_type}" ${t.acc_type === cur ? 'selected' : ''}>${t.acc_type} — ${t.acc_type_desc}</option>`
    ).join('');
  if (cur) sel.value = cur;
}

// ── panel ─────────────────────────────────────────────────────────────────────

function openPanel(el: HTMLElement, no: string | null): void {
  const panel     = el.querySelector<HTMLElement>('#am-panel')!;
  const titleEl   = el.querySelector<HTMLElement>('#am-panel-title')!;
  const noInput   = el.querySelector<HTMLInputElement>('#am-no')!;
  const noNote    = el.querySelector<HTMLElement>('#am-no-note')!;
  const nameIn    = el.querySelector<HTMLInputElement>('#am-name')!;
  const typeSel   = el.querySelector<HTMLSelectElement>('#am-type')!;
  const partyType = el.querySelector<HTMLSelectElement>('#am-party-type')!;
  const openBal   = el.querySelector<HTMLInputElement>('#am-open-bal')!;
  const openDate  = el.querySelector<HTMLInputElement>('#am-open-date')!;
  const reqParty  = el.querySelector<HTMLInputElement>('#am-req-party')!;
  const askDesc   = el.querySelector<HTMLInputElement>('#am-ask-desc')!;
  const activeChk = el.querySelector<HTMLInputElement>('#am-active')!;
  const errEl     = el.querySelector<HTMLElement>('#am-form-err')!;

  errEl.hidden = true;
  _editNo = no;

  const curType = no ? (_accounts.find(a => a.account_no === no)?.acc_type ?? '') : '';
  populateTypeSelect(el, curType);

  if (no) {
    const acc = _accounts.find(a => a.account_no === no);
    if (!acc) return;
    titleEl.textContent      = 'Edit Account';
    noInput.value            = acc.account_no;
    noInput.readOnly         = true;
    noInput.style.background = 'var(--bg)';
    noNote.hidden            = false;
    nameIn.value             = acc.name;
    typeSel.value            = acc.acc_type;
    partyType.value          = acc.party_type ?? '';
    openBal.value            = acc.open_balance ? String(acc.open_balance) : '';
    openDate.value           = acc.open_date ?? '';
    reqParty.checked         = !!acc.requires_party;
    askDesc.checked          = !!acc.ask_description;
    activeChk.checked        = acc.active;
  } else {
    titleEl.textContent      = 'New Account';
    noInput.value            = '';
    noInput.readOnly         = false;
    noInput.style.background = '';
    noNote.hidden            = true;
    nameIn.value             = '';
    typeSel.value            = '';
    partyType.value          = '';
    openBal.value            = '';
    openDate.value           = '';
    reqParty.checked         = false;
    askDesc.checked          = false;
    activeChk.checked        = true;
  }

  panel.hidden = false;
  nameIn.focus();
}

function closePanel(el: HTMLElement): void {
  el.querySelector<HTMLElement>('#am-panel')!.hidden = true;
  _editNo = null;
}

// ── save / delete ─────────────────────────────────────────────────────────────

async function handleSave(e: Event, el: HTMLElement): Promise<void> {
  e.preventDefault();
  const noInput   = el.querySelector<HTMLInputElement>('#am-no')!;
  const nameIn    = el.querySelector<HTMLInputElement>('#am-name')!;
  const typeSel   = el.querySelector<HTMLSelectElement>('#am-type')!;
  const partyType = el.querySelector<HTMLSelectElement>('#am-party-type')!;
  const openBal   = el.querySelector<HTMLInputElement>('#am-open-bal')!;
  const openDate  = el.querySelector<HTMLInputElement>('#am-open-date')!;
  const reqParty  = el.querySelector<HTMLInputElement>('#am-req-party')!;
  const askDesc   = el.querySelector<HTMLInputElement>('#am-ask-desc')!;
  const activeChk = el.querySelector<HTMLInputElement>('#am-active')!;
  const errEl     = el.querySelector<HTMLElement>('#am-form-err')!;
  const saveBtn   = el.querySelector<HTMLButtonElement>('#am-save')!;

  errEl.hidden     = true;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  try {
    await rpc('save_account', {
      ...ctx(),
      p_account_no:     noInput.value.trim(),
      p_name:           nameIn.value.trim(),
      p_acc_type:       typeSel.value,
      p_party_type:     partyType.value || null,
      p_open_balance:   parseFloat(openBal.value) || null,
      p_open_date:      openDate.value || null,
      p_requires_party: reqParty.checked,
      p_ask_description: askDesc.checked,
      p_active:         activeChk.checked,
    });
    closePanel(el);
    showMsg(el, 'Account saved successfully', 'success');
    await loadData(el);
  } catch (err) {
    errEl.textContent = err instanceof Error ? err.message : 'Save failed';
    errEl.hidden = false;
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Account';
  }
}

async function handleDelete(el: HTMLElement, no: string): Promise<void> {
  const acc = _accounts.find(a => a.account_no === no);
  if (!confirm(`Delete account "${no} — ${acc?.name}"?\nThis cannot be undone.`)) return;
  try {
    await rpc('delete_account', { ...ctx(), p_account_no: no });
    showMsg(el, `Deleted ${no}`, 'success');
    await loadData(el);
  } catch (err) {
    showMsg(el, `Delete failed: ${err instanceof Error ? err.message : err}`, 'error');
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function showMsg(el: HTMLElement, text: string, type: 'success' | 'error'): void {
  const msg = el.querySelector<HTMLElement>('#am-msg');
  if (!msg) return;
  msg.textContent      = text;
  msg.style.background = type === 'success' ? '#ECFDF5' : '#FEF2F2';
  msg.style.color      = type === 'success' ? '#059669' : '#DC2626';
  msg.style.border     = `1px solid ${type === 'success' ? '#A7F3D0' : '#FECACA'}`;
  msg.hidden = false;
  setTimeout(() => { msg.hidden = true; }, 3500);
}
