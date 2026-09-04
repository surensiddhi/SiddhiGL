/**
 * posted-list.ts — Posted vouchers (read-only).
 * DB: lk_posted_list(p_tenant, p_caller)
 *     get_posted_voucher(p_tenant, p_caller, p_head_id)  → jsonb with .lines[]
 */

import { listPosted, getPostedVoucher } from '../services/voucher';
import type { VoucherRow } from '../services/voucher';
import { isoToBs } from '../lib/bs-calendar';

const TRAN_TYPES = [
  { value: '',    label: 'All Types' },
  { value: 'JV',  label: 'JV'  },
  { value: 'PV',  label: 'PV'  },
  { value: 'RV',  label: 'RV'  },
  { value: 'CV',  label: 'CV'  },
  { value: 'SV',  label: 'SV'  },
  { value: 'PUR', label: 'PUR' },
];

function bsDisplay(iso: string): string {
  const bs = isoToBs(iso);
  return bs ? bs.replace(/\//g, '-') : iso;
}

function fmt(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function init(el: HTMLElement): void {
  let allRows:    VoucherRow[] = [];
  let searchTerm = '';
  let filterType = '';
  let loading    = false;

  // ── Shell ──────────────────────────────────────────────────────────────────

  el.innerHTML = `
    <div class="page-header">
      <span class="page-title">Posted Vouchers</span>
    </div>

    <div class="card" style="padding:0">

      <!-- Toolbar -->
      <div class="toolbar" style="padding:10px 16px;gap:8px;flex-wrap:wrap">
        <input id="pl-search" type="text" placeholder="Search voucher no or description…"
          style="flex:1;min-width:200px;max-width:320px;border:1px solid var(--border);
                 border-radius:5px;padding:5px 10px;font-size:.875rem;
                 background:var(--surface);color:var(--text)" />
        <button id="pl-search-btn" class="btn btn-secondary">Search</button>
        <button id="pl-clear-btn"  class="btn btn-secondary">Clear</button>
        <select id="pl-type" class="at-select" style="width:120px">
          ${TRAN_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
        </select>
        <span id="pl-count" style="margin-left:auto;color:var(--muted);font-size:0.8rem"></span>
      </div>

      <!-- Table -->
      <div id="pl-body" style="overflow-x:auto">
        <div class="loading-msg">Loading…</div>
      </div>

    </div>

    <!-- Detail Modal -->
    <div id="pl-modal" hidden
      style="position:fixed;inset:0;z-index:500;background:rgba(0,0,0,.45);
             align-items:flex-start;justify-content:center;
             padding:40px 16px;overflow-y:auto">
      <div style="background:var(--surface);border-radius:10px;width:100%;max-width:900px;
                  box-shadow:0 8px 40px rgba(0,0,0,.3);margin:auto">
        <div style="display:flex;align-items:center;justify-content:space-between;
                    padding:14px 20px;border-bottom:1px solid var(--border)">
          <span id="pl-modal-title"
            style="font-weight:700;font-size:1rem;color:var(--text);font-family:monospace">
            Voucher Detail
          </span>
          <button id="pl-modal-close" class="btn btn-secondary"
            style="padding:3px 12px;font-size:.82rem">✕ Close</button>
        </div>
        <div id="pl-modal-body" style="padding:20px 24px">
          <div class="loading-msg">Loading…</div>
        </div>
      </div>
    </div>
  `;

  // ── Controls ───────────────────────────────────────────────────────────────

  const searchInput = el.querySelector<HTMLInputElement>('#pl-search')!;
  const typeSelect  = el.querySelector<HTMLSelectElement>('#pl-type')!;
  const modal       = el.querySelector<HTMLElement>('#pl-modal')!;
  const modalTitle  = el.querySelector<HTMLElement>('#pl-modal-title')!;
  const modalBody   = el.querySelector<HTMLElement>('#pl-modal-body')!;

  el.querySelector('#pl-search-btn')!.addEventListener('click', () => {
    searchTerm = searchInput.value.trim().toLowerCase();
    renderTable();
  });

  el.querySelector('#pl-clear-btn')!.addEventListener('click', () => {
    searchInput.value = '';
    searchTerm   = '';
    filterType   = '';
    typeSelect.value = '';
    renderTable();
  });

  searchInput.addEventListener('keydown', e => {
    if ((e as KeyboardEvent).key === 'Enter') {
      searchTerm = searchInput.value.trim().toLowerCase();
      renderTable();
    }
  });

  typeSelect.addEventListener('change', () => {
    filterType = typeSelect.value;
    renderTable();
  });

  function closeModal(): void {
    modal.hidden = true;
    modal.style.display = '';
  }

  el.querySelector('#pl-modal-close')!.addEventListener('click', closeModal);

  // Close on backdrop click
  modal.addEventListener('click', e => {
    if (e.target === modal) closeModal();
  });

  // ── Load list ──────────────────────────────────────────────────────────────

  async function load(): Promise<void> {
    if (loading) return;
    loading = true;
    el.querySelector('#pl-body')!.innerHTML = '<div class="loading-msg">Loading…</div>';
    try {
      const data = await listPosted() as VoucherRow[];
      allRows = data ?? [];
      renderTable();
    } catch (err: unknown) {
      el.querySelector('#pl-body')!.innerHTML =
        `<div class="error-msg">${err instanceof Error ? err.message : 'Failed to load'}</div>`;
    } finally {
      loading = false;
    }
  }

  // ── Render table ───────────────────────────────────────────────────────────

  function filtered(): VoucherRow[] {
    return allRows.filter(r => {
      if (filterType && r.tran_type !== filterType) return false;
      if (searchTerm) {
        const hay = `${r.voucher_no} ${r.description}`.toLowerCase();
        if (!hay.includes(searchTerm)) return false;
      }
      return true;
    });
  }

  function renderTable(): void {
    const tbody = el.querySelector('#pl-body')!;
    const rows  = filtered();

    el.querySelector('#pl-count')!.textContent =
      `${rows.length} of ${allRows.length} voucher${allRows.length !== 1 ? 's' : ''}`;

    if (!rows.length) {
      tbody.innerHTML = `<div class="loading-msg">No posted vouchers found.</div>`;
      return;
    }

    tbody.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Voucher No</th>
            <th>Date (BS)</th>
            <th style="width:60px">Type</th>
            <th>Description</th>
            <th style="width:90px">Status</th>
            <th style="width:80px;text-align:center">Detail</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td style="font-family:monospace;font-size:.88rem">${esc(r.voucher_no)}</td>
              <td>${bsDisplay(r.voucher_date)}</td>
              <td>
                <span class="badge badge-posted" style="font-size:.7rem">${esc(r.tran_type)}</span>
              </td>
              <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;
                         white-space:nowrap;color:var(--text)">
                ${esc(r.description ?? '')}
              </td>
              <td><span class="badge badge-posted">posted</span></td>
              <td style="text-align:center">
                <button class="btn btn-secondary pl-view-btn" data-id="${r.id}"
                  style="padding:3px 10px;font-size:.78rem">View</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    tbody.querySelectorAll<HTMLButtonElement>('.pl-view-btn').forEach(btn => {
      btn.addEventListener('click', () => openDetail(parseInt(btn.dataset['id']!)));
    });
  }

  // ── Detail modal ───────────────────────────────────────────────────────────

  async function openDetail(headId: number): Promise<void> {
    modalTitle.textContent  = 'Loading…';
    modalBody.innerHTML     = '<div class="loading-msg">Loading…</div>';
    modal.hidden            = false;
    modal.style.display     = 'flex';

    try {
      const v = await getPostedVoucher(headId);

      const adDate = (v.voucher_date ?? '').slice(0, 10);
      const bsDate = adDate ? bsDisplay(adDate) : '';
      const lines: any[] = Array.isArray(v.lines) ? v.lines : [];

      let totalDr = 0;
      let totalCr = 0;
      lines.forEach(l => {
        totalDr += Number(l.debit  ?? 0);
        totalCr += Number(l.credit ?? 0);
      });

      const diff = Math.abs(totalDr - totalCr);

      modalTitle.textContent = `${v.voucher_no ?? ''} — ${v.tran_type ?? ''}`;

      modalBody.innerHTML = `
        <!-- Header grid -->
        <div style="display:grid;grid-template-columns:140px 1fr 140px 1fr;
                    gap:6px 20px;margin-bottom:20px;font-size:.875rem">

          <span style="font-weight:700;color:var(--muted)">Voucher No</span>
          <span style="font-family:monospace">${esc(v.voucher_no ?? '')}</span>
          <span style="font-weight:700;color:var(--muted)">Date (BS)</span>
          <span>${bsDate}</span>

          <span style="font-weight:700;color:var(--muted)">Type</span>
          <span>
            <span class="badge badge-posted" style="font-size:.7rem">${esc(v.tran_type ?? '')}</span>
          </span>
          <span style="font-weight:700;color:var(--muted)">Date (AD)</span>
          <span>${adDate}</span>

          <span style="font-weight:700;color:var(--muted)">Description</span>
          <span style="grid-column:2 / -1">${esc(v.description ?? '')}</span>

          ${v.footer_note ? `
            <span style="font-weight:700;color:var(--muted)">Note</span>
            <span style="grid-column:2 / -1">${esc(v.footer_note)}</span>
          ` : ''}
        </div>

        <!-- Lines -->
        <div style="overflow-x:auto">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width:120px">Account</th>
                <th style="width:110px">Party</th>
                <th>Line Description</th>
                <th style="width:120px;text-align:right">Debit</th>
                <th style="width:120px;text-align:right">Credit</th>
                <th style="width:100px">Cost Centre</th>
              </tr>
            </thead>
            <tbody>
              ${lines.length ? lines.map(l => `
                <tr>
                  <td style="font-family:monospace;font-size:.82rem;vertical-align:top">
                    ${esc(l.account_no ?? '')}
                    ${l.account_name
                      ? `<div style="font-size:.7rem;color:var(--muted);margin-top:2px">${esc(l.account_name)}</div>`
                      : ''}
                  </td>
                  <td style="font-size:.82rem;vertical-align:top">
                    ${esc(l.party_code ?? '')}
                    ${l.party_name
                      ? `<div style="font-size:.7rem;color:var(--muted);margin-top:2px">${esc(l.party_name)}</div>`
                      : ''}
                  </td>
                  <td style="font-size:.82rem;color:var(--text)">${esc(l.description ?? '')}</td>
                  <td style="text-align:right;font-family:monospace;font-size:.85rem">
                    ${Number(l.debit)  ? fmt(Number(l.debit))  : ''}
                  </td>
                  <td style="text-align:right;font-family:monospace;font-size:.85rem">
                    ${Number(l.credit) ? fmt(Number(l.credit)) : ''}
                  </td>
                  <td style="font-size:.82rem;color:var(--muted)">${esc(l.cost_centre_code ?? '')}</td>
                </tr>
              `).join('') : `
                <tr>
                  <td colspan="6" style="text-align:center;color:var(--muted);padding:12px">
                    No line items found.
                  </td>
                </tr>
              `}
            </tbody>
            <tfoot>
              <tr style="border-top:2px solid var(--border);background:var(--bg)">
                <td colspan="3"
                  style="text-align:right;font-weight:600;color:var(--muted);
                         font-size:.8rem;padding:6px 8px">
                  Totals
                </td>
                <td style="text-align:right;font-family:monospace;font-weight:700;
                           font-size:.9rem;padding:6px 8px;color:var(--text)">
                  ${fmt(totalDr)}
                </td>
                <td style="text-align:right;font-family:monospace;font-weight:700;
                           font-size:.9rem;padding:6px 8px;color:var(--text)">
                  ${fmt(totalCr)}
                </td>
                <td></td>
              </tr>
              ${diff > 0.001 ? `
                <tr>
                  <td colspan="3"
                    style="text-align:right;font-size:.78rem;color:#b91c1c;padding:3px 8px">
                    Difference
                  </td>
                  <td colspan="2"
                    style="text-align:right;font-family:monospace;font-size:.78rem;
                           color:#b91c1c;padding:3px 8px">
                    ${fmt(diff)}
                  </td>
                  <td></td>
                </tr>
              ` : ''}
            </tfoot>
          </table>
        </div>
      `;
    } catch (err: unknown) {
      modalBody.innerHTML =
        `<div class="error-msg">${err instanceof Error ? err.message : 'Failed to load voucher detail'}</div>`;
    }
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  load();
}
