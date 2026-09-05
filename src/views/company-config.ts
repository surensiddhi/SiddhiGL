/** company-config.ts — Company Settings */

import { getCompanyConfig, saveCompanyConfig } from '../services/config';
import { lookupData } from '../services/lookup';
import { escHtml, escAttr } from '../lib/ui-helpers';
import type { CompanyConfig } from '../types';

export function init(el: HTMLElement): void {
  el.innerHTML = `
    <div class="page-header">
      <span class="page-title">Company Settings</span>
    </div>

    <form id="cc-form">
      <div class="card">
        <h3 style="margin:0 0 16px">Company Identity</h3>

        <div class="field" style="margin-bottom:14px">
          <label>Company name</label>
          <input id="cc-name" type="text" required maxlength="150" />
        </div>

        <div class="field" style="margin-bottom:14px">
          <label>Address</label>
          <textarea id="cc-address" rows="2" maxlength="300"></textarea>
        </div>

        <div class="form-grid" style="margin-bottom:14px">
          <div class="field">
            <label>PAN / VAT no</label>
            <input id="cc-pan" type="text" maxlength="30" />
          </div>
          <div class="field">
            <label>Phone</label>
            <input id="cc-phone" type="text" maxlength="30" />
          </div>
        </div>

        <div class="form-grid">
          <div class="field">
            <label>Email</label>
            <input id="cc-email" type="email" maxlength="150" />
          </div>
          <div class="field">
            <label>Fiscal year start (Nep)</label>
            <input id="cc-fy-start" type="text" required placeholder="YYYY/MM/DD" />
          </div>
        </div>
      </div>

      <div class="card">
        <h3 style="margin:0 0 16px">Business Type</h3>
        <div class="field">
          <label>What kind of business is this?</label>
          <select id="cc-business-type">
            <option value="service">Service (Income – Expenses)</option>
            <option value="trading">Trading (Sales – COGS – Gross Profit)</option>
          </select>
        </div>
      </div>

      <div class="card">
        <h3 style="margin:0 0 16px">Tax (VAT)</h3>
        <div class="form-grid" style="margin-bottom:14px">
          <div class="field">
            <label>VAT % (0 = not VAT-registered)</label>
            <input id="cc-vat-pct" type="number" min="0" max="100" step="0.01" />
          </div>
        </div>
        <div class="form-grid">
          <div class="field" style="position:relative">
            <label>VAT Payable Account (output VAT on Sales)</label>
            <input id="cc-vat-payable" type="text" placeholder="code or name" autocomplete="off" />
            <div id="cc-vat-payable-drop" hidden style="position:absolute;top:100%;left:0;right:0;z-index:200;
              background:var(--surface);border:1px solid var(--border);border-radius:5px;
              box-shadow:0 4px 14px rgba(0,0,0,.14);max-height:180px;overflow-y:auto"></div>
          </div>
          <div class="field" style="position:relative">
            <label>VAT Receivable Account (input VAT on Purchase)</label>
            <input id="cc-vat-receivable" type="text" placeholder="code or name" autocomplete="off" />
            <div id="cc-vat-receivable-drop" hidden style="position:absolute;top:100%;left:0;right:0;z-index:200;
              background:var(--surface);border:1px solid var(--border);border-radius:5px;
              box-shadow:0 4px 14px rgba(0,0,0,.14);max-height:180px;overflow-y:auto"></div>
          </div>
        </div>
        <div style="font-size:.72rem;color:var(--muted);margin-top:8px">
          Required only if a Sales or Purchase bill line ends up carrying VAT — the Sales/Purchase modules
          will tell you exactly which one is missing if you try to save a taxable bill without it configured.
        </div>
      </div>

      <div class="card">
        <h3 style="margin:0 0 16px">Credit Terms</h3>
        <div class="form-grid">
          <div class="field">
            <label>Default Sales Due Days</label>
            <input id="cc-sales-due" type="number" min="0" step="1" />
          </div>
          <div class="field">
            <label>Default Purchase Due Days</label>
            <input id="cc-purchase-due" type="number" min="0" step="1" />
          </div>
        </div>
        <div style="font-size:.72rem;color:var(--muted);margin-top:8px">
          Used on Credit Sale/Purchase bills when the party itself has no Credit Due Days set —
          set that on a per-party basis under Parties to override this default.
        </div>
      </div>

      <div class="card">
        <h3 style="margin:0 0 16px">Aging &amp; Period Lock</h3>

        <div class="field" style="margin-bottom:6px">
          <label style="text-transform:none;font-size:.8rem;font-weight:500;letter-spacing:normal;color:var(--text)">
            Aging bucket boundaries (days)
          </label>
        </div>
        <div class="form-grid" style="grid-template-columns:repeat(4, 1fr);margin-bottom:16px">
          <div class="field">
            <label>Bucket 1 ends</label>
            <input id="cc-age-b1" type="number" min="1" step="1" />
          </div>
          <div class="field">
            <label>Bucket 2 ends</label>
            <input id="cc-age-b2" type="number" min="1" step="1" />
          </div>
          <div class="field">
            <label>Bucket 3 ends</label>
            <input id="cc-age-b3" type="number" min="1" step="1" />
          </div>
          <div class="field">
            <label>Bucket 4 ends</label>
            <input id="cc-age-b4" type="number" min="1" step="1" />
          </div>
        </div>

        <div class="field">
          <label style="text-transform:none;font-size:.8rem;font-weight:500;letter-spacing:normal;color:var(--text)">
            Transaction lock date (English) — vouchers on/before are blocked
          </label>
          <input id="cc-lock-date" type="date" />
        </div>
      </div>

      <div id="cc-err" hidden style="color:#DC2626;font-size:.85rem;margin-bottom:12px;padding:8px 10px;background:#FEF2F2;border-radius:6px"></div>
      <div id="cc-ok" hidden style="color:#065F46;font-size:.85rem;margin-bottom:12px;padding:8px 10px;background:#D1FAE5;border-radius:6px">Settings saved.</div>

      <button type="submit" id="cc-save" class="btn btn-primary">Save settings</button>
    </form>
  `;

  const form = el.querySelector<HTMLFormElement>('#cc-form')!;
  const errBox = el.querySelector<HTMLElement>('#cc-err')!;
  const okBox  = el.querySelector<HTMLElement>('#cc-ok')!;

  const nameIn    = el.querySelector<HTMLInputElement>('#cc-name')!;
  const addrIn    = el.querySelector<HTMLTextAreaElement>('#cc-address')!;
  const panIn     = el.querySelector<HTMLInputElement>('#cc-pan')!;
  const phoneIn   = el.querySelector<HTMLInputElement>('#cc-phone')!;
  const emailIn   = el.querySelector<HTMLInputElement>('#cc-email')!;
  const fyIn      = el.querySelector<HTMLInputElement>('#cc-fy-start')!;
  const bizSel    = el.querySelector<HTMLSelectElement>('#cc-business-type')!;
  const b1In      = el.querySelector<HTMLInputElement>('#cc-age-b1')!;
  const b2In      = el.querySelector<HTMLInputElement>('#cc-age-b2')!;
  const b3In      = el.querySelector<HTMLInputElement>('#cc-age-b3')!;
  const b4In      = el.querySelector<HTMLInputElement>('#cc-age-b4')!;
  const lockIn    = el.querySelector<HTMLInputElement>('#cc-lock-date')!;
  const vatPctIn  = el.querySelector<HTMLInputElement>('#cc-vat-pct')!;
  const vatPayIn  = el.querySelector<HTMLInputElement>('#cc-vat-payable')!;
  const vatRecIn  = el.querySelector<HTMLInputElement>('#cc-vat-receivable')!;
  const salesDueIn    = el.querySelector<HTMLInputElement>('#cc-sales-due')!;
  const purchaseDueIn = el.querySelector<HTMLInputElement>('#cc-purchase-due')!;
  const saveBtn   = el.querySelector<HTMLButtonElement>('#cc-save')!;

  wireAcctTypeahead(el, 'cc-vat-payable');
  wireAcctTypeahead(el, 'cc-vat-receivable');

  async function load(): Promise<void> {
    try {
      const c = await getCompanyConfig();
      nameIn.value  = c.company_name ?? '';
      addrIn.value  = c.address ?? '';
      panIn.value   = c.pan_no ?? '';
      phoneIn.value = c.phone ?? '';
      emailIn.value = c.email ?? '';
      fyIn.value    = c.fiscal_year_start ?? '';
      bizSel.value  = c.business_type ?? 'service';
      b1In.value    = c.age_b1 != null ? String(c.age_b1) : '30';
      b2In.value    = c.age_b2 != null ? String(c.age_b2) : '60';
      b3In.value    = c.age_b3 != null ? String(c.age_b3) : '90';
      b4In.value    = c.age_b4 != null ? String(c.age_b4) : '120';
      lockIn.value  = c.lock_date ?? '';
      vatPctIn.value = c.vat_pct != null ? String(c.vat_pct) : '0';
      vatPayIn.value = c.vat_payable_account_no ?? '';
      vatPayIn.dataset['confirmed'] = vatPayIn.value;
      vatRecIn.value = c.vat_receivable_account_no ?? '';
      vatRecIn.dataset['confirmed'] = vatRecIn.value;
      salesDueIn.value    = c.default_sales_due_days != null ? String(c.default_sales_due_days) : '0';
      purchaseDueIn.value = c.default_purchase_due_days != null ? String(c.default_purchase_due_days) : '0';
    } catch (e: unknown) {
      errBox.textContent = e instanceof Error ? e.message : String(e);
      errBox.hidden = false;
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    okBox.hidden = true;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    const payload: CompanyConfig = {
      company_name:      nameIn.value.trim(),
      address:            addrIn.value.trim() || undefined,
      pan_no:             panIn.value.trim() || undefined,
      phone:              phoneIn.value.trim() || undefined,
      email:              emailIn.value.trim() || undefined,
      fiscal_year_start:  fyIn.value.trim(),
      business_type:      bizSel.value as 'service' | 'trading',
      age_b1:             b1In.value ? Number(b1In.value) : undefined,
      age_b2:             b2In.value ? Number(b2In.value) : undefined,
      age_b3:             b3In.value ? Number(b3In.value) : undefined,
      age_b4:             b4In.value ? Number(b4In.value) : undefined,
      lock_date:          lockIn.value || undefined,
      vat_pct:                    vatPctIn.value ? Number(vatPctIn.value) : 0,
      vat_payable_account_no:     vatPayIn.value.trim() || undefined,
      vat_receivable_account_no:  vatRecIn.value.trim() || undefined,
      default_sales_due_days:     salesDueIn.value ? Number(salesDueIn.value) : 0,
      default_purchase_due_days:  purchaseDueIn.value ? Number(purchaseDueIn.value) : 0,
    };

    try {
      await saveCompanyConfig(payload);
      okBox.hidden = false;
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      errBox.textContent = /foreign key|fk_cfg_vat/i.test(raw)
        ? 'The VAT Payable or VAT Receivable account you picked no longer exists in Chart of Accounts. ' +
          'Re-select it from the dropdown (create the account first if it is missing), then save again.'
        : raw;
      errBox.hidden = false;
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save settings';
    }
  });

  load();
}

// ── account typeahead for the VAT account fields ───────────────────────────────
// Pick-only: a value only "sticks" when clicked from the dropdown (tracked via
// dataset.confirmed). Free-typed text that was never picked reverts on blur, so
// Save can never be sent a code that doesn't exist in Chart of Accounts — the
// VAT Payable/Receivable columns have a real foreign-key constraint to it, and
// silently failing that constraint is what looked like "the setting won't save".
function wireAcctTypeahead(el: HTMLElement, idPrefix: string): void {
  const input = el.querySelector<HTMLInputElement>(`#${idPrefix}`);
  const drop  = el.querySelector<HTMLElement>(`#${idPrefix}-drop`);
  if (!input || !drop) return;
  let timer: ReturnType<typeof setTimeout>;

  const search = async (term: string) => {
    try {
      const res = await lookupData('accounts', term);
      if (!res.rows.length) { drop.hidden = true; return; }
      drop.innerHTML = res.rows.map(r => `
        <div class="${idPrefix}-di" data-v="${escAttr(r.value)}"
          style="padding:6px 10px;cursor:pointer;font-size:.82rem;border-bottom:1px solid var(--border);
                 display:flex;gap:8px;align-items:center">
          <span style="font-family:monospace;font-weight:600;flex-shrink:0">${escHtml(r.value)}</span>
          <span style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.label)}</span>
        </div>`).join('');
      drop.hidden = false;
      drop.querySelectorAll<HTMLElement>(`.${idPrefix}-di`).forEach(item => {
        item.addEventListener('mouseenter', () => item.style.background = 'var(--border)');
        item.addEventListener('mouseleave', () => item.style.background = '');
        item.addEventListener('mousedown', () => {
          input.value = item.dataset['v']!;
          input.dataset['confirmed'] = input.value;
          drop.hidden = true;
        });
      });
    } catch { drop.hidden = true; }
  };

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => search(input.value.trim()), 250); });
  input.addEventListener('focus', () => search(input.value.trim()));
  input.addEventListener('blur',  () => {
    setTimeout(() => {
      drop.hidden = true;
      const val = input.value.trim();
      if (val === '') { input.dataset['confirmed'] = ''; return; }  // clearing is a valid, explicit choice
      const confirmed = input.dataset['confirmed'] ?? '';
      if (val !== confirmed) input.value = confirmed;               // typed-but-never-picked text reverts
    }, 200);
  });
}
