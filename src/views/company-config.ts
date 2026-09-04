/** company-config.ts — Company Settings */

import { getCompanyConfig, saveCompanyConfig } from '../services/config';
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
  const saveBtn   = el.querySelector<HTMLButtonElement>('#cc-save')!;

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
    };

    try {
      await saveCompanyConfig(payload);
      okBox.hidden = false;
    } catch (err: unknown) {
      errBox.textContent = err instanceof Error ? err.message : String(err);
      errBox.hidden = false;
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save settings';
    }
  });

  load();
}
