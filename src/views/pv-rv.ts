/**
 * pv-rv.ts — Payment Voucher (PV) and Receipt Voucher (RV) entry.
 *
 * Both views share one buildView() implementation driven by a VConfig.
 *
 * Header  : Party (Pay To / Received From), Mode, Cash/Bank A/c, Ref, Date BS/AD, Narration
 * Lines   : JV-style table
 *   • Row 0 (locked account)  : party's control account  ← user enters Dr (PV) or Cr (RV)
 *   • Middle rows             : free-form like JV
 *   • Last row (locked+computed): cash/bank account      ← amount auto-computed to balance
 *
 * Bank-line formula (works for both modes):
 *   net = Σ(non-bank Dr) − Σ(non-bank Cr)
 *   bankLine.credit = max(0,  net)   → PV: money going out
 *   bankLine.debit  = max(0, −net)   → RV: money coming in
 *
 * Saves via existing save_voucher RPC with tran_type = 'PV' | 'RV'.
 *
 * Usage (main.ts):
 *   'payment-voucher': () => import('./views/pv-rv').then(m => ({ init: m.initPV }))
 *   'receipt-voucher': () => import('./views/pv-rv').then(m => ({ init: m.initRV }))
 */

import { rpc }        from '../lib/rpc';
import { ctx }        from '../lib/session';
import { lookupData } from '../services/lookup';
import {
  isoToBs, bsToIso, daysInBsMonth, bsMonthStartDow, MONTH_NAMES,
} from '../lib/bs-calendar';
import { todayIso, toBS, fmt, escHtml, escAttr, q } from '../lib/ui-helpers';

// ── Config ─────────────────────────────────────────────────────────────────────

interface VConfig {
  p:          string;    // DOM id prefix: 'pv' | 'rv'
  title:      string;
  tranType:   'PV' | 'RV';
  partyLabel: string;    // 'Pay To' | 'Received From'
  modeLabel:  string;    // 'Payment Mode' | 'Receipt Mode'
  route:      string;    // '#payment-voucher' | '#receipt-voucher'
}

const PV_CFG: VConfig = {
  p: 'pv', title: 'Payment Voucher', tranType: 'PV',
  partyLabel: 'Pay To', modeLabel: 'Payment Mode', route: '#payment-voucher',
};
const RV_CFG: VConfig = {
  p: 'rv', title: 'Receipt Voucher', tranType: 'RV',
  partyLabel: 'Received From', modeLabel: 'Receipt Mode', route: '#receipt-voucher',
};

export const initPV = (el: HTMLElement) => buildView(el, PV_CFG);
export const initRV = (el: HTMLElement) => buildView(el, RV_CFG);

// ── Types ──────────────────────────────────────────────────────────────────────

const MODES = ['Cash', 'Bank', 'Digital'];
const LBL   = `font-weight:700;font-size:.875rem;color:var(--text);white-space:nowrap;padding-right:4px`;

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
  locked:           boolean;
}

let _uid = 0;

function makeLine(locked = false): LineState {
  return {
    uid: ++_uid, account_no: '', account_name: '',
    requires_party: false, party_type: '', party_code: '', party_name: '',
    description: '', debit: 0, credit: 0, cost_centre_code: '', locked,
  };
}

// ── Main builder ───────────────────────────────────────────────────────────────

async function buildView(el: HTMLElement, cfg: VConfig): Promise<void> {
  _uid = 0;

  const { p } = cfg;

  // ── State ──────────────────────────────────────────────────────────────────
  let partyLine: LineState = makeLine(true);
  let midLines:  LineState[] = [];
  let bankLine:  LineState   = makeLine(true);
  let ccRows:    CcRow[]     = [];
  let saving                 = false;
  let _bsViewYear            = 0;
  let _bsViewMonth           = 0;

  // ── Shell HTML ─────────────────────────────────────────────────────────────
  el.innerHTML = `
    <div class="page-header">
      <span class="page-title">${cfg.title}</span>
      <a href="#voucher-list" class="btn btn-secondary" style="font-size:.85rem">← Back</a>
    </div>

    <div id="${p}-alert" hidden
      style="padding:10px 16px;border-radius:6px;margin-bottom:14px;
             font-size:.85rem;border:1px solid transparent"></div>

    <div class="card" style="padding:20px 24px">

      <!-- ── Header: 4-column grid, same pattern as voucher-form ── -->
      <div style="display:grid;grid-template-columns:max-content 1fr max-content 1fr;
                  gap:10px 20px;align-items:start;margin-bottom:18px">

        <!-- Row 1: Party | Date BS -->
        <label style="${LBL}">${cfg.partyLabel} <span style="color:red">*</span></label>
        <div>
          <div style="position:relative">
            <input id="${p}-party-in" type="text" placeholder="party code or name"
              style="width:100%;box-sizing:border-box" />
            <div id="${p}-party-drop" hidden
              style="position:absolute;top:100%;left:0;right:0;z-index:200;
                     background:var(--surface);border:1px solid var(--border);border-radius:5px;
                     box-shadow:0 4px 14px rgba(0,0,0,.14);max-height:220px;overflow-y:auto"></div>
          </div>
          <div id="${p}-party-name"
            style="font-size:.72rem;color:var(--muted);margin-top:3px;min-height:14px"></div>
        </div>

        <label style="${LBL}">Date BS <span style="color:red">*</span></label>
        <div style="position:relative">
          <input id="${p}-date-nep" type="text" placeholder="YYYY-MM-DD (click)"
            style="width:100%;box-sizing:border-box;cursor:pointer;padding-right:30px" />
          <span id="${p}-cal-icon"
            style="position:absolute;right:8px;top:50%;transform:translateY(-50%);
                   cursor:pointer;font-size:1rem;user-select:none;line-height:1">📅</span>
          <div id="${p}-bs-cal" hidden
            style="position:absolute;top:calc(100% + 4px);left:0;z-index:300;width:280px;
                   background:var(--surface);border:1px solid var(--border);border-radius:8px;
                   box-shadow:0 6px 20px rgba(0,0,0,.18);padding:8px;font-size:.82rem"></div>
        </div>

        <!-- Row 2: Mode | Date AD -->
        <label style="${LBL}">${cfg.modeLabel} <span style="color:red">*</span></label>
        <select id="${p}-mode" class="at-select" style="width:100%">
          <option value="">-- select --</option>
          ${MODES.map(m => `<option>${m}</option>`).join('')}
        </select>

        <label style="${LBL}">Date AD <span style="color:red">*</span></label>
        <input id="${p}-date" type="date" value="${todayIso()}" />

        <!-- Row 3: Cash/Bank A/c | Ref No -->
        <label id="${p}-bank-lbl" style="${LBL}">Cash / Bank A/c <span style="color:red">*</span></label>
        <div>
          <div style="position:relative">
            <input id="${p}-bank-in" type="text" placeholder="account code or name"
              style="width:100%;box-sizing:border-box" />
            <div id="${p}-bank-drop" hidden
              style="position:absolute;top:100%;left:0;right:0;z-index:200;
                     background:var(--surface);border:1px solid var(--border);border-radius:5px;
                     box-shadow:0 4px 14px rgba(0,0,0,.14);max-height:200px;overflow-y:auto"></div>
          </div>
          <div id="${p}-bank-name"
            style="font-size:.72rem;color:var(--muted);margin-top:3px;min-height:14px"></div>
        </div>

        <label id="${p}-ref-lbl" style="${LBL}">Cheque / Ref No</label>
        <input id="${p}-ref" type="text" placeholder="optional" />

      </div>

      <!-- Narration -->
      <div class="field" style="margin-bottom:20px">
        <label style="${LBL}">Narration</label>
        <input id="${p}-narration" type="text"
          placeholder="Enter narration / description" style="margin-top:6px" />
      </div>

      <!-- Lines table -->
      <div id="${p}-lines-wrap" style="overflow-x:auto;margin-bottom:0"></div>

      <!-- Add Line + Balance indicator -->
      <div style="display:flex;justify-content:space-between;align-items:center;
                  padding:8px 0;margin-bottom:20px;border-top:1px solid var(--border)">
        <button id="${p}-add-line" class="btn btn-secondary" style="font-size:.85rem">+ Add Line</button>
        <div id="${p}-balance"
          style="font-family:monospace;font-weight:700;font-size:1rem;letter-spacing:.01em"></div>
      </div>

      <!-- Footer note -->
      <div class="field" style="margin-bottom:24px">
        <label style="${LBL}">Footer Note</label>
        <textarea id="${p}-footer-note" rows="2" placeholder="Prepared by / remarks"
          style="resize:vertical;width:100%;box-sizing:border-box;margin-top:6px;
                 border:1px solid var(--border);border-radius:5px;
                 padding:8px 10px;font-size:.875rem;
                 background:var(--surface);color:var(--text)"></textarea>
      </div>

      <!-- Actions -->
      <div style="display:flex;gap:8px">
        <button id="${p}-save"  class="btn btn-primary">Save</button>
        <button id="${p}-print" class="btn btn-secondary">Print</button>
        <button id="${p}-new"   class="btn btn-secondary">New / Clear</button>
        <a href="#voucher-list" class="btn btn-secondary">Cancel</a>
      </div>
    </div>
  `;

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const nepInput   = q<HTMLInputElement>(el, `#${p}-date-nep`);
  const adInput    = q<HTMLInputElement>(el, `#${p}-date`);
  const bsCalEl    = q<HTMLElement>(el,      `#${p}-bs-cal`);
  const calIcon    = q<HTMLElement>(el,      `#${p}-cal-icon`);
  const modeEl     = q<HTMLSelectElement>(el,`#${p}-mode`);
  const bankLblEl  = q<HTMLElement>(el,      `#${p}-bank-lbl`);
  const refLblEl   = q<HTMLElement>(el,      `#${p}-ref-lbl`);
  const refEl      = q<HTMLInputElement>(el, `#${p}-ref`);
  const bankInEl   = q<HTMLInputElement>(el, `#${p}-bank-in`);
  const bankDropEl = q<HTMLElement>(el,      `#${p}-bank-drop`);
  const bankNameEl = q<HTMLElement>(el,      `#${p}-bank-name`);
  const partyInEl  = q<HTMLInputElement>(el, `#${p}-party-in`);
  const partyDropEl= q<HTMLElement>(el,      `#${p}-party-drop`);
  const partyNameEl= q<HTMLElement>(el,      `#${p}-party-name`);

  // ── BS Calendar ────────────────────────────────────────────────────────────
  nepInput.value = toBS(adInput.value || todayIso());

  function openBsCal(): void {
    const iso = adInput.value || todayIso();
    const bs  = isoToBs(iso) ?? '';
    const [y, m] = bs.split('/').map(Number);
    _bsViewYear = y || 2082; _bsViewMonth = m || 1;
    renderBsMonth(); bsCalEl.hidden = false;
  }

  function renderBsMonth(): void {
    const selIso = adInput.value;
    const selBs  = selIso ? (isoToBs(selIso) ?? '') : '';
    const [selY, selM, selD] = selBs.split('/').map(Number);
    const days     = daysInBsMonth(_bsViewYear, _bsViewMonth);
    const startDow = bsMonthStartDow(_bsViewYear, _bsViewMonth);
    const DOW      = ['Su','Mo','Tu','We','Th','Fr','Sa'];
    const monthName= MONTH_NAMES[_bsViewMonth - 1] ?? String(_bsViewMonth);

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;
                  margin-bottom:6px;padding:2px 4px">
        <button class="bsp-nav" data-dir="-1"
          style="background:none;border:none;cursor:pointer;font-size:1.1rem;
                 color:var(--text);padding:2px 6px">&lsaquo;</button>
        <span style="font-weight:700;font-size:.88rem">${monthName} ${_bsViewYear}</span>
        <button class="bsp-nav" data-dir="1"
          style="background:none;border:none;cursor:pointer;font-size:1.1rem;
                 color:var(--text);padding:2px 6px">&rsaquo;</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;
                  margin-bottom:4px;text-align:center">
        ${DOW.map(d =>
          `<div style="font-size:.72rem;font-weight:600;color:var(--muted)">${d}</div>`
        ).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px">`;

    for (let b = 0; b < startDow; b++) html += `<div></div>`;
    for (let d = 1; d <= days; d++) {
      const sel = d === selD && _bsViewMonth === selM && _bsViewYear === selY;
      html += `<div class="bsp-day" data-day="${d}"
        style="text-align:center;padding:4px 2px;border-radius:4px;cursor:pointer;font-size:.8rem;
               ${sel ? 'background:var(--primary,#0284C7);color:#fff;font-weight:700'
                     : 'color:var(--text)'}">${d}</div>`;
    }
    html += `</div>`;
    bsCalEl.innerHTML = html;

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

    bsCalEl.querySelectorAll<HTMLElement>('.bsp-day').forEach(cell => {
      cell.addEventListener('click', () => {
        const d = parseInt(cell.dataset['day'] ?? '0');
        const pad = (n: number) => String(n).padStart(2, '0');
        const bsStr = `${_bsViewYear}/${pad(_bsViewMonth)}/${pad(d)}`;
        const iso   = bsToIso(bsStr);
        if (iso) { adInput.value = iso; nepInput.value = bsStr.replace(/\//g, '-'); }
        bsCalEl.hidden = true;
      });
    });
  }

  [nepInput, calIcon].forEach(t => {
    t.addEventListener('click', e => {
      e.stopPropagation();
      if (bsCalEl.hidden) openBsCal(); else bsCalEl.hidden = true;
    });
  });
  nepInput.addEventListener('change', () => {
    const raw = nepInput.value.trim().replace(/-/g, '/');
    const iso = bsToIso(raw);
    if (iso) { adInput.value = iso; nepInput.value = raw.replace(/\//g, '-'); }
    else nepInput.value = toBS(adInput.value || todayIso());
  });
  adInput.addEventListener('change', () => {
    nepInput.value = toBS(adInput.value || todayIso());
    if (!bsCalEl.hidden) renderBsMonth();
  });
  document.addEventListener('click', () => { bsCalEl.hidden = true; }, { capture: true });
  bsCalEl.addEventListener('click', e => e.stopPropagation());

  // ── Mode selector ──────────────────────────────────────────────────────────
  function updateModeUI(): void {
    const mode = modeEl.value;
    const modeMap: Record<string, string> = {
      Cash: 'Cash Account', Bank: 'Bank Account', Digital: 'Digital A/c',
    };
    bankLblEl.textContent = (modeMap[mode] ?? 'Cash / Bank A/c') + ' *';
    const showRef = mode === 'Bank' || mode === 'Digital';
    refLblEl.style.visibility = showRef ? '' : 'hidden';
    refEl.style.visibility    = showRef ? '' : 'hidden';
  }
  modeEl.addEventListener('change', updateModeUI);
  updateModeUI();

  // ── Header party typeahead ─────────────────────────────────────────────────
  let partyTimer: ReturnType<typeof setTimeout>;

  partyInEl.addEventListener('input', () => {
    clearTimeout(partyTimer);
    partyTimer = setTimeout(() => fetchHeaderParty(partyInEl.value.trim()), 280);
  });
  partyInEl.addEventListener('focus', () => fetchHeaderParty(partyInEl.value.trim()));
  partyInEl.addEventListener('blur',  () => { setTimeout(() => { partyDropEl.hidden = true; }, 200); });

  async function fetchHeaderParty(term: string): Promise<void> {
    try {
      const rows = await rpc<any[]>('list_parties', {
        ...ctx(), p_party_type: null, p_status: 'active', p_term: term || null,
      });
      if (!rows?.length) { partyDropEl.hidden = true; return; }

      partyDropEl.innerHTML = rows.map(r => `
        <div class="${p}-hpdi"
          data-code="${escAttr(r.party_code ?? '')}"
          data-name="${escAttr(r.party_name ?? '')}"
          data-type="${escAttr(r.party_type ?? '')}"
          data-ctrl="${escAttr(r.control_account_no ?? '')}"
          style="padding:6px 10px;cursor:pointer;font-size:.82rem;
                 border-bottom:1px solid var(--border);
                 display:flex;gap:8px;align-items:center">
          <span style="font-family:monospace;font-weight:600;flex-shrink:0">${escHtml(r.party_code ?? '')}</span>
          <span style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.party_name ?? '')}</span>
          <span style="font-size:.7rem;color:var(--muted);flex-shrink:0;margin-left:auto">${escHtml(r.party_type ?? '')}</span>
        </div>`).join('');
      partyDropEl.hidden = false;

      partyDropEl.querySelectorAll<HTMLElement>(`.${p}-hpdi`).forEach(item => {
        item.addEventListener('mouseenter', () => item.style.background = 'var(--border)');
        item.addEventListener('mouseleave', () => item.style.background = '');
        item.addEventListener('mousedown', () => {
          const code = item.dataset['code']!;
          const name = item.dataset['name']!;
          const type = item.dataset['type']!;
          const ctrl = item.dataset['ctrl']!;

          partyInEl.value         = code;
          partyNameEl.textContent  = name + (type ? `  (${type})` : '');
          partyDropEl.hidden       = true;

          // Set party line
          partyLine.account_no     = ctrl;
          partyLine.requires_party = true;
          partyLine.party_type     = type;
          partyLine.party_code     = code;
          partyLine.party_name     = name;

          // Resolve account name for the control account
          resolveAcctName(ctrl).then(n => {
            partyLine.account_name = n;
            renderLines();
          });
        });
      });
    } catch { partyDropEl.hidden = true; }
  }

  async function resolveAcctName(code: string): Promise<string> {
    try {
      const res = await lookupData('accounts', code);
      return res.rows.find(r => r.value === code)?.label ?? code;
    } catch { return code; }
  }

  // ── Bank account typeahead ─────────────────────────────────────────────────
  let bankTimer: ReturnType<typeof setTimeout>;

  bankInEl.addEventListener('input', () => {
    clearTimeout(bankTimer);
    bankTimer = setTimeout(() => fetchBankDrop(bankInEl.value.trim()), 280);
  });
  bankInEl.addEventListener('focus', () => fetchBankDrop(bankInEl.value.trim()));
  bankInEl.addEventListener('blur',  () => { setTimeout(() => { bankDropEl.hidden = true; }, 200); });

  async function fetchBankDrop(term: string): Promise<void> {
    try {
      const res = await lookupData('accounts', term);
      if (!res.rows.length) { bankDropEl.hidden = true; return; }

      bankDropEl.innerHTML = res.rows.map(r => `
        <div class="${p}-bdi" data-v="${escAttr(r.value)}" data-l="${escAttr(r.label)}"
          style="padding:6px 10px;cursor:pointer;font-size:.82rem;
                 border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center">
          <span style="font-family:monospace;font-weight:600;flex-shrink:0">${escHtml(r.value)}</span>
          <span style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.label)}</span>
        </div>`).join('');
      bankDropEl.hidden = false;

      bankDropEl.querySelectorAll<HTMLElement>(`.${p}-bdi`).forEach(item => {
        item.addEventListener('mouseenter', () => item.style.background = 'var(--border)');
        item.addEventListener('mouseleave', () => item.style.background = '');
        item.addEventListener('mousedown', () => {
          bankLine.account_no   = item.dataset['v']!;
          bankLine.account_name = item.dataset['l']!;
          bankLine.description  = modeEl.value || cfg.tranType;
          bankInEl.value        = bankLine.account_no;
          bankNameEl.textContent= bankLine.account_name;
          bankDropEl.hidden     = true;
          computeBankLine(); renderLines(); updateTotals();
        });
      });
    } catch { bankDropEl.hidden = true; }
  }

  // ── Load cost centres ──────────────────────────────────────────────────────
  try {
    const rows = await rpc<any[]>('cc_list', { ...ctx(), p_include_inactive: false });
    ccRows = (rows ?? []).map((r: any) => ({ code: r.code, name: r.name }));
  } catch { /* optional */ }

  // ── Shared input style (must be declared before the initial renderLines() call
  //    below — renderLines() → rowHtml() reads IN_STYLE synchronously) ─────────
  const IN_STYLE = `width:100%;box-sizing:border-box;border:1px solid var(--border);
    border-radius:5px;padding:5px 7px;font-size:.82rem;
    background:var(--surface);color:var(--text)`;

  // ── Initial render ─────────────────────────────────────────────────────────
  renderLines();
  updateTotals();

  // ── Button wiring ──────────────────────────────────────────────────────────
  q(el, `#${p}-add-line`).addEventListener('click', () => {
    midLines.push(makeLine());
    renderLines(); updateTotals();
    // Focus last unlocked account input
    const inputs = Array.from(el.querySelectorAll<HTMLInputElement>(`.${p}-acct-in`));
    inputs[inputs.length - 1]?.focus();
  });

  q(el, `#${p}-save`).addEventListener('click', handleSave);
  q(el, `#${p}-print`).addEventListener('click', () => window.print());
  q(el, `#${p}-new`).addEventListener('click', () => {
    window.location.hash = cfg.route;
    _uid = 0;
    buildView(el, cfg);
  });

  // ── Compute bank line ──────────────────────────────────────────────────────
  function computeBankLine(): void {
    const nonBankDr = partyLine.debit  + midLines.reduce((s, l) => s + (l.debit  || 0), 0);
    const nonBankCr = partyLine.credit + midLines.reduce((s, l) => s + (l.credit || 0), 0);
    const net = nonBankDr - nonBankCr;
    bankLine.credit = Math.max(0,  net);
    bankLine.debit  = Math.max(0, -net);
  }

  // ── Render lines table ─────────────────────────────────────────────────────

  function renderLines(): void {
    const wrap     = q<HTMLElement>(el, `#${p}-lines-wrap`);
    const allLines = [partyLine, ...midLines, bankLine];

    wrap.innerHTML = `
      <table class="data-table" style="min-width:860px;table-layout:fixed">
        <colgroup>
          <col style="width:200px"><col style="width:160px"><col style="width:200px">
          <col style="width:110px"><col style="width:110px"><col style="width:140px">
          <col style="width:36px">
        </colgroup>
        <thead>
          <tr>
            <th style="font-size:.85rem;font-weight:700">Account</th>
            <th style="font-size:.85rem;font-weight:700">Party</th>
            <th style="font-size:.85rem;font-weight:700">Description</th>
            <th style="text-align:right;font-size:.85rem;font-weight:700">Debit</th>
            <th style="text-align:right;font-size:.85rem;font-weight:700">Credit</th>
            <th style="font-size:.85rem;font-weight:700">Cost Centre</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${allLines.map(l => rowHtml(l)).join('')}
        </tbody>
        <tfoot>
          <tr style="border-top:2px solid var(--border);background:var(--bg)">
            <td colspan="3"
              style="text-align:right;font-weight:600;color:var(--muted);
                     font-size:.8rem;padding:6px 8px">Column Totals</td>
            <td id="${p}-col-dr"
              style="text-align:right;font-family:monospace;font-weight:700;
                     font-size:.9rem;padding:6px 8px;color:var(--text)">0.00</td>
            <td id="${p}-col-cr"
              style="text-align:right;font-family:monospace;font-weight:700;
                     font-size:.9rem;padding:6px 8px;color:var(--text)">0.00</td>
            <td colspan="2"></td>
          </tr>
        </tfoot>
      </table>`;

    allLines.forEach(l => wireRow(l));
    // Sync computed bank amounts after full re-render
    computeBankLine();
    refreshBankAmounts();
    updateTotals();
  }

  function rowHtml(l: LineState): string {
    const isParty = l.uid === partyLine.uid;
    const isBank  = l.uid === bankLine.uid;
    const drVal   = l.debit  ? l.debit.toString()  : '';
    const crVal   = l.credit ? l.credit.toString() : '';

    // Locked row gets a subtle left border
    const ROW_STYLE = l.locked
      ? 'border-left:3px solid #D97706;background:var(--bg)'
      : '';

    return `
    <tr data-uid="${l.uid}" style="${ROW_STYLE}">

      <!-- Account -->
      <td style="padding:6px 8px;vertical-align:top">
        ${l.locked
          ? `<div style="font-family:monospace;font-size:.82rem;padding:5px 7px;
                         color:var(--text);word-break:break-all">${escHtml(l.account_no) || '—'}</div>`
          : `<div style="position:relative">
               <input class="${p}-acct-in" data-uid="${l.uid}" type="text"
                 value="${escHtml(l.account_no)}" placeholder="code or name"
                 style="${IN_STYLE}" />
               <div class="${p}-acct-drop" data-uid="${l.uid}" hidden
                 style="position:absolute;top:100%;left:0;right:0;z-index:200;
                   background:var(--surface);border:1px solid var(--border);border-radius:5px;
                   box-shadow:0 4px 14px rgba(0,0,0,.14);max-height:200px;overflow-y:auto"></div>
             </div>`
        }
        <div class="${p}-acct-name" data-uid="${l.uid}"
          style="font-size:.72rem;color:var(--muted);margin-top:3px;min-height:14px;
                 white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${escHtml(l.account_name)}
        </div>
      </td>

      <!-- Party -->
      <td style="padding:6px 8px;vertical-align:top">
        ${isParty
          ? `<div style="font-family:monospace;font-size:.82rem;padding:5px 0;color:var(--text)">${escHtml(l.party_code) || '—'}</div>
             <div style="font-size:.72rem;color:var(--muted);min-height:14px">${escHtml(l.party_name)}</div>`
          : isBank
            ? `<span style="color:var(--muted);font-size:.85rem">—</span>`
            : l.requires_party
              ? `<div style="position:relative">
                   <input class="${p}-party-in" data-uid="${l.uid}" type="text"
                     value="${escHtml(l.party_code)}" placeholder="code or name"
                     style="${IN_STYLE}" />
                   <div class="${p}-party-drop" data-uid="${l.uid}" hidden
                     style="position:absolute;top:100%;left:0;right:0;z-index:200;
                       background:var(--surface);border:1px solid var(--border);border-radius:5px;
                       box-shadow:0 4px 14px rgba(0,0,0,.14);max-height:180px;overflow-y:auto"></div>
                 </div>
                 <div class="${p}-party-name" data-uid="${l.uid}"
                   style="font-size:.72rem;color:var(--muted);margin-top:3px;min-height:14px">
                   ${escHtml(l.party_name)}
                 </div>`
              : `<span style="color:var(--muted);font-size:.85rem;line-height:2">—</span>`
        }
      </td>

      <!-- Description -->
      <td style="padding:6px 8px;vertical-align:top">
        ${isBank
          ? `<div style="font-size:.82rem;padding:5px 0;color:var(--muted);font-style:italic">
               ${escHtml(l.description) || '(computed)'}
             </div>`
          : `<textarea class="${p}-desc" data-uid="${l.uid}" rows="2"
               placeholder="description" style="${IN_STYLE}resize:vertical;"
             >${escHtml(l.description)}</textarea>`
        }
      </td>

      <!-- Debit -->
      <td style="padding:6px 8px;vertical-align:top">
        ${isBank
          ? `<div class="${p}-dr-val" style="font-family:monospace;text-align:right;
               padding:5px 0;font-size:.85rem;color:var(--text)">
               ${bankLine.debit ? fmt(bankLine.debit) : '—'}
             </div>`
          : `<input class="${p}-dr" data-uid="${l.uid}" type="number" min="0" step="0.01"
               value="${drVal}" placeholder="0.00"
               style="${IN_STYLE}text-align:right;font-family:monospace" />`
        }
      </td>

      <!-- Credit -->
      <td style="padding:6px 8px;vertical-align:top">
        ${isBank
          ? `<div class="${p}-cr-val" style="font-family:monospace;text-align:right;
               padding:5px 0;font-size:.85rem;color:var(--text)">
               ${bankLine.credit ? fmt(bankLine.credit) : '—'}
             </div>`
          : `<input class="${p}-cr" data-uid="${l.uid}" type="number" min="0" step="0.01"
               value="${crVal}" placeholder="0.00"
               style="${IN_STYLE}text-align:right;font-family:monospace" />`
        }
      </td>

      <!-- Cost Centre -->
      <td style="padding:6px 8px;vertical-align:top">
        ${isBank
          ? `<span style="color:var(--muted);font-size:.85rem">—</span>`
          : `<div style="position:relative">
               <input class="${p}-cc-in" data-uid="${l.uid}" type="text"
                 value="${escHtml(l.cost_centre_code)}" placeholder="optional"
                 style="${IN_STYLE}" />
               <div class="${p}-cc-drop" data-uid="${l.uid}" hidden
                 style="position:absolute;top:100%;left:0;right:0;z-index:200;
                   background:var(--surface);border:1px solid var(--border);border-radius:5px;
                   box-shadow:0 4px 14px rgba(0,0,0,.14);max-height:160px;overflow-y:auto"></div>
             </div>`
        }
      </td>

      <!-- Delete (mid lines only) -->
      <td style="padding:6px 4px;vertical-align:top;text-align:center">
        ${!l.locked
          ? `<button class="${p}-del" data-uid="${l.uid}"
               style="background:none;border:none;cursor:pointer;color:#EF4444;
                      font-size:1.3rem;line-height:1;padding:3px 5px" title="Remove">×</button>`
          : ''
        }
      </td>
    </tr>`;
  }

  // ── Wire a single row ──────────────────────────────────────────────────────
  function wireRow(line: LineState): void {
    const uid = line.uid;
    const row = el.querySelector<HTMLElement>(`tr[data-uid="${uid}"]`);
    if (!row) return;

    const isBank = uid === bankLine.uid;
    if (isBank) return;   // bank line is fully computed — nothing to wire

    // Amount inputs — shared logic for party line and mid lines
    const drInput = row.querySelector<HTMLInputElement>(`.${p}-dr`);
    const crInput = row.querySelector<HTMLInputElement>(`.${p}-cr`);

    if (drInput) {
      drInput.addEventListener('input', () => {
        line.debit = parseFloat(drInput.value) || 0;
        if (line.debit && crInput) { line.credit = 0; crInput.value = ''; }
        computeBankLine(); refreshBankAmounts(); updateTotals();
      });
    }
    if (crInput) {
      crInput.addEventListener('input', () => {
        line.credit = parseFloat(crInput.value) || 0;
        if (line.credit && drInput) { line.debit = 0; drInput.value = ''; }
        computeBankLine(); refreshBankAmounts(); updateTotals();
      });
    }

    // Description
    row.querySelector<HTMLTextAreaElement>(`.${p}-desc`)?.addEventListener('input', e => {
      line.description = (e.target as HTMLTextAreaElement).value;
    });

    // Cost centre
    const ccIn   = row.querySelector<HTMLInputElement>(`.${p}-cc-in`);
    const ccDrop = row.querySelector<HTMLElement>(`.${p}-cc-drop`);
    if (ccIn && ccDrop) wireCcDrop(line, ccIn, ccDrop);

    // ── Mid-line only ──
    const isParty = uid === partyLine.uid;
    if (isParty) return;   // party line has no account typeahead or delete

    // Account typeahead
    const acctIn   = row.querySelector<HTMLInputElement>(`.${p}-acct-in`);
    const acctDrop = row.querySelector<HTMLElement>(`.${p}-acct-drop`);
    if (acctIn && acctDrop) {
      let timer: ReturnType<typeof setTimeout>;
      acctIn.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => fetchAcctDrop(line, acctIn, acctDrop, acctIn.value.trim()), 280);
      });
      acctIn.addEventListener('focus', () => {
        if (acctIn.value.trim()) fetchAcctDrop(line, acctIn, acctDrop, acctIn.value.trim());
      });
      acctIn.addEventListener('blur', () => { setTimeout(() => { acctDrop.hidden = true; }, 200); });
    }

    // Party typeahead (when account requires_party)
    const partyIn   = row.querySelector<HTMLInputElement>(`.${p}-party-in`);
    const partyDrop = row.querySelector<HTMLElement>(`.${p}-party-drop`);
    if (partyIn && partyDrop) {
      let pt: ReturnType<typeof setTimeout>;
      partyIn.addEventListener('input', () => {
        clearTimeout(pt);
        pt = setTimeout(() => fetchLinePDrop(line, partyIn, partyDrop, partyIn.value.trim()), 280);
      });
      partyIn.addEventListener('focus', () =>
        fetchLinePDrop(line, partyIn, partyDrop, partyIn.value.trim()));
      partyIn.addEventListener('blur', () => {
        setTimeout(() => { partyDrop.hidden = true; }, 200);
      });
    }

    // Delete — middle lines are optional; a plain party + bank voucher
    // (no extra charges/deductions) is valid, so this can go to zero.
    row.querySelector<HTMLButtonElement>(`.${p}-del`)?.addEventListener('click', () => {
      midLines = midLines.filter(l => l.uid !== uid);
      renderLines(); updateTotals();
    });
  }

  // ── Refresh bank-line amount cells without full re-render ──────────────────
  function refreshBankAmounts(): void {
    const bankRow = el.querySelector<HTMLElement>(`tr[data-uid="${bankLine.uid}"]`);
    if (!bankRow) return;
    const drEl = bankRow.querySelector<HTMLElement>(`.${p}-dr-val`);
    const crEl = bankRow.querySelector<HTMLElement>(`.${p}-cr-val`);
    if (drEl) drEl.textContent = bankLine.debit  ? fmt(bankLine.debit)  : '—';
    if (crEl) crEl.textContent = bankLine.credit ? fmt(bankLine.credit) : '—';
  }

  // ── Account typeahead (mid lines) ──────────────────────────────────────────
  async function fetchAcctDrop(
    line: LineState, input: HTMLInputElement, drop: HTMLElement, term: string
  ): Promise<void> {
    try {
      const result = await lookupData('accounts', term);
      if (!result.rows.length) { drop.hidden = true; return; }

      drop.innerHTML = result.rows.map(r => {
        const req   = r.row['requires_party'] as boolean;
        const ptype = String(r.row['party_type'] ?? '');
        return `<div class="${p}-di" data-v="${escAttr(r.value)}" data-l="${escAttr(r.label)}"
          data-req="${req}" data-pt="${escAttr(ptype)}"
          style="padding:6px 10px;cursor:pointer;font-size:.82rem;
                 border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center">
          <span style="font-family:monospace;font-weight:600;flex-shrink:0">${escHtml(r.value)}</span>
          <span style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.label)}</span>
        </div>`;
      }).join('');
      drop.hidden = false;

      drop.querySelectorAll<HTMLElement>(`.${p}-di`).forEach(item => {
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
          if (prevReq !== line.requires_party) { renderLines(); }
          else {
            const nameEl = el.querySelector<HTMLElement>(`.${p}-acct-name[data-uid="${line.uid}"]`);
            if (nameEl) nameEl.textContent = line.account_name;
          }
        });
      });
    } catch { drop.hidden = true; }
  }

  // ── Party typeahead (mid-line party column) ────────────────────────────────
  async function fetchLinePDrop(
    line: LineState, input: HTMLInputElement, drop: HTMLElement, term: string
  ): Promise<void> {
    if (!line.account_no) { drop.hidden = true; return; }
    try {
      const result = await lookupData('parties_by_account', term, `control=eq.${line.account_no}`);
      if (!result.rows.length) { drop.hidden = true; return; }

      drop.innerHTML = result.rows.map(r =>
        `<div class="${p}-di" data-v="${escAttr(r.value)}" data-l="${escAttr(r.label)}"
          style="padding:6px 10px;cursor:pointer;font-size:.82rem;
                 border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center">
          <span style="font-family:monospace;font-weight:600;flex-shrink:0">${escHtml(r.value)}</span>
          <span style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.label)}</span>
        </div>`
      ).join('');
      drop.hidden = false;

      drop.querySelectorAll<HTMLElement>(`.${p}-di`).forEach(item => {
        item.addEventListener('mouseenter', () => item.style.background = 'var(--border)');
        item.addEventListener('mouseleave', () => item.style.background = '');
        item.addEventListener('mousedown', () => {
          line.party_code = item.dataset['v']!;
          line.party_name = item.dataset['l']!;
          input.value = line.party_code;
          drop.hidden = true;
          const nameEl = el.querySelector<HTMLElement>(`.${p}-party-name[data-uid="${line.uid}"]`);
          if (nameEl) nameEl.textContent = line.party_name;
        });
      });
    } catch { drop.hidden = true; }
  }

  // ── Cost centre dropdown ───────────────────────────────────────────────────
  function wireCcDrop(line: LineState, input: HTMLInputElement, drop: HTMLElement): void {
    input.addEventListener('input', () => {
      line.cost_centre_code = input.value.trim().toUpperCase();
      input.value = line.cost_centre_code;
      showCcDrop(line, input, drop, input.value.toLowerCase());
    });
    input.addEventListener('focus', () =>
      showCcDrop(line, input, drop, input.value.trim().toLowerCase()));
    input.addEventListener('blur', () => { setTimeout(() => { drop.hidden = true; }, 200); });
  }

  function showCcDrop(line: LineState, input: HTMLInputElement, drop: HTMLElement, term: string): void {
    const matches = ccRows.filter(c =>
      !term || c.code.toLowerCase().includes(term) || c.name.toLowerCase().includes(term)
    ).slice(0, 15);
    if (!matches.length) { drop.hidden = true; return; }

    drop.innerHTML = matches.map(c =>
      `<div class="${p}-di" data-code="${escAttr(c.code)}"
        style="padding:6px 10px;cursor:pointer;font-size:.82rem;
               border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center">
        <span style="font-family:monospace;font-weight:600;flex-shrink:0">${escHtml(c.code)}</span>
        <span style="color:var(--muted)">${escHtml(c.name)}</span>
      </div>`
    ).join('');
    drop.hidden = false;

    drop.querySelectorAll<HTMLElement>(`.${p}-di`).forEach(item => {
      item.addEventListener('mouseenter', () => item.style.background = 'var(--border)');
      item.addEventListener('mouseleave', () => item.style.background = '');
      item.addEventListener('mousedown', () => {
        line.cost_centre_code = item.dataset['code']!;
        input.value = line.cost_centre_code;
        drop.hidden = true;
      });
    });
  }

  // ── Live totals ────────────────────────────────────────────────────────────
  function updateTotals(): void {
    const allLines = [partyLine, ...midLines, bankLine];
    const dr   = allLines.reduce((s, l) => s + (l.debit  || 0), 0);
    const cr   = allLines.reduce((s, l) => s + (l.credit || 0), 0);
    const diff = dr - cr;

    const colDr = el.querySelector(`#${p}-col-dr`);
    const colCr = el.querySelector(`#${p}-col-cr`);
    if (colDr) colDr.textContent = fmt(dr);
    if (colCr) colCr.textContent = fmt(cr);

    const balEl = q<HTMLElement>(el, `#${p}-balance`);
    if (Math.abs(diff) < 0.005) {
      balEl.textContent = 'Balanced ✓';
      balEl.style.color = '#059669';
    } else {
      balEl.textContent = `Unbalanced  ${diff > 0 ? 'Dr>' : 'Cr>'}  Diff: ${fmt(Math.abs(diff))}`;
      balEl.style.color = '#DC2626';
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave(): Promise<void> {
    if (saving) return;

    // Validate header
    if (!partyInEl.value.trim())  { showAlert(el, p, 'Please select a party.', 'error'); return; }
    if (!modeEl.value)            { showAlert(el, p, `Please select a ${cfg.modeLabel.toLowerCase()}.`, 'error'); return; }
    if (!bankLine.account_no)     { showAlert(el, p, 'Please select the cash / bank account.', 'error'); return; }
    if (!partyLine.account_no)    { showAlert(el, p, 'Party control account not found — re-select the party.', 'error'); return; }
    if (!partyLine.debit && !partyLine.credit) {
      showAlert(el, p, 'Enter the party amount (Dr or Cr) on the party line.', 'error'); return;
    }

    computeBankLine();

    // Build payload lines (exclude blank mid lines)
    const allLines = [partyLine, ...midLines.filter(l => l.account_no.trim()), bankLine];

    const dr = allLines.reduce((s, l) => s + (l.debit  || 0), 0);
    const cr = allLines.reduce((s, l) => s + (l.credit || 0), 0);
    if (Math.abs(dr - cr) >= 0.005) {
      showAlert(el, p, `Voucher does not balance.  Dr: ${fmt(dr)}  Cr: ${fmt(cr)}  Diff: ${fmt(dr - cr)}`, 'error');
      return;
    }

    saving = true;
    const saveBtn = q<HTMLButtonElement>(el, `#${p}-save`);
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';

    const { p_tenant, p_caller } = ctx();
    const narration = q<HTMLInputElement>(el, `#${p}-narration`).value;
    const ref       = q<HTMLInputElement>(el, `#${p}-ref`).value;
    const descFull  = [narration, ref ? `Ref: ${ref}` : ''].filter(Boolean).join('  ');

    const payload = {
      tenant:           p_tenant,
      caller:           p_caller,
      id:               null,
      tran_type:        cfg.tranType,
      voucher_date:     adInput.value,
      voucher_date_nep: nepInput.value.replace(/-/g, '/'),
      description:      descFull || cfg.tranType,
      footer_note:      q<HTMLTextAreaElement>(el, `#${p}-footer-note`).value,
      lines: allLines.map(l => ({
        account_no:       l.account_no,
        description:      l.description || narration || cfg.tranType,
        debit:            l.debit  || 0,
        credit:           l.credit || 0,
        cost_centre_code: l.cost_centre_code || null,
        party_type:       l.requires_party ? (l.party_type  || null) : null,
        party_code:       l.requires_party ? (l.party_code  || null) : null,
      })),
    };

    try {
      const result = await rpc<{ id: number; voucher_no: string }>('save_voucher', { payload });
      showAlert(el, p, `Saved as <strong>${result?.voucher_no ?? 'voucher'}</strong>`, 'success');
      setTimeout(() => { window.location.hash = '#voucher-list'; }, 1000);
    } catch (err) {
      showAlert(el, p, `Save failed: ${err instanceof Error ? err.message : err}`, 'error');
    } finally {
      saving = false; saveBtn.disabled = false; saveBtn.textContent = 'Save';
    }
  }
}

// ── Alert helper ───────────────────────────────────────────────────────────────
function showAlert(el: HTMLElement, p: string, html: string, type: 'info'|'warning'|'error'|'success'): void {
  const a = el.querySelector<HTMLElement>(`#${p}-alert`);
  if (!a) return;
  const styles = {
    info:    { bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE' },
    warning: { bg: '#FEF3C7', color: '#92400E', border: '#FDE68A' },
    error:   { bg: '#FEF2F2', color: '#991B1B', border: '#FECACA' },
    success: { bg: '#ECFDF5', color: '#065F46', border: '#A7F3D0' },
  };
  const s = styles[type]!;
  a.innerHTML = html;
  a.style.background  = s.bg;
  a.style.color       = s.color;
  a.style.borderColor = s.border;
  a.hidden = false;
}
