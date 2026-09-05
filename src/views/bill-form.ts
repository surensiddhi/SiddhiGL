/**
 * bill-form.ts — Sales Bill (SB) / Purchase Bill (PB) entry.
 * Shared implementation, same pattern as pv-rv.ts: one buildView() driven
 * by a small BConfig, exported as initSaleBill / initPurchaseBill.
 *
 * Header: Payment Mode (Cash/Bank/Digital/Credit) → Cash/Bank A/c *or* Party
 * (+ due date) shows depending on mode; Date BS/AD; Narration.
 * Lines: Item (optional typeahead, auto-fills description/rate/account/taxable)
 *        or a plain GL account picked directly — "with and without inventory
 *        linking" in one row type. Qty × Rate → Amount (editable override).
 * Footer: taxable subtotal / VAT (live estimate; bill_save() computes the
 * authoritative figure server-side) / grand total.
 *
 * Posts immediately on Save via bill_save() — no approve/post workflow for
 * bills (that was the deliberate call for this module).
 *
 * NOTE: unlike voucher-form.ts / pv-rv.ts this does not (yet) have the
 * interactive BS calendar popup — Date BS is auto-synced from Date AD only.
 * Fast-follow if that consistency matters enough to add here too.
 *
 * Credit due date: auto-calculated as bill date + due-days when a party is
 * picked in Credit mode (party's own due_days if set, else the company-wide
 * default_sales_due_days / default_purchase_due_days) — still editable by hand.
 *
 * Purchase Bill lines for QTY-tracked items also capture Batch No / Expiry
 * Date (report-only, per the locked inventory design — no auto-FEFO costing).
 */

import { rpc }         from '../lib/rpc';
import { ctx }         from '../lib/session';
import { lookupData }  from '../services/lookup';
import { billSave, type BillLinePayload } from '../services/bill';
import { bsToIso } from '../lib/bs-calendar';
import { todayIso, toBS, fmt, escHtml, escAttr, q } from '../lib/ui-helpers';

interface BConfig {
  p:            string;         // DOM id prefix: 'sb' | 'pb'
  title:        string;
  billType:     'SB' | 'PB';
  partyLabel:   string;         // 'Bill To' | 'Bill From'
  acctHint:     string;         // placeholder hint for the line-account column
  acctColTitle: string;         // short column header, e.g. "Revenue Account"
  route:        string;
}

interface CompanyInfo {
  company_name: string;
  address?:     string;
  pan_no?:      string;
  phone?:       string;
  email?:       string;
}

const SB_CFG: BConfig = {
  p: 'sb', title: 'Sales Bill', billType: 'SB',
  partyLabel: 'Bill To (Customer)', acctHint: 'sales / revenue account',
  acctColTitle: 'Revenue Account', route: '#sale-bill-form',
};
const PB_CFG: BConfig = {
  p: 'pb', title: 'Purchase Bill', billType: 'PB',
  partyLabel: 'Bill From (Supplier)', acctHint: 'expense / asset account',
  acctColTitle: 'Expense Account', route: '#purchase-bill-form',
};

export const initSaleBill     = (el: HTMLElement) => buildView(el, SB_CFG);
export const initPurchaseBill = (el: HTMLElement) => buildView(el, PB_CFG);

const LBL = `font-weight:700;font-size:.875rem;color:var(--text);white-space:nowrap;padding-right:4px`;
const MODES = ['Cash', 'Bank', 'Digital', 'Credit'];

interface Line {
  uid:               number;
  item_code:         string;
  item_name:         string;
  item_locked:       boolean;   // true once an item has been picked from the list — locks item + account fields
  account_missing:   boolean;   // item picked but has no sales/purchase account configured — blocks save
  tracking_mode:     'NONE' | 'QTY' | '';
  description:       string;
  qty:               number;
  rate:              number;
  amount:            number;
  taxable:           boolean;
  account_no:        string;
  account_name:      string;
  cost_centre_code:  string;
  batch_no:          string;
  expiry_date:       string;
}

let _uid = 0;
const makeLine = (): Line => ({
  uid: ++_uid, item_code: '', item_name: '', item_locked: false, account_missing: false,
  tracking_mode: '', description: '', qty: 1, rate: 0, amount: 0,
  taxable: true, account_no: '', account_name: '', cost_centre_code: '', batch_no: '', expiry_date: '',
});

async function buildView(el: HTMLElement, cfg: BConfig): Promise<void> {
  _uid = 0;
  const { p } = cfg;

  let lines: Line[] = [makeLine()];
  let saving = false;
  let vatPct = 0;
  let defaultDueDays = 0;
  let company: CompanyInfo = { company_name: '' };
  let savedBillNo: string | null = null;

  try {
    const c = await rpc<CompanyInfo & { vat_pct?: number; default_sales_due_days?: number; default_purchase_due_days?: number }>(
      'get_company_config', ctx());
    company = c ?? { company_name: '' };
    vatPct = Number(c?.vat_pct ?? 0);
    defaultDueDays = Number((cfg.billType === 'SB' ? c?.default_sales_due_days : c?.default_purchase_due_days) ?? 0);
  } catch { /* optional */ }

  el.innerHTML = `
    <div class="page-header">
      <span class="page-title">${cfg.title}</span>
      <a href="#${p === 'sb' ? 'sale-bill-list' : 'purchase-bill-list'}" class="btn btn-secondary" style="font-size:.85rem">View List</a>
    </div>

    <div id="${p}-alert" hidden style="padding:10px 16px;border-radius:6px;margin-bottom:14px;
      font-size:.85rem;border:1px solid transparent"></div>

    <div class="card" style="padding:20px 24px">

      <div style="display:grid;grid-template-columns:max-content 1fr max-content 1fr;
                  gap:10px 20px;align-items:start;margin-bottom:18px">

        <label style="${LBL}">Payment Mode <span style="color:red">*</span></label>
        <select id="${p}-mode" class="at-select" style="width:100%">
          <option value="">-- select --</option>
          ${MODES.map(m => `<option>${m}</option>`).join('')}
        </select>

        <label style="${LBL}">Date AD <span style="color:red">*</span></label>
        <input id="${p}-date" type="date" value="${todayIso()}" />

        <label id="${p}-bank-lbl" style="${LBL}">Cash / Bank A/c <span style="color:red">*</span></label>
        <div id="${p}-bank-wrap" style="position:relative">
          <input id="${p}-bank-in" type="text" placeholder="account code or name" style="width:100%;box-sizing:border-box" />
          <div id="${p}-bank-drop" hidden style="position:absolute;top:100%;left:0;right:0;z-index:200;
            background:var(--surface);border:1px solid var(--border);border-radius:5px;
            box-shadow:0 4px 14px rgba(0,0,0,.14);max-height:200px;overflow-y:auto"></div>
          <div id="${p}-bank-name" style="font-size:.72rem;color:var(--muted);margin-top:3px;min-height:14px"></div>
        </div>

        <label style="${LBL}">Date BS</label>
        <input id="${p}-date-nep" type="text" value="${toBS(todayIso())}" placeholder="YYYY-MM-DD" />

        <label id="${p}-party-lbl" style="${LBL}">${cfg.partyLabel} <span style="color:red">*</span></label>
        <div id="${p}-party-wrap" hidden style="position:relative">
          <input id="${p}-party-in" type="text" placeholder="party code or name" style="width:100%;box-sizing:border-box" />
          <div id="${p}-party-drop" hidden style="position:absolute;top:100%;left:0;right:0;z-index:200;
            background:var(--surface);border:1px solid var(--border);border-radius:5px;
            box-shadow:0 4px 14px rgba(0,0,0,.14);max-height:220px;overflow-y:auto"></div>
          <div id="${p}-party-name" style="font-size:.72rem;color:var(--muted);margin-top:3px;min-height:14px"></div>
        </div>

        <label id="${p}-due-lbl" style="${LBL}" hidden>Due Date</label>
        <div id="${p}-due-wrap" hidden>
          <input id="${p}-due" type="date" />
          <div id="${p}-due-info" style="font-size:.72rem;margin-top:3px;min-height:14px"></div>
        </div>

      </div>

      <div class="field" style="margin-bottom:20px">
        <label style="${LBL}">Narration</label>
        <input id="${p}-narration" type="text" placeholder="Enter narration / description" style="margin-top:6px" />
      </div>

      <div id="${p}-lines-wrap" style="overflow-x:auto;margin-bottom:0;position:relative"></div>

      <div style="display:flex;justify-content:space-between;align-items:center;
                  padding:8px 0;margin-bottom:20px;border-top:1px solid var(--border)">
        <button id="${p}-add-line" class="btn btn-secondary" style="font-size:.85rem">+ Add Line</button>
        <div id="${p}-totals" style="font-family:monospace;font-size:.9rem;text-align:right;line-height:1.6"></div>
      </div>

      <div class="field" style="margin-bottom:24px">
        <label style="${LBL}">Footer Note</label>
        <textarea id="${p}-footer-note" rows="2" placeholder="Prepared by / remarks"
          style="resize:vertical;width:100%;box-sizing:border-box;margin-top:6px;
                 border:1px solid var(--border);border-radius:5px;padding:8px 10px;font-size:.875rem;
                 background:var(--surface);color:var(--text)"></textarea>
      </div>

      <div style="display:flex;gap:8px">
        <button id="${p}-save"  class="btn btn-primary">Save</button>
        <button id="${p}-print" class="btn btn-secondary">Print</button>
        <button id="${p}-new"   class="btn btn-secondary">New / Clear</button>
      </div>
    </div>
  `;

  const modeEl     = q<HTMLSelectElement>(el, `#${p}-mode`);
  const bankLblEl  = q<HTMLElement>(el,       `#${p}-bank-lbl`);
  const bankWrapEl = q<HTMLElement>(el,       `#${p}-bank-wrap`);
  const bankInEl   = q<HTMLInputElement>(el,  `#${p}-bank-in`);
  const bankDropEl = q<HTMLElement>(el,       `#${p}-bank-drop`);
  const bankNameEl = q<HTMLElement>(el,       `#${p}-bank-name`);
  const partyLblEl = q<HTMLElement>(el,       `#${p}-party-lbl`);
  const partyWrapEl= q<HTMLElement>(el,       `#${p}-party-wrap`);
  const partyInEl  = q<HTMLInputElement>(el,  `#${p}-party-in`);
  const partyDropEl= q<HTMLElement>(el,       `#${p}-party-drop`);
  const partyNameEl= q<HTMLElement>(el,       `#${p}-party-name`);
  const dueLblEl   = q<HTMLElement>(el,       `#${p}-due-lbl`);
  const dueWrapEl  = q<HTMLElement>(el,       `#${p}-due-wrap`);
  const dueEl      = q<HTMLInputElement>(el,  `#${p}-due`);
  const dueInfoEl  = q<HTMLElement>(el,       `#${p}-due-info`);
  const nepInput   = q<HTMLInputElement>(el,  `#${p}-date-nep`);
  const adInput    = q<HTMLInputElement>(el,  `#${p}-date`);

  let selectedParty: { type: string; code: string; name: string; due_days: number | null; mobile: string; tax_number: string } | null = null;

  function recalcDueDate(): void {
    if (modeEl.value !== 'Credit') return;
    const days = selectedParty?.due_days ?? defaultDueDays;
    const base = adInput.value || todayIso();
    const d = new Date(base);
    d.setDate(d.getDate() + (Number(days) || 0));
    dueEl.value = d.toISOString().slice(0, 10);
    updateDueInfo();
  }

  /** Shows the credit term as "X days" with a ±10% tolerance check against the
   *  party's own due_days (or the company default) — flags when the actual
   *  due date drifts outside that band, e.g. if the user hand-edits it. */
  function updateDueInfo(): void {
    if (modeEl.value !== 'Credit' || !dueEl.value) { dueInfoEl.textContent = ''; return; }
    const base = adInput.value || todayIso();
    const msPerDay = 86400000;
    const actualDays = Math.round((new Date(dueEl.value).getTime() - new Date(base).getTime()) / msPerDay);
    const expected = Number(selectedParty?.due_days ?? defaultDueDays) || 0;
    if (expected <= 0) {
      dueInfoEl.style.color = 'var(--muted)';
      dueInfoEl.textContent = `${actualDays} day${actualDays === 1 ? '' : 's'} credit`;
      return;
    }
    const low = expected * 0.9, high = expected * 1.1;
    const within = actualDays >= low && actualDays <= high;
    dueInfoEl.style.color = within ? '#059669' : '#D97706';
    dueInfoEl.textContent = within
      ? `${actualDays} days credit (term: ${expected} days)`
      : `${actualDays} days credit — outside normal term of ${expected} days (±10%: ${Math.round(low)}–${Math.round(high)})`;
  }
  dueEl.addEventListener('change', updateDueInfo);

  adInput.addEventListener('change', () => { nepInput.value = toBS(adInput.value || todayIso()); recalcDueDate(); });
  nepInput.addEventListener('change', () => {
    const iso = bsToIso(nepInput.value.trim().replace(/-/g, '/'));
    if (iso) adInput.value = iso;
  });

  // ── Payment mode toggling ──
  function updateModeUI(): void {
    const mode = modeEl.value;
    const isCredit = mode === 'Credit';
    bankWrapEl.hidden  = isCredit;
    bankLblEl.hidden   = isCredit;
    partyWrapEl.hidden = !isCredit;
    partyLblEl.hidden  = !isCredit;
    dueLblEl.hidden    = !isCredit;
    dueWrapEl.hidden   = !isCredit;
    const modeMap: Record<string, string> = { Bank: 'Bank Account', Digital: 'Digital A/c' };
    bankLblEl.innerHTML = (modeMap[mode] ?? 'Cash / Bank A/c') + ' <span style="color:red">*</span>';
    if (isCredit) recalcDueDate(); else updateDueInfo();
  }
  modeEl.addEventListener('change', updateModeUI);
  updateModeUI();

  // ── Bank account typeahead ──
  let bankTimer: ReturnType<typeof setTimeout>;
  bankInEl.addEventListener('input', () => {
    clearTimeout(bankTimer);
    bankTimer = setTimeout(() => fetchBankDrop(bankInEl.value.trim()), 250);
  });
  bankInEl.addEventListener('focus', () => fetchBankDrop(bankInEl.value.trim()));
  bankInEl.addEventListener('blur',  () => { setTimeout(() => { bankDropEl.hidden = true; }, 200); });

  async function fetchBankDrop(term: string): Promise<void> {
    try {
      const res = await lookupData('accounts', term);
      if (!res.rows.length) { bankDropEl.hidden = true; return; }
      bankDropEl.innerHTML = res.rows.map(r => rowHtmlDrop(r.value, r.label)).join('');
      showDropAt(bankInEl, bankDropEl);
      wireDropClicks(bankDropEl, (v, l) => {
        bankInEl.value = v; bankNameEl.textContent = l; bankDropEl.hidden = true;
      });
    } catch { bankDropEl.hidden = true; }
  }

  // ── Party typeahead ──
  let partyTimer: ReturnType<typeof setTimeout>;
  partyInEl.addEventListener('input', () => {
    clearTimeout(partyTimer);
    partyTimer = setTimeout(() => fetchPartyDrop(partyInEl.value.trim()), 250);
  });
  partyInEl.addEventListener('focus', () => fetchPartyDrop(partyInEl.value.trim()));
  partyInEl.addEventListener('blur',  () => { setTimeout(() => { partyDropEl.hidden = true; }, 200); });

  async function fetchPartyDrop(term: string): Promise<void> {
    try {
      const rows = await rpc<any[]>('list_parties', { ...ctx(), p_party_type: null, p_status: 'active', p_term: term || null });
      if (!rows?.length) { partyDropEl.hidden = true; return; }
      partyDropEl.innerHTML = rows.map(r => `
        <div class="${p}-pdi" data-code="${escAttr(r.party_code ?? '')}" data-name="${escAttr(r.party_name ?? '')}"
          data-type="${escAttr(r.party_type ?? '')}" data-due="${escAttr(String(r.due_days ?? ''))}"
          data-mobile="${escAttr(r.mobile ?? '')}" data-tax="${escAttr(r.tax_number ?? '')}"
          style="padding:6px 10px;cursor:pointer;font-size:.82rem;border-bottom:1px solid var(--border);
                 display:flex;gap:8px;align-items:center">
          <span style="font-family:monospace;font-weight:600;flex-shrink:0">${escHtml(r.party_code ?? '')}</span>
          <span style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.party_name ?? '')}</span>
          <span style="font-size:.7rem;color:var(--muted);flex-shrink:0;margin-left:auto">${escHtml(r.party_type ?? '')}</span>
        </div>`).join('');
      showDropAt(partyInEl, partyDropEl);
      partyDropEl.querySelectorAll<HTMLElement>(`.${p}-pdi`).forEach(item => {
        item.addEventListener('mouseenter', () => item.style.background = 'var(--border)');
        item.addEventListener('mouseleave', () => item.style.background = '');
        item.addEventListener('mousedown', () => {
          const code = item.dataset['code']!, name = item.dataset['name']!, type = item.dataset['type']!;
          const dueRaw = item.dataset['due'];
          partyInEl.value = code;
          partyNameEl.textContent = name + (type ? `  (${type})` : '');
          selectedParty = {
            type, code, name, due_days: dueRaw ? Number(dueRaw) : null,
            mobile: item.dataset['mobile'] ?? '', tax_number: item.dataset['tax'] ?? '',
          };
          partyDropEl.hidden = true;
          recalcDueDate();
        });
      });
    } catch { partyDropEl.hidden = true; }
  }

  /** Opens a dropdown as position:fixed, sized/placed off the trigger input's
   *  own bounding rect. The line-items table sits inside a horizontally
   *  scrolling wrapper (overflow-x:auto), and per the CSS overflow spec a
   *  scroll container with overflow-x set forces overflow-y to 'auto' too —
   *  so a position:absolute dropdown gets silently clipped there. Fixed
   *  positioning escapes that clipping entirely. */
  function showDropAt(input: HTMLInputElement, drop: HTMLElement): void {
    const r = input.getBoundingClientRect();
    drop.style.position = 'fixed';
    drop.style.top   = `${r.bottom + 2}px`;
    drop.style.left  = `${r.left}px`;
    drop.style.width = `${r.width}px`;
    drop.style.right = 'auto';
    drop.hidden = false;
  }

  function rowHtmlDrop(v: string, l: string): string {
    return `<div class="${p}-ddi" data-v="${escAttr(v)}" data-l="${escAttr(l)}"
      style="padding:6px 10px;cursor:pointer;font-size:.82rem;border-bottom:1px solid var(--border);
             display:flex;gap:8px;align-items:center">
      <span style="font-family:monospace;font-weight:600;flex-shrink:0">${escHtml(v)}</span>
      <span style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(l)}</span>
    </div>`;
  }
  function wireDropClicks(dropEl: HTMLElement, onPick: (v: string, l: string) => void): void {
    dropEl.querySelectorAll<HTMLElement>(`.${p}-ddi`).forEach(item => {
      item.addEventListener('mouseenter', () => item.style.background = 'var(--border)');
      item.addEventListener('mouseleave', () => item.style.background = '');
      item.addEventListener('mousedown', () => onPick(item.dataset['v']!, item.dataset['l']!));
    });
  }

  // ── Lines ──
  const IN_STYLE = `width:100%;box-sizing:border-box;border:1px solid var(--border);
    border-radius:5px;padding:5px 7px;font-size:.82rem;background:var(--surface);color:var(--text)`;
  const showBatch = cfg.billType === 'PB';

  renderLines();
  updateTotals();

  q(el, `#${p}-add-line`).addEventListener('click', () => {
    lines.push(makeLine());
    renderLines(); updateTotals();
    const inputs = Array.from(el.querySelectorAll<HTMLInputElement>(`.${p}-item-in`));
    inputs[inputs.length - 1]?.focus();
  });

  q(el, `#${p}-save`).addEventListener('click', handleSave);
  q(el, `#${p}-print`).addEventListener('click', printInvoice);
  q(el, `#${p}-new`).addEventListener('click', () => { _uid = 0; buildView(el, cfg); });

  function renderLines(): void {
    const wrap = q<HTMLElement>(el, `#${p}-lines-wrap`);
    wrap.innerHTML = `
      <table class="data-table" style="min-width:${showBatch ? 1200 : 980}px;table-layout:fixed">
        <colgroup>
          <col style="width:160px"><col style="width:180px"><col style="width:65px">
          <col style="width:95px"><col style="width:105px"><col style="width:55px">
          <col style="width:130px"><col style="width:100px">
          ${showBatch ? `<col style="width:110px"><col style="width:120px">` : ''}
          <col style="width:36px">
        </colgroup>
        <thead>
          <tr>
            <th style="font-size:.85rem;font-weight:700">Item</th>
            <th style="font-size:.85rem;font-weight:700">Description</th>
            <th style="text-align:right;font-size:.85rem;font-weight:700">Qty</th>
            <th style="text-align:right;font-size:.85rem;font-weight:700">Rate</th>
            <th style="text-align:right;font-size:.85rem;font-weight:700">Amount</th>
            <th style="text-align:center;font-size:.85rem;font-weight:700">VAT</th>
            <th style="font-size:.85rem;font-weight:700">${cfg.acctColTitle}</th>
            <th style="font-size:.85rem;font-weight:700">Cost Centre</th>
            ${showBatch ? `
            <th style="font-size:.85rem;font-weight:700">Batch No</th>
            <th style="font-size:.85rem;font-weight:700">Expiry Date</th>` : ''}
            <th></th>
          </tr>
        </thead>
        <tbody>${lines.map(l => rowHtml(l)).join('')}</tbody>
      </table>`;
    lines.forEach(l => wireRow(l));
  }

  function rowHtml(l: Line): string {
    return `
    <tr data-uid="${l.uid}">
      <td style="padding:6px 8px;vertical-align:top;position:relative">
        <div style="display:flex;gap:4px;align-items:center">
          <input class="${p}-item-in" data-uid="${l.uid}" type="text"
            value="${l.item_locked ? escHtml(`${l.item_code} — ${l.item_name}`) : escHtml(l.item_code)}"
            placeholder="item code or name" ${l.item_locked ? 'readonly' : ''}
            style="${IN_STYLE}${l.item_locked ? 'background:var(--border);cursor:default' : ''}" />
          ${l.item_locked
            ? `<button class="${p}-item-clear" data-uid="${l.uid}" type="button" title="Change item"
                 style="background:none;border:none;cursor:pointer;color:#EF4444;font-size:1rem;
                        line-height:1;padding:3px 4px;flex-shrink:0">×</button>`
            : ''}
        </div>
        <div class="${p}-item-drop" data-uid="${l.uid}" hidden style="position:absolute;top:100%;left:0;right:0;z-index:200;
          background:var(--surface);border:1px solid var(--border);border-radius:5px;
          box-shadow:0 4px 14px rgba(0,0,0,.14);max-height:200px;overflow-y:auto"></div>
      </td>
      <td style="padding:6px 8px;vertical-align:top">
        <input class="${p}-desc" data-uid="${l.uid}" type="text" value="${escHtml(l.description)}"
          placeholder="description" style="${IN_STYLE}" />
      </td>
      <td style="padding:6px 8px;vertical-align:top">
        <input class="${p}-qty" data-uid="${l.uid}" type="number" min="0" step="0.01" value="${l.qty}"
          style="${IN_STYLE}text-align:right;font-family:monospace" />
      </td>
      <td style="padding:6px 8px;vertical-align:top">
        <input class="${p}-rate" data-uid="${l.uid}" type="number" min="0" step="0.01" value="${l.rate}"
          style="${IN_STYLE}text-align:right;font-family:monospace" />
      </td>
      <td style="padding:6px 8px;vertical-align:top">
        <input class="${p}-amt" data-uid="${l.uid}" type="number" min="0" step="0.01" value="${l.amount.toFixed(2)}"
          style="${IN_STYLE}text-align:right;font-family:monospace" />
      </td>
      <td style="padding:6px 8px;vertical-align:top;text-align:center">
        <input class="${p}-tax" data-uid="${l.uid}" type="checkbox" ${l.taxable ? 'checked' : ''} style="margin-top:8px" />
      </td>
      <td style="padding:6px 8px;vertical-align:top;position:relative">
        <input class="${p}-acct-in" data-uid="${l.uid}" type="text" value="${escHtml(l.account_no)}"
          placeholder="code or name" ${l.item_locked ? 'readonly' : ''}
          style="${IN_STYLE}${l.item_locked ? 'background:var(--border);cursor:default' : ''}" />
        <div class="${p}-acct-drop" data-uid="${l.uid}" hidden style="position:absolute;top:100%;left:0;right:0;z-index:200;
          background:var(--surface);border:1px solid var(--border);border-radius:5px;
          box-shadow:0 4px 14px rgba(0,0,0,.14);max-height:200px;overflow-y:auto"></div>
        <div class="${p}-acct-name" data-uid="${l.uid}" style="font-size:.7rem;color:var(--muted);margin-top:2px;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(l.account_name)}</div>
        ${l.account_missing
          ? `<div style="font-size:.68rem;color:#DC2626;margin-top:2px">
               ⚠ No ${cfg.billType === 'SB' ? 'sales' : 'purchase'} account set for this item — fix in Item Master</div>`
          : ''}
      </td>
      <td style="padding:6px 8px;vertical-align:top;position:relative">
        <input class="${p}-cc" data-uid="${l.uid}" type="text" value="${escHtml(l.cost_centre_code)}"
          placeholder="optional" style="${IN_STYLE}" />
        <div class="${p}-cc-drop" data-uid="${l.uid}" hidden style="position:absolute;top:100%;left:0;right:0;z-index:200;
          background:var(--surface);border:1px solid var(--border);border-radius:5px;
          box-shadow:0 4px 14px rgba(0,0,0,.14);max-height:200px;overflow-y:auto"></div>
      </td>
      ${showBatch ? `
      <td style="padding:6px 8px;vertical-align:top">
        <input class="${p}-batch" data-uid="${l.uid}" type="text" value="${escHtml(l.batch_no)}"
          placeholder="${l.tracking_mode === 'QTY' ? 'optional' : '—'}" ${l.tracking_mode !== 'QTY' ? 'disabled' : ''}
          style="${IN_STYLE}" />
      </td>
      <td style="padding:6px 8px;vertical-align:top">
        <input class="${p}-expiry" data-uid="${l.uid}" type="date" value="${escHtml(l.expiry_date)}"
          ${l.tracking_mode !== 'QTY' ? 'disabled' : ''} style="${IN_STYLE}" />
      </td>` : ''}
      <td style="padding:6px 4px;vertical-align:top;text-align:center">
        ${lines.length > 1
          ? `<button class="${p}-del" data-uid="${l.uid}" style="background:none;border:none;cursor:pointer;
               color:#EF4444;font-size:1.3rem;line-height:1;padding:3px 5px" title="Remove">×</button>`
          : ''}
      </td>
    </tr>`;
  }

  function wireRow(line: Line): void {
    const row = el.querySelector<HTMLElement>(`tr[data-uid="${line.uid}"]`);
    if (!row) return;

    const qtyIn  = row.querySelector<HTMLInputElement>(`.${p}-qty`)!;
    const rateIn = row.querySelector<HTMLInputElement>(`.${p}-rate`)!;
    const amtIn  = row.querySelector<HTMLInputElement>(`.${p}-amt`)!;

    const recompute = () => {
      line.qty  = parseFloat(qtyIn.value)  || 0;
      line.rate = parseFloat(rateIn.value) || 0;
      line.amount = Math.round(line.qty * line.rate * 100) / 100;
      amtIn.value = line.amount.toFixed(2);
      updateTotals();
    };
    qtyIn.addEventListener('input', recompute);
    rateIn.addEventListener('input', recompute);
    amtIn.addEventListener('input', () => { line.amount = parseFloat(amtIn.value) || 0; updateTotals(); });

    row.querySelector<HTMLInputElement>(`.${p}-desc`)!.addEventListener('input', e => {
      line.description = (e.target as HTMLInputElement).value;
    });
    row.querySelector<HTMLInputElement>(`.${p}-tax`)!.addEventListener('change', e => {
      line.taxable = (e.target as HTMLInputElement).checked; updateTotals();
    });
    // Cost Centre typeahead
    const ccIn = row.querySelector<HTMLInputElement>(`.${p}-cc`)!;
    const ccDrop = row.querySelector<HTMLElement>(`.${p}-cc-drop`)!;
    let ccTimer: ReturnType<typeof setTimeout>;
    ccIn.addEventListener('input', () => {
      line.cost_centre_code = ccIn.value.trim().toUpperCase();
      clearTimeout(ccTimer);
      ccTimer = setTimeout(() => fetchCcDrop(line, ccIn, ccDrop, ccIn.value.trim()), 250);
    });
    ccIn.addEventListener('focus', () => fetchCcDrop(line, ccIn, ccDrop, ccIn.value.trim()));
    ccIn.addEventListener('blur', () => { setTimeout(() => { ccDrop.hidden = true; }, 200); });
    row.querySelector<HTMLInputElement>(`.${p}-batch`)?.addEventListener('input', e => {
      line.batch_no = (e.target as HTMLInputElement).value;
    });
    row.querySelector<HTMLInputElement>(`.${p}-expiry`)?.addEventListener('change', e => {
      line.expiry_date = (e.target as HTMLInputElement).value;
    });

    // Item pick list — only a real pick from the dropdown sets item_code (never free
    // text), so a bill line can never reference an item that doesn't exist.
    const itemIn = row.querySelector<HTMLInputElement>(`.${p}-item-in`)!;
    const itemDrop = row.querySelector<HTMLElement>(`.${p}-item-drop`)!;
    if (!line.item_locked) {
      let itTimer: ReturnType<typeof setTimeout>;
      itemIn.addEventListener('input', () => {
        clearTimeout(itTimer);
        itTimer = setTimeout(() => fetchItemDrop(line, itemIn, itemDrop, itemIn.value.trim()), 250);
      });
      itemIn.addEventListener('focus', () => fetchItemDrop(line, itemIn, itemDrop, itemIn.value.trim()));
      itemIn.addEventListener('blur', () => {
        setTimeout(() => {
          itemDrop.hidden = true;
          // Typed text that was never picked isn't a real item — clear it back out.
          if (!line.item_locked) itemIn.value = '';
        }, 200);
      });
    }
    row.querySelector<HTMLButtonElement>(`.${p}-item-clear`)?.addEventListener('click', () => {
      line.item_code = ''; line.item_name = ''; line.item_locked = false;
      line.account_missing = false; line.account_no = ''; line.account_name = '';
      line.tracking_mode = ''; line.rate = 0; line.amount = Math.round(line.qty * line.rate * 100) / 100;
      renderLines(); updateTotals();
      el.querySelector<HTMLInputElement>(`.${p}-item-in[data-uid="${line.uid}"]`)?.focus();
    });

    // Account typeahead — disabled once an item has locked the account in.
    const acctIn = row.querySelector<HTMLInputElement>(`.${p}-acct-in`)!;
    const acctDrop = row.querySelector<HTMLElement>(`.${p}-acct-drop`)!;
    if (!line.item_locked) {
      let acTimer: ReturnType<typeof setTimeout>;
      acctIn.addEventListener('input', () => {
        line.account_no = acctIn.value.trim();
        clearTimeout(acTimer);
        acTimer = setTimeout(() => fetchAcctDrop(line, acctIn, acctDrop, acctIn.value.trim()), 250);
      });
      acctIn.addEventListener('focus', () => fetchAcctDrop(line, acctIn, acctDrop, acctIn.value.trim()));
      acctIn.addEventListener('blur', () => { setTimeout(() => { acctDrop.hidden = true; }, 200); });
    }

    row.querySelector<HTMLButtonElement>(`.${p}-del`)?.addEventListener('click', () => {
      lines = lines.filter(x => x.uid !== line.uid);
      renderLines(); updateTotals();
    });
  }

  async function fetchItemDrop(line: Line, input: HTMLInputElement, drop: HTMLElement, term: string): Promise<void> {
    try {
      const res = await lookupData('items', term);
      if (!res.rows.length) { drop.hidden = true; return; }
      drop.innerHTML = res.rows.map(r => `
        <div class="${p}-idi" data-v="${escAttr(r.value)}" data-l="${escAttr(r.label)}"
          data-rate="${escAttr(String(r.row['default_rate'] ?? 0))}"
          data-tax="${escAttr(String(r.row['taxable'] ?? true))}"
          data-sacc="${escAttr(String(r.row['sales_account_no'] ?? ''))}"
          data-pacc="${escAttr(String(r.row['purchase_account_no'] ?? ''))}"
          data-track="${escAttr(String(r.row['tracking_mode'] ?? 'QTY'))}"
          style="padding:6px 10px;cursor:pointer;font-size:.82rem;border-bottom:1px solid var(--border);
                 display:flex;gap:8px;align-items:center">
          <span style="font-family:monospace;font-weight:600;flex-shrink:0">${escHtml(r.value)}</span>
          <span style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.label)}</span>
        </div>`).join('');
      showDropAt(input, drop);
      drop.querySelectorAll<HTMLElement>(`.${p}-idi`).forEach(item => {
        item.addEventListener('mouseenter', () => item.style.background = 'var(--border)');
        item.addEventListener('mouseleave', () => item.style.background = '');
        item.addEventListener('mousedown', () => {
          line.item_code = item.dataset['v']!;
          line.item_name = item.dataset['l']!;
          line.item_locked = true;
          line.description = line.description || item.dataset['l']!;
          line.taxable = item.dataset['tax'] === 'true';
          line.tracking_mode = (item.dataset['track'] as 'NONE' | 'QTY') || 'QTY';
          // Rate defaults to 0 for untracked (NONE) items; QTY-tracked items default
          // to the item's own price, which the user can still override.
          line.rate = line.tracking_mode === 'NONE' ? 0 : (parseFloat(item.dataset['rate'] ?? '0') || 0);
          line.amount = Math.round(line.qty * line.rate * 100) / 100;
          const acct = cfg.billType === 'SB' ? item.dataset['sacc'] : item.dataset['pacc'];
          line.account_no = acct || '';
          line.account_name = '';
          line.account_missing = !acct;
          input.value = line.item_code;
          drop.hidden = true;
          renderLines(); updateTotals();
        });
      });
    } catch { drop.hidden = true; }
  }

  async function fetchAcctDrop(line: Line, input: HTMLInputElement, drop: HTMLElement, term: string): Promise<void> {
    try {
      const res = await lookupData('accounts', term);
      if (!res.rows.length) { drop.hidden = true; return; }
      drop.innerHTML = res.rows.map(r => rowHtmlDrop(r.value, r.label)).join('');
      showDropAt(input, drop);
      wireDropClicks(drop, (v, l) => {
        line.account_no = v; line.account_name = l;
        input.value = v; drop.hidden = true;
        const nameEl = el.querySelector<HTMLElement>(`.${p}-acct-name[data-uid="${line.uid}"]`);
        if (nameEl) nameEl.textContent = l;
      });
    } catch { drop.hidden = true; }
  }

  async function fetchCcDrop(line: Line, input: HTMLInputElement, drop: HTMLElement, term: string): Promise<void> {
    try {
      const res = await lookupData('cost_centres', term);
      if (!res.rows.length) { drop.hidden = true; return; }
      drop.innerHTML = res.rows.map(r => rowHtmlDrop(r.value, r.label)).join('');
      showDropAt(input, drop);
      wireDropClicks(drop, (v) => {
        line.cost_centre_code = v;
        input.value = v; drop.hidden = true;
      });
    } catch { drop.hidden = true; }
  }

  // ── Totals ──
  function updateTotals(): void {
    const taxable = lines.reduce((s, l) => s + (l.amount || 0), 0);
    const vatBase = lines.reduce((s, l) => s + (l.taxable ? (l.amount || 0) : 0), 0);
    const vat = Math.round(vatBase * vatPct) / 100;
    const grand = taxable + vat;
    const totalsEl = q<HTMLElement>(el, `#${p}-totals`);
    totalsEl.innerHTML = `
      Taxable: ${fmt(taxable)}<br/>
      VAT (${vatPct}%): ${fmt(vat)}<br/>
      <strong style="font-size:1.05rem">Grand Total: ${fmt(grand)}</strong>`;
  }

  // ── Print (a real invoice layout, opened in its own window so the app
  //    chrome — sidebar, buttons — never bleeds into the printed page) ──
  function printInvoice(): void {
    const mode = modeEl.value;
    const billDate = adInput.value || todayIso();
    const billDateNep = nepInput.value;
    const narration = q<HTMLInputElement>(el, `#${p}-narration`).value;
    const footerNote = q<HTMLTextAreaElement>(el, `#${p}-footer-note`).value;

    const printLines = lines.filter(l => l.amount > 0 || l.account_no.trim());
    if (!printLines.length) {
      showAlert(el, p, 'Add at least one line before printing.', 'error');
      return;
    }

    const partyBlock = mode === 'Credit' && selectedParty
      ? `<strong>${escHtml(selectedParty.name)}</strong> (${escHtml(selectedParty.code)})<br/>
         ${selectedParty.mobile ? `Mobile: ${escHtml(selectedParty.mobile)}<br/>` : ''}
         ${selectedParty.tax_number ? `PAN/VAT No: ${escHtml(selectedParty.tax_number)}<br/>` : ''}`
      : mode
        ? `Payment: <strong>${escHtml(mode)}</strong>${bankNameEl.textContent ? ` — ${escHtml(bankNameEl.textContent)}` : ''}`
        : '—';

    const taxable = printLines.reduce((s, l) => s + (l.amount || 0), 0);
    const vatBase = printLines.reduce((s, l) => s + (l.taxable ? (l.amount || 0) : 0), 0);
    const vat = Math.round(vatBase * vatPct) / 100;
    const grand = taxable + vat;

    const rowsHtml = printLines.map((l, i) => `
      <tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${escHtml(l.item_code ? `${l.item_code} — ${l.description || l.item_name}` : (l.description || ''))}</td>
        <td style="text-align:right">${l.qty || ''}</td>
        <td style="text-align:right">${l.qty ? fmt(l.rate) : ''}</td>
        <td style="text-align:right">${fmt(l.amount)}</td>
      </tr>`).join('');

    let dueRow = '';
    if (mode === 'Credit' && dueEl.value) {
      const msPerDay = 86400000;
      const creditDays = Math.round((new Date(dueEl.value).getTime() - new Date(billDate).getTime()) / msPerDay);
      dueRow = `<div><span class="lbl">Due Date</span> ${escHtml(dueEl.value)}</div>
                <div><span class="lbl">Credit Term</span> ${creditDays} day${creditDays === 1 ? '' : 's'}</div>`;
    }

    const title = cfg.billType === 'SB' ? 'TAX INVOICE' : 'PURCHASE BILL';
    const companyMeta = [company.address, company.phone ? `Ph: ${company.phone}` : '', company.pan_no ? `PAN/VAT No: ${company.pan_no}` : '']
      .filter(Boolean).map(v => escHtml(String(v))).join(' &nbsp;|&nbsp; ');

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(title)} ${escHtml(savedBillNo ?? '')}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color:#111; margin:0; padding:32px; font-size:13px; }
  .header { text-align:center; margin-bottom:18px; border-bottom:2px solid #111; padding-bottom:12px; }
  .company-name { font-size:22px; font-weight:700; letter-spacing:.3px; }
  .company-meta { font-size:11.5px; color:#444; margin-top:2px; }
  .doc-title { font-size:15px; font-weight:700; letter-spacing:1.5px; margin-top:10px; }
  .meta-row { display:flex; justify-content:space-between; margin:16px 0; gap:24px; }
  .meta-block { font-size:12px; line-height:1.7; }
  .meta-block .lbl { color:#666; font-size:10.5px; text-transform:uppercase; letter-spacing:.5px; }
  table { width:100%; border-collapse:collapse; margin-top:10px; }
  th, td { border:1px solid #ccc; padding:6px 8px; font-size:12px; }
  th { background:#f3f4f6; text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.3px; }
  .totals { width:280px; margin-left:auto; margin-top:12px; font-size:13px; }
  .totals div { display:flex; justify-content:space-between; padding:3px 0; }
  .totals .grand { border-top:2px solid #111; margin-top:4px; padding-top:6px; font-weight:700; font-size:15px; }
  .footer { margin-top:50px; display:flex; justify-content:space-between; font-size:12px; }
  .sign { width:200px; text-align:center; border-top:1px solid #999; padding-top:6px; margin-top:50px; }
  .note { margin-top:22px; font-size:11.5px; color:#555; }
  @page { margin: 14mm; }
</style></head>
<body>
  <div class="header">
    <div class="company-name">${escHtml(company.company_name || '')}</div>
    <div class="company-meta">${companyMeta}</div>
    <div class="doc-title">${escHtml(title)}</div>
  </div>

  <div class="meta-row">
    <div class="meta-block">
      <div class="lbl">${escHtml(cfg.partyLabel)}</div>
      ${partyBlock}
    </div>
    <div class="meta-block" style="text-align:right">
      <div><span class="lbl">Bill No</span> <strong>${escHtml(savedBillNo ?? '(not yet saved)')}</strong></div>
      <div><span class="lbl">Date</span> ${escHtml(billDate)} (${escHtml(billDateNep)} BS)</div>
      ${dueRow}
    </div>
  </div>

  <table>
    <thead><tr>
      <th style="width:34px">S.N.</th><th>Description</th>
      <th style="width:70px;text-align:right">Qty</th>
      <th style="width:90px;text-align:right">Rate</th>
      <th style="width:100px;text-align:right">Amount</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>

  <div class="totals">
    <div><span>Taxable Total</span><span>${fmt(taxable)}</span></div>
    <div><span>VAT (${vatPct}%)</span><span>${fmt(vat)}</span></div>
    <div class="grand"><span>Grand Total</span><span>${fmt(grand)}</span></div>
  </div>

  ${narration ? `<div class="note"><strong>Narration:</strong> ${escHtml(narration)}</div>` : ''}
  ${footerNote ? `<div class="note">${escHtml(footerNote)}</div>` : ''}

  <div class="footer">
    <div class="sign">Prepared By</div>
    <div class="sign">${cfg.billType === 'SB' ? 'Received By' : 'Checked By'}</div>
    <div class="sign">Authorized Signatory</div>
  </div>
</body></html>`;

    const w = window.open('', '_blank', 'width=900,height=1000');
    if (!w) { showAlert(el, p, 'Please allow pop-ups for this site to print the invoice.', 'error'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  // ── Save ──
  async function handleSave(): Promise<void> {
    if (saving) return;

    const mode = modeEl.value;
    if (!mode) { showAlert(el, p, `Please select a payment mode.`, 'error'); return; }
    if (mode !== 'Credit' && !bankInEl.value.trim()) {
      showAlert(el, p, 'Please select the cash / bank account.', 'error'); return;
    }
    if (mode === 'Credit' && !selectedParty) {
      showAlert(el, p, `Please select ${cfg.partyLabel.toLowerCase()}.`, 'error'); return;
    }
    const activeLines = lines.filter(l => l.item_locked || l.account_no.trim() || l.amount > 0);
    const missingAcct = activeLines.filter(l => l.item_locked && l.account_missing);
    if (missingAcct.length) {
      const codes = missingAcct.map(l => l.item_code).join(', ');
      showAlert(el, p,
        `Cannot save: item(s) <strong>${escHtml(codes)}</strong> have no ` +
        `${cfg.billType === 'SB' ? 'sales' : 'purchase'} account configured. Set it in Item Master first.`,
        'error');
      return;
    }
    const validLines = activeLines.filter(l => l.account_no.trim() && l.amount > 0);
    if (!validLines.length) {
      showAlert(el, p, 'Add at least one line with an account and amount.', 'error'); return;
    }
    if (validLines.length !== activeLines.length) {
      showAlert(el, p, 'Every line needs both an account and an amount greater than zero.', 'error'); return;
    }

    saving = true;
    const saveBtn = q<HTMLButtonElement>(el, `#${p}-save`);
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';

    const narration = q<HTMLInputElement>(el, `#${p}-narration`).value;
    const payloadLines: BillLinePayload[] = validLines.map(l => ({
      item_code: l.item_code || null,
      description: l.description || narration || cfg.title,
      qty: l.qty, rate: l.rate, amount: l.amount, taxable: l.taxable,
      account_no: l.account_no, cost_centre_code: l.cost_centre_code || null,
      ...(showBatch && l.tracking_mode === 'QTY'
        ? { batch_no: l.batch_no || null, expiry_date: l.expiry_date || null }
        : {}),
    }));

    try {
      const [result] = await billSave({
        bill_type: cfg.billType,
        bill_date: adInput.value,
        bill_date_nep: nepInput.value.replace(/-/g, '/'),
        party_type: mode === 'Credit' ? selectedParty!.type : null,
        party_code: mode === 'Credit' ? selectedParty!.code : null,
        payment_mode: mode as any,
        bank_account_no: mode !== 'Credit' ? bankInEl.value.trim() : null,
        due_date: mode === 'Credit' ? (dueEl.value || null) : null,
        narration,
        footer_note: q<HTMLTextAreaElement>(el, `#${p}-footer-note`).value,
        lines: payloadLines,
      });
      savedBillNo = result?.bill_no ?? null;
      showAlert(el, p,
        `Saved as <strong>${escHtml(savedBillNo ?? 'bill')}</strong>. ` +
        `You can Print it now, or start a new ${cfg.title.toLowerCase()}.`,
        'success');
    } catch (err) {
      showAlert(el, p, `Save failed: ${err instanceof Error ? err.message : err}`, 'error');
    } finally {
      saving = false; saveBtn.disabled = false; saveBtn.textContent = 'Save';
    }
  }
}

function showAlert(el: HTMLElement, p: string, html: string, type: 'error' | 'success'): void {
  const a = el.querySelector<HTMLElement>(`#${p}-alert`);
  if (!a) return;
  const styles = {
    error:   { bg: '#FEF2F2', color: '#991B1B', border: '#FECACA' },
    success: { bg: '#ECFDF5', color: '#065F46', border: '#A7F3D0' },
  };
  const s = styles[type];
  a.innerHTML = html;
  a.style.background = s.bg; a.style.color = s.color; a.style.borderColor = s.border;
  a.hidden = false;
}
