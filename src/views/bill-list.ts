/**
 * bill-list.ts — Sale Bill List / Purchase Bill List.
 * Shared implementation, exported as initSaleBillList / initPurchaseBillList.
 */

import { getSession, roleLevel } from '../lib/session';
import { billList, billVoid } from '../services/bill';
import { toBS, fmt, escHtml, q } from '../lib/ui-helpers';

interface LConfig {
  p:         string;
  title:     string;
  billType:  'SB' | 'PB';
  formRoute: string;
  partyCol:  string; // 'Customer' | 'Supplier'
}

const SB_CFG: LConfig = { p: 'sbl', title: 'Sale Bill List',     billType: 'SB', formRoute: '#sale-bill-form',     partyCol: 'Customer' };
const PB_CFG: LConfig = { p: 'pbl', title: 'Purchase Bill List', billType: 'PB', formRoute: '#purchase-bill-form', partyCol: 'Supplier' };

export const initSaleBillList     = (el: HTMLElement) => buildView(el, SB_CFG);
export const initPurchaseBillList = (el: HTMLElement) => buildView(el, PB_CFG);

async function buildView(el: HTMLElement, cfg: LConfig): Promise<void> {
  const { p } = cfg;
  const s = getSession();
  const canVoid = !!s && roleLevel(s) >= 3;

  el.innerHTML = `
    <div class="page-header">
      <span class="page-title">${cfg.title}</span>
      <a href="${cfg.formRoute}" class="btn btn-primary" style="font-size:.85rem">+ New</a>
    </div>

    <div class="toolbar" style="gap:8px;margin-bottom:12px;display:flex;align-items:center;flex-wrap:wrap">
      <label style="font-size:.8rem;color:var(--muted)">From</label>
      <input id="${p}-from" type="date" />
      <label style="font-size:.8rem;color:var(--muted)">To</label>
      <input id="${p}-to" type="date" />
      <select id="${p}-status" class="at-select">
        <option value="">All Status</option>
        <option value="posted">Posted</option>
        <option value="voided">Voided</option>
      </select>
      <button id="${p}-fetch" class="btn btn-primary" style="font-size:.85rem">Fetch</button>
    </div>

    <div id="${p}-msg" hidden style="padding:8px 12px;border-radius:6px;margin-bottom:10px;font-size:.875rem"></div>

    <div style="overflow-x:auto">
      <table class="data-table" style="min-width:900px">
        <thead>
          <tr>
            <th>Bill No</th>
            <th>Date</th>
            <th>${cfg.partyCol}</th>
            <th>Mode</th>
            <th style="text-align:right">Taxable</th>
            <th style="text-align:right">VAT</th>
            <th style="text-align:right">Total</th>
            <th style="text-align:center">Status</th>
            ${canVoid ? `<th style="text-align:right;padding-right:12px">Actions</th>` : ''}
          </tr>
        </thead>
        <tbody id="${p}-body"><tr><td colspan="9" class="loading-msg">Loading…</td></tr></tbody>
      </table>
    </div>
  `;

  q(el, `#${p}-fetch`).addEventListener('click', () => load(el, cfg, canVoid));

  await load(el, cfg, canVoid);
}

async function load(el: HTMLElement, cfg: LConfig, canVoid: boolean): Promise<void> {
  const { p } = cfg;
  const from = q<HTMLInputElement>(el, `#${p}-from`).value || undefined;
  const to   = q<HTMLInputElement>(el, `#${p}-to`).value   || undefined;
  const status = q<HTMLSelectElement>(el, `#${p}-status`).value || undefined;

  const body = q<HTMLElement>(el, `#${p}-body`);
  body.innerHTML = `<tr><td colspan="9" class="loading-msg">Loading…</td></tr>`;

  try {
    const rows = await billList(cfg.billType, from, to, status);
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="9" class="loading-msg">No bills found</td></tr>`;
      return;
    }
    body.innerHTML = rows.map(r => `
      <tr style="${r.status === 'voided' ? 'opacity:.5;text-decoration:line-through' : ''}">
        <td style="font-family:monospace;font-weight:600;font-size:.85rem">${escHtml(r.bill_no)}</td>
        <td style="font-size:.85rem">${r.bill_date}<div style="font-size:.7rem;color:var(--muted)">${toBS(r.bill_date)}</div></td>
        <td>${escHtml(r.party_name ?? '—')}</td>
        <td>${escHtml(r.payment_mode)}</td>
        <td style="text-align:right;font-family:monospace">${fmt(r.taxable_amount)}</td>
        <td style="text-align:right;font-family:monospace">${fmt(r.vat_amount)}</td>
        <td style="text-align:right;font-family:monospace;font-weight:700">${fmt(r.total_amount)}</td>
        <td style="text-align:center">
          ${r.status === 'posted'
            ? `<span class="badge badge-approved">posted</span>`
            : `<span class="badge badge-pending">voided</span>`}
        </td>
        ${canVoid ? `
        <td style="text-align:right;padding-right:8px">
          ${r.status === 'posted'
            ? `<button class="${p}-void btn btn-secondary" data-id="${r.id}" data-no="${escHtml(r.bill_no)}"
                 style="font-size:.75rem;padding:3px 8px">Void</button>`
            : ''}
        </td>` : ''}
      </tr>
    `).join('');

    body.querySelectorAll<HTMLElement>(`.${p}-void`).forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset['id']);
        const no = btn.dataset['no'];
        if (!confirm(`Void bill ${no}? This reverses its ledger entry.`)) return;
        try {
          await billVoid(id);
          showMsg(el, p, `Voided ${no}`, 'success');
          await load(el, cfg, canVoid);
        } catch (err) {
          showMsg(el, p, `Void failed: ${err instanceof Error ? err.message : err}`, 'error');
        }
      });
    });
  } catch (err) {
    body.innerHTML = `<tr><td colspan="9" class="loading-msg">Load failed: ${err instanceof Error ? err.message : err}</td></tr>`;
  }
}

function showMsg(el: HTMLElement, p: string, text: string, type: 'success' | 'error'): void {
  const msg = el.querySelector<HTMLElement>(`#${p}-msg`);
  if (!msg) return;
  msg.textContent = text;
  msg.style.background = type === 'success' ? '#ECFDF5' : '#FEF2F2';
  msg.style.color      = type === 'success' ? '#059669' : '#DC2626';
  msg.style.border     = `1px solid ${type === 'success' ? '#A7F3D0' : '#FECACA'}`;
  msg.hidden = false;
  setTimeout(() => { msg.hidden = true; }, 3500);
}
