/**
 * voucher-form.ts — Voucher entry / edit form.
 * New:  #voucher-form
 * Edit: #voucher-form?head_id=123
 *
 * DB functions:
 *   get_voucher(p_tenant, p_caller, p_head_id)  → jsonb with .lines[]
 *   save_voucher(payload jsonb)                 → {id, voucher_no}
 *   lk_accounts(p_tenant, p_caller, p_term?)   → {value, label, requires_party, party_type}
 *   lk_parties_by_account(p_tenant, p_caller, p_control, p_term?) → {value, label}
 *   cc_list(p_include_inactive, p_tenant, p_caller) → [{code, name}]
 *
 * Payload keys for save_voucher: tenant, caller (no p_ prefix), id (null=new)
 */

import { rpc } from '../lib/rpc';
import { ctx } from '../lib/session';
import { can } from '../lib/perm';
import { postVoucher } from '../services/voucher';
import { lookupData } from '../services/lookup';
import {
  isoToBs, bsToIso,
  daysInBsMonth, bsMonthStartDow, MONTH_NAMES,
} from '../lib/bs-calendar';

// ── Types ──────────────────────────────────────────────────────────────────────

const TRAN_TYPES = ['JV', 'PV', 'RV', 'CV', 'SV', 'PUR'];

interface CcRow { code: string; name: string; }

interface LineState {
  uid:              number;
  account_no:       string;
  account_name:     string;
  requires_party:   boolean;
  party_type:       string;
  party_code:       string;
  party_name:       string;
  description:      string;
  debit:            number;
  credit:           number;
  cost_centre_code: string;
}

let _uid = 0;
function makeLine(): LineState {
  return {
    uid: ++_uid, account_no: '', account_name: '',
    requires_party: false, party_type: '', party_code: '', party_name: '',
    description: '', debit: 0, credit: 0, cost_centre_code: '',
  };
}

function todayIso(): string { return new Date().toISOString().slice(0, 10); }

function toBS(iso: string): string {
  const bs = isoToBs(iso);
  return bs ? bs.replace(/\//g, '-') : '';
}

function fmt(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Label style shared by header ───────────────────────────────────────────────
const LBL = `font-weight:700;font-size:.875rem;color:var(--text);white-space:nowrap;padding-right:4px`;

// ── init ───────────────────────────────────────────────────────────────────────

export async function init(el: HTMLElement): Promise<void> {
  // Parse head_id from hash query string
  const hashQuery  = window.location.hash.split('?')[1] ?? '';
  const params     = new URLSearchParams(hashQuery);
  const headIdStr  = params.get('head_id');
  const headId     = headIdStr ? parseInt(headIdStr) : null;
  const isEdit     = headId !== null;

  // State
  let lines:       LineState[] = [makeLine(), makeLine()];
  let ccRows:      CcRow[]     = [];
  let saving       = false;
  let readOnly     = false;
  let loadedStatus = 'unapproved';
  const canPost    = can('voucher.post');

  // BS calendar state
  let _bsViewYear  = 0;
  let _bsViewMonth = 0;

  // ── Shell ────────────────────────────────────────────────────────────────────

  el.innerHTML = `
    <div class="page-header">
      <span class="page-title">${isEdit ? 'Edit Voucher' : 'New Voucher'}</span>
      <a href="#voucher-list" class="btn btn-secondary" style="font-size:.85rem">← Back</a>
    </div>

    <div id="vf-alert" hidden style="
      padding:10px 16px;border-radius:6px;margin-bottom:14px;
      font-size:.85rem;border:1px solid transparent"></div>

    <!-- Status strip — hidden until edit mode loads -->
    <div id="vf-status-strip" hidden style="
      display:flex;align-items:center;gap:12px;
      padding:8px 14px;border-radius:6px;margin-bottom:12px;
      background:var(--surface);border:1px solid var(--border);font-size:.85rem">
      <span id="vf-status-label" style="color:var(--muted)">Status:</span>
      <span id="vf-status-badge"></span>
    </div>

    <div class="card" style="padding:20px 24px">

      <!-- ── Header: 2-row 4-column grid (label | input | label | input) ── -->
      <div style="display:grid;grid-template-columns:max-content 1fr max-content 1fr;
                  gap:10px 20px;align-items:center;margin-bottom:18px">

        <!-- Row 1 -->
        <label style="${LBL}">Tran Type <span style="color:red">*</span></label>
        <select id="vf-tran-type" class="at-select" style="width:100%">
          <option value="">-- select --</option>
          ${TRAN_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
        </select>

        <label style="${LBL}">Voucher No</label>
        <input id="vf-voucher-no" type="text" readonly value="auto"
          style="background:var(--bg);color:var(--muted);font-family:monospace;cursor:default" />

        <!-- Row 2 -->
        <label style="${LBL}">Date BS <span style="color:red">*</span></label>
        <div style="position:relative">
          <input id="vf-date-nep" type="text" placeholder="YYYY-MM-DD (click)"
            style="width:100%;box-sizing:border-box;cursor:pointer;padding-right:30px" />
          <span id="vf-cal-icon"
            style="position:absolute;right:8px;top:50%;transform:translateY(-50%);
                   cursor:pointer;font-size:1rem;user-select:none;line-height:1">📅</span>
          <!-- Inline BS calendar popup -->
          <div id="vf-bs-cal" hidden
            style="position:absolute;top:calc(100% + 4px);left:0;z-index:300;
                   width:280px;background:var(--surface);border:1px solid var(--border);
                   border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.18);
                   padding:8px;font-size:.82rem"></div>
        </div>

        <label style="${LBL}">Date AD <span style="color:red">*</span></label>
        <input id="vf-date" type="date" value="${todayIso()}" />
      </div>

      <!-- Description -->
      <div class="field" style="margin-bottom:20px">
        <label style="${LBL}">Description</label>
        <input id="vf-description" type="text" placeholder="Voucher narration"
          style="margin-top:6px" />
      </div>

      <!-- ── Lines table ── -->
      <div id="vf-lines-wrap" style="overflow-x:auto;margin-bottom:0"></div>

      <!-- ── Add Line row + Balance indicator (same row) ── -->
      <div style="display:flex;justify-content:space-between;align-items:center;
                  padding:8px 0;margin-bottom:20px;border-top:1px solid var(--border)">
        <button id="vf-add-line" class="btn btn-secondary" style="font-size:.85rem">+ Add Line</button>
        <div id="vf-balance"
          style="font-family:monospace;font-weight:700;font-size:1rem;letter-spacing:.01em"></div>
      </div>

      <!-- Footer row -->
      <div class="field" style="margin-bottom:24px">
        <label style="${LBL}">Footer Note</label>
        <textarea id="vf-footer-note" rows="3" placeholder="Prepared by / remarks"
          style="resize:vertical;width:100%;box-sizing:border-box;margin-top:6px;
                 border:1px solid var(--border);border-radius:5px;
                 padding:8px 10px;font-size:.875rem;
                 background:var(--surface);color:var(--text)"></textarea>
      </div>

      <!-- Action buttons -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button id="vf-save"   class="btn btn-primary">Save</button>
        <button id="vf-post"   class="btn btn-primary" hidden
          style="background:#059669;border-color:#059669">Post Voucher</button>
        <button id="vf-new"    class="btn btn-secondary">New / Clear</button>
        <a href="#voucher-list" class="btn btn-secondary">Cancel</a>
        <span id="vf-post-hint" hidden
          style="font-size:.8rem;color:var(--muted);margin-left:4px">
          Posting assigns a permanent number and locks the voucher.
        </span>
      </div>
    </div>
  `;

  // ── BS calendar initialise ─────────────────────────────────────────────────

  const nepInput  = el.querySelector<HTMLInputElement>('#vf-date-nep')!;
  const adInput   = el.querySelector<HTMLInputElement>('#vf-date')!;
  const bsCalEl   = el.querySelector<HTMLElement>('#vf-bs-cal')!;
  const calIcon   = el.querySelector<HTMLElement>('#vf-cal-icon')!;

  // Set initial BS value from today's AD
  nepInput.value = toBS(adInput.value || todayIso());

  function openBsCal(): void {
    const iso = adInput.value || todayIso();
    const bs  = isoToBs(iso) ?? '';
    const [y, m] = bs.split('/').map(Number);
    _bsViewYear  = y || 2082;
    _bsViewMonth = m || 1;
    renderBsMonth();
    bsCalEl.hidden = false;
  }

  function renderBsMonth(): void {
    // Determine selected day
    const selIso = adInput.value;
    const selBs  = selIso ? (isoToBs(selIso) ?? '') : '';
    const [selY, selM, selD] = selBs.split('/').map(Number);

    const days     = daysInBsMonth(_bsViewYear, _bsViewMonth);
    const startDow = bsMonthStartDow(_bsViewYear, _bsViewMonth); // 0=Sun

    const DOW = ['Su','Mo','Tu','We','Th','Fr','Sa'];
    const monthName = MONTH_NAMES[_bsViewMonth - 1] ?? String(_bsViewMonth);

    let html = `
      <div class="bsp-header" style="display:flex;justify-content:space-between;
        align-items:center;margin-bottom:6px;padding:2px 4px">
        <button class="bsp-nav" data-dir="-1"
          style="background:none;border:none;cursor:pointer;font-size:1.1rem;
                 color:var(--text);padding:2px 6px">&lsaquo;</button>
        <span class="bsp-title" style="font-weight:700;font-size:.88rem">
          ${monthName} ${_bsViewYear}
        </span>
        <button class="bsp-nav" data-dir="1"
          style="background:none;border:none;cursor:pointer;font-size:1.1rem;
                 color:var(--text);padding:2px 6px">&rsaquo;</button>
      </div>
      <div class="bsp-dow" style="display:grid;grid-template-columns:repeat(7,1fr);
        gap:2px;margin-bottom:4px;text-align:center">
        ${DOW.map(d => `<div style="font-size:.72rem;font-weight:600;color:var(--muted)">${d}</div>`).join('')}
      </div>
      <div class="bsp-grid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px">
    `;

    // Leading blanks
    for (let b = 0; b < startDow; b++) {
      html += `<div></div>`;
    }

    for (let d = 1; d <= days; d++) {
      const isSelected = (d === selD && _bsViewMonth === selM && _bsViewYear === selY);
      html += `
        <div class="bsp-day${isSelected ? ' selected' : ''}" data-day="${d}"
          style="text-align:center;padding:4px 2px;border-radius:4px;cursor:pointer;
                 font-size:.8rem;${isSelected
                   ? 'background:var(--primary,#0284C7);color:#fff;font-weight:700'
                   : 'color:var(--text)'}">
          ${d}
        </div>`;
    }

    html += `</div>`;
    bsCalEl.innerHTML = html;

    // Month nav
    bsCalEl.querySelectorAll<HTMLButtonElement>('.bsp-nav').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const dir = parseInt(btn.dataset['dir'] ?? '0');
        _bsViewMonth += dir;
        if (_bsViewMonth > 12) { _bsViewMonth = 1;  _bsViewYear++; }
        if (_bsViewMonth < 1)  { _bsViewMonth = 12; _bsViewYear--; }
        renderBsMonth();
      });
    });

    // Day pick
    bsCalEl.querySelectorAll<HTMLElement>('.bsp-day').forEach(cell => {
      cell.addEventListener('click', () => {
        const d   = parseInt(cell.dataset['day'] ?? '0');
        const pad = (n: number) => String(n).padStart(2, '0');
        const bsStr = `${_bsViewYear}/${pad(_bsViewMonth)}/${pad(d)}`;
        const iso   = bsToIso(bsStr);
        if (iso) {
          adInput.value  = iso;
          nepInput.value = bsStr.replace(/\//g, '-');
        }
        bsCalEl.hidden = true;
      });
    });
  }

  // Open calendar on input click or icon click
  [nepInput, calIcon].forEach(t => {
    t.addEventListener('click', e => {
      e.stopPropagation();
      if (bsCalEl.hidden) openBsCal();
      else bsCalEl.hidden = true;
    });
  });

  // Manual BS text entry (user types YYYY-MM-DD or YYYY/MM/DD)
  nepInput.addEventListener('change', () => {
    const raw = nepInput.value.trim().replace(/-/g, '/');
    const iso = bsToIso(raw);
    if (iso) {
      adInput.value  = iso;
      nepInput.value = raw.replace(/\//g, '-');
    } else {
      // Revert to current AD date's BS value
      nepInput.value = toBS(adInput.value || todayIso());
    }
  });

  // AD change → update BS
  adInput.addEventListener('change', () => {
    nepInput.value = toBS(adInput.value || todayIso());
    // If calendar is open, refresh it
    if (!bsCalEl.hidden) renderBsMonth();
  });

  // Close calendar on outside click
  document.addEventListener('click', () => { bsCalEl.hidden = true; }, { capture: true });
  bsCalEl.addEventListener('click', e => e.stopPropagation());

  // ── Load cost centres ──────────────────────────────────────────────────────

  try {
    const rows = await rpc<any[]>('cc_list', { ...ctx(), p_include_inactive: false });
    ccRows = (rows ?? []).map((r: any) => ({ code: r.code, name: r.name }));
  } catch { /* optional, non-fatal */ }

  // ── Edit mode: load existing voucher ──────────────────────────────────────

  if (isEdit) {
    try {
      showAlert(el, 'Loading…', 'info');
      const v = await rpc<any>('get_voucher', { ...ctx(), p_head_id: headId });
      hideAlert(el);

      const adDate = (v.voucher_date ?? '').slice(0, 10);
      setVal(el, '#vf-tran-type',   v.tran_type   ?? '');
      setVal(el, '#vf-date',        adDate);
      setVal(el, '#vf-voucher-no',  v.voucher_no  ?? '');
      setVal(el, '#vf-description', v.description ?? '');
      setVal(el, '#vf-footer-note', v.footer_note ?? '');
      // Sync BS date from loaded AD date
      if (adDate) nepInput.value = toBS(adDate);

      if (Array.isArray(v.lines) && v.lines.length) {
        lines = v.lines.map((l: any) => ({
          uid:              ++_uid,
          account_no:       l.account_no       ?? '',
          account_name:     '',
          requires_party:   false,
          party_type:       l.party_type       ?? '',
          party_code:       l.party_code       ?? '',
          party_name:       '',
          description:      l.description      ?? '',
          debit:            Number(l.debit      ?? 0),
          credit:           Number(l.credit     ?? 0),
          cost_centre_code: l.cost_centre_code ?? '',
        }));
        await resolveNames(lines);
      }

      loadedStatus = v.status ?? 'unapproved';
      showStatusStrip(el, loadedStatus);

      if (loadedStatus !== 'unapproved') {
        readOnly = true;
        if (loadedStatus !== 'posted') {
          showAlert(el,
            `This voucher is <strong>${loadedStatus}</strong> — read-only. Unapprove it first to edit.`,
            'warning');
        }
      }
    } catch (err) {
      showAlert(el, `Failed to load voucher: ${err instanceof Error ? err.message : err}`, 'error');
      return;
    }
  }

  // ── Render lines + totals ──────────────────────────────────────────────────

  renderLines();
  updateTotals();

  // ── Wire header controls ───────────────────────────────────────────────────

  el.querySelector('#vf-add-line')!.addEventListener('click', () => {
    if (readOnly) return;
    lines.push(makeLine());
    renderLines();
    updateTotals();
    const inputs = el.querySelectorAll<HTMLInputElement>('.vf-acct-in');
    inputs[inputs.length - 1]?.focus();
  });

  el.querySelector('#vf-save')!.addEventListener('click', () => { if (!readOnly) handleSave(); });

  el.querySelector('#vf-new')!.addEventListener('click', () => {
    window.location.hash = '#voucher-form';
    _uid = 0;
    init(el);
  });

  // ── Post button ────────────────────────────────────────────────────────────
  // Show only for unapproved drafts when user has post permission
  if (isEdit && loadedStatus === 'unapproved' && canPost) {
    el.querySelector<HTMLElement>('#vf-post')!.hidden      = false;
    el.querySelector<HTMLElement>('#vf-post-hint')!.hidden = false;
  }

  el.querySelector<HTMLButtonElement>('#vf-post')!.addEventListener('click', async () => {
    if (!headId) return;
    const ok = confirm(
      'Post this voucher?\n\nA permanent number will be assigned and it cannot be edited afterwards.'
    );
    if (!ok) return;
    const postBtn = el.querySelector<HTMLButtonElement>('#vf-post')!;
    postBtn.disabled    = true;
    postBtn.textContent = 'Posting…';
    try {
      const result = await postVoucher(headId);
      (el.querySelector('#vf-voucher-no') as HTMLInputElement).value = result?.voucher_no ?? '';
      showStatusStrip(el, 'posted');
      showAlert(el, `Posted as <strong>${result?.voucher_no}</strong>`, 'success');
      postBtn.hidden = true;
      el.querySelector<HTMLElement>('#vf-post-hint')!.hidden = true;
      // Lock the whole form — voucher is now immutable
      readOnly = true;
      el.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>(
        '#vf-save, #vf-add-line, #vf-tran-type, #vf-date, #vf-date-nep, #vf-description, #vf-footer-note'
      ).forEach(e => { e.disabled = true; });
      el.querySelectorAll<HTMLButtonElement>('.vf-del').forEach(b => { b.hidden = true; });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Post failed');
      postBtn.disabled    = false;
      postBtn.textContent = 'Post Voucher';
    }
  });

  if (readOnly) {
    el.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>(
      '#vf-save, #vf-add-line, #vf-tran-type, #vf-date, #vf-date-nep, #vf-description, #vf-footer-note'
    ).forEach(e => { e.disabled = true; });
  }

  // ── Render lines table ─────────────────────────────────────────────────────

  function renderLines(): void {
    const wrap = el.querySelector<HTMLElement>('#vf-lines-wrap')!;
    wrap.innerHTML = `
      <table class="data-table" style="min-width:860px;table-layout:fixed">
        <colgroup>
          <col style="width:200px">
          <col style="width:160px">
          <col style="width:200px">
          <col style="width:110px">
          <col style="width:110px">
          <col style="width:140px">
          <col style="width:36px">
        </colgroup>
        <thead>
          <tr>
            <th style="font-size:.85rem;font-weight:700">Account</th>
            <th style="font-size:.85rem;font-weight:700">Party</th>
            <th style="font-size:.85rem;font-weight:700">Line Description</th>
            <th style="text-align:right;font-size:.85rem;font-weight:700">Debit</th>
            <th style="text-align:right;font-size:.85rem;font-weight:700">Credit</th>
            <th style="font-size:.85rem;font-weight:700">Cost Centre</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${lines.map(l => rowHtml(l)).join('')}
        </tbody>
        <tfoot>
          <tr style="border-top:2px solid var(--border);background:var(--bg)">
            <td colspan="3"
              style="text-align:right;font-weight:600;color:var(--muted);
                     font-size:.8rem;padding:6px 8px">Column Totals</td>
            <td id="vf-col-dr"
              style="text-align:right;font-family:monospace;font-weight:700;
                     font-size:.9rem;padding:6px 8px;color:var(--text)">0.00</td>
            <td id="vf-col-cr"
              style="text-align:right;font-family:monospace;font-weight:700;
                     font-size:.9rem;padding:6px 8px;color:var(--text)">0.00</td>
            <td colspan="2"></td>
          </tr>
        </tfoot>
      </table>
    `;
    lines.forEach(l => wireRow(l));
  }

  function rowHtml(l: LineState): string {
    const inputStyle = `
      width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:5px;
      padding:5px 7px;font-size:.82rem;background:var(--surface);color:var(--text)`;
    const drVal = l.debit  ? l.debit.toString()  : '';
    const crVal = l.credit ? l.credit.toString() : '';

    return `
    <tr data-uid="${l.uid}">

      <!-- Account -->
      <td style="padding:6px 8px;vertical-align:top">
        <div style="position:relative">
          <input class="vf-acct-in" data-uid="${l.uid}" type="text"
            value="${escHtml(l.account_no)}" placeholder="code or name"
            ${readOnly ? 'readonly' : ''}
            style="${inputStyle}" />
          <div class="vf-acct-drop" data-uid="${l.uid}" hidden
            style="position:absolute;top:100%;left:0;right:0;z-index:200;
              background:var(--surface);border:1px solid var(--border);border-radius:5px;
              box-shadow:0 4px 14px rgba(0,0,0,.14);max-height:200px;overflow-y:auto"></div>
        </div>
        <div class="vf-acct-name" data-uid="${l.uid}"
          style="font-size:.72rem;color:var(--muted);margin-top:3px;min-height:14px;
                 white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${escHtml(l.account_name)}
        </div>
      </td>

      <!-- Party -->
      <td style="padding:6px 8px;vertical-align:top">
        ${l.requires_party ? `
          <div style="position:relative">
            <input class="vf-party-in" data-uid="${l.uid}" type="text"
              value="${escHtml(l.party_code)}" placeholder="code or name"
              ${readOnly ? 'readonly' : ''}
              style="${inputStyle}" />
            <div class="vf-party-drop" data-uid="${l.uid}" hidden
              style="position:absolute;top:100%;left:0;right:0;z-index:200;
                background:var(--surface);border:1px solid var(--border);border-radius:5px;
                box-shadow:0 4px 14px rgba(0,0,0,.14);max-height:180px;overflow-y:auto"></div>
          </div>
          <div class="vf-party-name" data-uid="${l.uid}"
            style="font-size:.72rem;color:var(--muted);margin-top:3px;min-height:14px;
                   white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${escHtml(l.party_name)}
          </div>
        ` : `<span style="color:var(--muted);font-size:.85rem;line-height:2">—</span>`}
      </td>

      <!-- Line Description -->
      <td style="padding:6px 8px;vertical-align:top">
        <textarea class="vf-desc" data-uid="${l.uid}" rows="2"
          placeholder="description" ${readOnly ? 'readonly' : ''}
          style="${inputStyle}resize:vertical;">${escHtml(l.description)}</textarea>
      </td>

      <!-- Debit -->
      <td style="padding:6px 8px;vertical-align:top">
        <input class="vf-dr" data-uid="${l.uid}" type="number" min="0" step="0.01"
          value="${drVal}" placeholder="0.00"
          ${readOnly ? 'readonly' : ''}
          style="${inputStyle}text-align:right;font-family:monospace" />
      </td>

      <!-- Credit -->
      <td style="padding:6px 8px;vertical-align:top">
        <input class="vf-cr" data-uid="${l.uid}" type="number" min="0" step="0.01"
          value="${crVal}" placeholder="0.00"
          ${readOnly ? 'readonly' : ''}
          style="${inputStyle}text-align:right;font-family:monospace" />
      </td>

      <!-- Cost Centre -->
      <td style="padding:6px 8px;vertical-align:top">
        <div style="position:relative">
          <input class="vf-cc-in" data-uid="${l.uid}" type="text"
            value="${escHtml(l.cost_centre_code)}" placeholder="optional"
            ${readOnly ? 'readonly' : ''}
            style="${inputStyle}" />
          <div class="vf-cc-drop" data-uid="${l.uid}" hidden
            style="position:absolute;top:100%;left:0;right:0;z-index:200;
              background:var(--surface);border:1px solid var(--border);border-radius:5px;
              box-shadow:0 4px 14px rgba(0,0,0,.14);max-height:160px;overflow-y:auto"></div>
        </div>
      </td>

      <!-- Delete -->
      <td style="padding:6px 4px;vertical-align:top;text-align:center">
        ${!readOnly ? `
          <button class="vf-del" data-uid="${l.uid}"
            style="background:none;border:none;cursor:pointer;color:#EF4444;
                   font-size:1.3rem;line-height:1;padding:3px 5px"
            title="Remove line">×</button>
        ` : ''}
      </td>
    </tr>`;
  }

  // ── Wire a single row ──────────────────────────────────────────────────────

  function wireRow(line: LineState): void {
    const uid = line.uid;
    const row = el.querySelector<HTMLElement>(`tr[data-uid="${uid}"]`);
    if (!row || readOnly) return;

    // Account typeahead
    const acctIn   = row.querySelector<HTMLInputElement>('.vf-acct-in')!;
    const acctDrop = row.querySelector<HTMLElement>('.vf-acct-drop')!;
    let acctTimer: ReturnType<typeof setTimeout>;

    acctIn.addEventListener('input', () => {
      clearTimeout(acctTimer);
      const term = acctIn.value.trim();
      if (!term) { acctDrop.hidden = true; return; }
      acctTimer = setTimeout(() => fetchAcctDrop(line, acctIn, acctDrop, term), 280);
    });
    acctIn.addEventListener('focus', () => {
      const term = acctIn.value.trim();
      if (term) fetchAcctDrop(line, acctIn, acctDrop, term);
    });
    acctIn.addEventListener('blur', () => {
      setTimeout(() => { acctDrop.hidden = true; }, 200);
    });

    // Party typeahead (if shown)
    const partyIn   = row.querySelector<HTMLInputElement>('.vf-party-in');
    const partyDrop = row.querySelector<HTMLElement>('.vf-party-drop');
    if (partyIn && partyDrop) {
      let partyTimer: ReturnType<typeof setTimeout>;
      partyIn.addEventListener('input', () => {
        clearTimeout(partyTimer);
        partyTimer = setTimeout(() => fetchPartyDrop(line, partyIn, partyDrop, partyIn.value.trim()), 280);
      });
      partyIn.addEventListener('focus', () => fetchPartyDrop(line, partyIn, partyDrop, partyIn.value.trim()));
      partyIn.addEventListener('blur',  () => { setTimeout(() => { partyDrop.hidden = true; }, 200); });
    }

    // Line description
    row.querySelector<HTMLTextAreaElement>('.vf-desc')!.addEventListener('input', e => {
      line.description = (e.target as HTMLTextAreaElement).value;
    });

    // Debit — clears credit if nonzero (mutual exclusion)
    const drInput = row.querySelector<HTMLInputElement>('.vf-dr')!;
    const crInput = row.querySelector<HTMLInputElement>('.vf-cr')!;

    drInput.addEventListener('input', () => {
      line.debit = parseFloat(drInput.value) || 0;
      if (line.debit !== 0 && line.credit !== 0) {
        line.credit  = 0;
        crInput.value = '';
      }
      updateTotals();
    });

    crInput.addEventListener('input', () => {
      line.credit = parseFloat(crInput.value) || 0;
      if (line.credit !== 0 && line.debit !== 0) {
        line.debit   = 0;
        drInput.value = '';
      }
      updateTotals();
    });

    // Cost centre typeahead
    const ccIn   = row.querySelector<HTMLInputElement>('.vf-cc-in')!;
    const ccDrop = row.querySelector<HTMLElement>('.vf-cc-drop')!;
    ccIn.addEventListener('input', () => {
      line.cost_centre_code = ccIn.value.trim().toUpperCase();
      ccIn.value = line.cost_centre_code;
      showCcDrop(line, ccIn, ccDrop, ccIn.value.toLowerCase());
    });
    ccIn.addEventListener('focus', () => showCcDrop(line, ccIn, ccDrop, ccIn.value.trim().toLowerCase()));
    ccIn.addEventListener('blur',  () => { setTimeout(() => { ccDrop.hidden = true; }, 200); });

    // Delete row
    row.querySelector<HTMLButtonElement>('.vf-del')?.addEventListener('click', () => {
      if (lines.length <= 1) { alert('At least one line is required.'); return; }
      lines = lines.filter(l => l.uid !== uid);
      renderLines();
      updateTotals();
    });
  }

  // ── Account typeahead ──────────────────────────────────────────────────────

  async function fetchAcctDrop(
    line: LineState, input: HTMLInputElement, drop: HTMLElement, term: string
  ): Promise<void> {
    try {
      const result = await lookupData('accounts', term);
      if (!result.rows.length) { drop.hidden = true; return; }
      drop.innerHTML = result.rows.map(r => {
        const req   = r.row['requires_party'] as boolean;
        const ptype = r.row['party_type'] as string ?? '';
        return `<div class="vf-di" data-v="${escAttr(r.value)}" data-l="${escAttr(r.label)}"
          data-req="${req}" data-pt="${escAttr(ptype)}"
          style="padding:6px 10px;cursor:pointer;font-size:.82rem;
                 border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center">
          <span style="font-family:monospace;font-weight:600;color:var(--text);flex-shrink:0">${escHtml(r.value)}</span>
          <span style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.label)}</span>
        </div>`;
      }).join('');
      drop.hidden = false;

      drop.querySelectorAll<HTMLElement>('.vf-di').forEach(item => {
        item.addEventListener('mouseenter', () => item.style.background = 'var(--border)');
        item.addEventListener('mouseleave', () => item.style.background = '');
        item.addEventListener('mousedown', () => {
          const prevReq       = line.requires_party;
          line.account_no     = item.dataset['v']!;
          line.account_name   = item.dataset['l']!;
          line.requires_party = item.dataset['req'] === 'true';
          line.party_type     = item.dataset['pt'] ?? '';
          if (!line.requires_party) { line.party_code = ''; line.party_name = ''; }
          input.value = line.account_no;
          drop.hidden = true;
          if (prevReq !== line.requires_party) {
            renderLines();
            updateTotals();
          } else {
            const nameEl = el.querySelector<HTMLElement>(`.vf-acct-name[data-uid="${line.uid}"]`);
            if (nameEl) nameEl.textContent = line.account_name;
          }
        });
      });
    } catch { drop.hidden = true; }
  }

  // ── Party typeahead ────────────────────────────────────────────────────────

  async function fetchPartyDrop(
    line: LineState, input: HTMLInputElement, drop: HTMLElement, term: string
  ): Promise<void> {
    if (!line.account_no) { drop.hidden = true; return; }
    try {
      const result = await lookupData('parties_by_account', term, `control=eq.${line.account_no}`);
      if (!result.rows.length) { drop.hidden = true; return; }
      drop.innerHTML = result.rows.map(r =>
        `<div class="vf-di" data-v="${escAttr(r.value)}" data-l="${escAttr(r.label)}"
          style="padding:6px 10px;cursor:pointer;font-size:.82rem;
                 border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center">
          <span style="font-family:monospace;font-weight:600;flex-shrink:0">${escHtml(r.value)}</span>
          <span style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.label)}</span>
        </div>`
      ).join('');
      drop.hidden = false;
      drop.querySelectorAll<HTMLElement>('.vf-di').forEach(item => {
        item.addEventListener('mouseenter', () => item.style.background = 'var(--border)');
        item.addEventListener('mouseleave', () => item.style.background = '');
        item.addEventListener('mousedown', () => {
          line.party_code = item.dataset['v']!;
          line.party_name = item.dataset['l']!;
          input.value = line.party_code;
          drop.hidden = true;
          const nameEl = el.querySelector<HTMLElement>(`.vf-party-name[data-uid="${line.uid}"]`);
          if (nameEl) nameEl.textContent = line.party_name;
        });
      });
    } catch { drop.hidden = true; }
  }

  // ── Cost centre dropdown ───────────────────────────────────────────────────

  function showCcDrop(line: LineState, input: HTMLInputElement, drop: HTMLElement, term: string): void {
    const matches = ccRows.filter(c =>
      !term || c.code.toLowerCase().includes(term) || c.name.toLowerCase().includes(term)
    ).slice(0, 15);
    if (!matches.length) { drop.hidden = true; return; }
    drop.innerHTML = matches.map(c =>
      `<div class="vf-di" data-code="${escAttr(c.code)}"
        style="padding:6px 10px;cursor:pointer;font-size:.82rem;
               border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center">
        <span style="font-family:monospace;font-weight:600;flex-shrink:0">${escHtml(c.code)}</span>
        <span style="color:var(--muted)">${escHtml(c.name)}</span>
      </div>`
    ).join('');
    drop.hidden = false;
    drop.querySelectorAll<HTMLElement>('.vf-di').forEach(item => {
      item.addEventListener('mouseenter', () => item.style.background = 'var(--border)');
      item.addEventListener('mouseleave', () => item.style.background = '');
      item.addEventListener('mousedown', () => {
        line.cost_centre_code = item.dataset['code']!;
        input.value = line.cost_centre_code;
        drop.hidden = true;
      });
    });
  }

  // ── Resolve account + party names for edit mode ────────────────────────────

  async function resolveNames(ls: LineState[]): Promise<void> {
    const codes = [...new Set(ls.map(l => l.account_no).filter(Boolean))];
    await Promise.allSettled(codes.map(async code => {
      const res = await lookupData('accounts', code);
      const match = res.rows.find(r => r.value === code);
      if (match) {
        ls.forEach(l => {
          if (l.account_no !== code) return;
          l.account_name   = match.label;
          l.requires_party = (match.row['requires_party'] as boolean) ?? false;
          l.party_type     = (match.row['party_type'] as string) ?? '';
        });
      }
    }));
    await Promise.allSettled(ls.filter(l => l.party_code && l.account_no).map(async l => {
      const res = await lookupData('parties_by_account', l.party_code, `control=eq.${l.account_no}`);
      const match = res.rows.find(r => r.value === l.party_code);
      if (match) l.party_name = match.label;
    }));
  }

  // ── Live totals — updates tfoot column cells + balance indicator ───────────

  function updateTotals(): void {
    const dr   = lines.reduce((s, l) => s + (l.debit  || 0), 0);
    const cr   = lines.reduce((s, l) => s + (l.credit || 0), 0);
    const diff = dr - cr;

    const colDrEl = el.querySelector<HTMLElement>('#vf-col-dr');
    const colCrEl = el.querySelector<HTMLElement>('#vf-col-cr');
    if (colDrEl) colDrEl.textContent = fmt(dr);
    if (colCrEl) colCrEl.textContent = fmt(cr);

    const balEl = el.querySelector<HTMLElement>('#vf-balance')!;
    if (Math.abs(diff) < 0.005) {
      balEl.textContent  = 'Balanced ✓';
      balEl.style.color  = '#059669';
    } else {
      const sign = diff > 0 ? 'Dr>' : 'Cr>';
      balEl.textContent  = `Unbalanced  ${sign}  Diff: ${fmt(Math.abs(diff))}`;
      balEl.style.color  = '#DC2626';
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  async function handleSave(): Promise<void> {
    if (saving) return;
    const ttype = (el.querySelector<HTMLSelectElement>('#vf-tran-type')!).value;
    if (!ttype) { alert('Please select a transaction type.'); return; }

    const validLines = lines.filter(l => l.account_no.trim());
    if (!validLines.length) { alert('At least one line with an account is required.'); return; }

    const dr = validLines.reduce((s, l) => s + (l.debit  || 0), 0);
    const cr = validLines.reduce((s, l) => s + (l.credit || 0), 0);
    if (Math.abs(dr - cr) >= 0.005) {
      alert(`Voucher does not balance.\nDebit: ${fmt(dr)}  Credit: ${fmt(cr)}  Diff: ${fmt(dr - cr)}`);
      return;
    }

    saving = true;
    const saveBtn = el.querySelector<HTMLButtonElement>('#vf-save')!;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    const { p_tenant, p_caller } = ctx();
    const payload = {
      tenant:           p_tenant,
      caller:           p_caller,
      id:               isEdit ? headId : null,
      tran_type:        ttype,
      voucher_date:     (el.querySelector<HTMLInputElement>('#vf-date')!).value,
      voucher_date_nep: (el.querySelector<HTMLInputElement>('#vf-date-nep')!).value.replace(/-/g, '/'),
      description:      (el.querySelector<HTMLInputElement>('#vf-description')!).value,
      footer_note:      (el.querySelector<HTMLTextAreaElement>('#vf-footer-note')!).value,
      lines: validLines.map(l => ({
        account_no:       l.account_no,
        description:      l.description,
        debit:            l.debit  || 0,
        credit:           l.credit || 0,
        cost_centre_code: l.cost_centre_code || null,
        party_type:       l.requires_party ? (l.party_type  || null) : null,
        party_code:       l.requires_party ? (l.party_code  || null) : null,
      })),
    };

    try {
      const result = await rpc<{ id: number; voucher_no: string }>('save_voucher', { payload });
      (el.querySelector('#vf-voucher-no') as HTMLInputElement).value = result?.voucher_no ?? '';
      showAlert(el, `Saved as ${result?.voucher_no ?? 'voucher'}`, 'success');
      setTimeout(() => { window.location.hash = '#voucher-list'; }, 800);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Save failed');
    } finally {
      saving = false;
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function setVal(el: HTMLElement, sel: string, val: string): void {
  const inp = el.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(sel);
  if (inp) inp.value = val;
}

function showAlert(el: HTMLElement, html: string, type: 'info' | 'warning' | 'error' | 'success'): void {
  const a = el.querySelector<HTMLElement>('#vf-alert')!;
  const styles: Record<string, { bg: string; color: string; border: string }> = {
    info:    { bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE' },
    warning: { bg: '#FEF3C7', color: '#92400E', border: '#FDE68A' },
    error:   { bg: '#FEF2F2', color: '#991B1B', border: '#FECACA' },
    success: { bg: '#ECFDF5', color: '#065F46', border: '#A7F3D0' },
  };
  const s = styles[type]!;
  a.innerHTML          = html;
  a.style.background   = s.bg;
  a.style.color        = s.color;
  a.style.borderColor  = s.border;
  a.hidden = false;
}

function hideAlert(el: HTMLElement): void {
  const a = el.querySelector<HTMLElement>('#vf-alert');
  if (a) a.hidden = true;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showStatusStrip(el: HTMLElement, status: string): void {
  const strip = el.querySelector<HTMLElement>('#vf-status-strip');
  const badge = el.querySelector<HTMLElement>('#vf-status-badge');
  if (!strip || !badge) return;
  const cfg: Record<string, { label: string; bg: string; color: string }> = {
    unapproved: { label: 'Draft',    bg: '#FEF3C7', color: '#92400E' },
    approved:   { label: 'Approved', bg: '#DBEAFE', color: '#1E40AF' },
    posted:     { label: 'Posted',   bg: '#ECFDF5', color: '#065F46' },
  };
  const c = cfg[status] ?? { label: status, bg: 'var(--surface)', color: 'var(--text)' };
  badge.textContent   = c.label;
  badge.style.cssText = `background:${c.bg};color:${c.color};padding:2px 10px;border-radius:12px;font-weight:600;font-size:.8rem`;
  strip.hidden = false;
}
