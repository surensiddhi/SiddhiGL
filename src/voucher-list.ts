/**
 * voucher-list.ts — Transaction list (voucher-list).
 * Tabs: New (unapproved) | Approved | All
 * DB: lk_voucher_list(p_tenant, p_caller, p_status?)
 *   → {id, voucher_no, voucher_date, tran_type, description, status}
 */

import { listVouchers, approveVoucher, unapproveVoucher, postMany, postVoucher } from '../services/voucher';
import type { VoucherRow } from '../services/voucher';
import { confirmDialog } from '../components/confirm-dialog';
import { can } from '../lib/perm';
import { isoToBs } from '../lib/bs-calendar';

type TabStatus = 'unapproved' | 'approved' | 'all';

const TABS: { status: TabStatus; label: string }[] = [
  { status: 'unapproved', label: 'New'      },
  { status: 'approved',   label: 'Approved' },
  { status: 'all',        label: 'All'      },
];

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

export function init(el: HTMLElement): void {
  let activeTab: TabStatus = 'unapproved';
  let allRows: VoucherRow[]  = [];
  let searchTerm   = '';
  let filterType   = '';
  let selectedIds  = new Set<number>();
  let loading      = false;

  const canApprove = can('voucher.approve');
  const canPost    = can('voucher.post');
  const canCreate  = can('voucher.create');

  // ── Shell ──────────────────────────────────────────────────────────────────

  el.innerHTML = `
    <div class="page-header">
      <span class="page-title">Transactions</span>
      <div style="display:flex;gap:8px;align-items:center">
        ${canPost   ? `<button id="vl-post-many" class="btn btn-secondary" disabled>Post Selected</button>` : ''}
        ${canCreate ? `<a href="#voucher-form" class="btn btn-primary">+ New Voucher</a>` : ''}
      </div>
    </div>

    <div class="card" style="padding:0">

      <!-- Tabs -->
      <div class="vl-tabs">
        ${TABS.map(t => `<button class="vl-tab${t.status === activeTab ? ' active' : ''}" data-status="${t.status}">${t.label}</button>`).join('')}
      </div>

      <!-- Toolbar -->
      <div class="toolbar" style="padding:10px 16px;gap:8px;flex-wrap:wrap">
        <input id="vl-search" type="text" placeholder="Search voucher no or description…"
          style="flex:1;min-width:200px;max-width:320px;border:1px solid var(--border);
                 border-radius:5px;padding:5px 10px;font-size:.875rem;
                 background:var(--surface);color:var(--text)" />
        <button id="vl-search-btn" class="btn btn-secondary">Search</button>
        <button id="vl-clear-btn"  class="btn btn-secondary">Clear</button>
        <select id="vl-type" class="at-select" style="width:120px">
          ${TRAN_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
        </select>
        <span id="vl-count" style="margin-left:auto;color:var(--muted);font-size:0.8rem"></span>
      </div>

      <!-- Table -->
      <div id="vl-body" style="overflow-x:auto">
        <div class="loading-msg">Loading…</div>
      </div>

    </div>
  `;

  // ── Controls ───────────────────────────────────────────────────────────────

  el.querySelectorAll<HTMLButtonElement>('.vl-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      el.querySelectorAll('.vl-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeTab = tab.dataset['status'] as TabStatus;
      selectedIds.clear();
      load();
    });
  });

  const searchInput = el.querySelector<HTMLInputElement>('#vl-search')!;
  const typeSelect  = el.querySelector<HTMLSelectElement>('#vl-type')!;

  el.querySelector('#vl-search-btn')!.addEventListener('click', () => {
    searchTerm = searchInput.value.trim().toLowerCase();
    renderTable();
  });

  el.querySelector('#vl-clear-btn')!.addEventListener('click', () => {
    searchInput.value = '';
    searchTerm   = '';
    filterType   = '';
    typeSelect.value = '';
    renderTable();
  });

  // Search on Enter
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

  const postManyBtn = el.querySelector<HTMLButtonElement>('#vl-post-many');

  if (postManyBtn) {
    postManyBtn.addEventListener('click', async () => {
      if (!selectedIds.size) return;
      const ok = await confirmDialog(`Post ${selectedIds.size} approved voucher(s)?`, 'Post Vouchers');
      if (!ok) return;
      postManyBtn.disabled = true;
      try {
        await postMany(Array.from(selectedIds));
        selectedIds.clear();
        await load();
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : 'Post failed');
        postManyBtn.disabled = false;
      }
    });
  }

  // ── Load ───────────────────────────────────────────────────────────────────

  async function load(): Promise<void> {
    if (loading) return;
    loading = true;
    el.querySelector('#vl-body')!.innerHTML = '<div class="loading-msg">Loading…</div>';
    try {
      const status = activeTab === 'all' ? 'all' : activeTab;
      const data = await listVouchers(status) as VoucherRow[];
      allRows = data ?? [];
      renderTable();
    } catch (err: unknown) {
      el.querySelector('#vl-body')!.innerHTML =
        `<div class="error-msg">${err instanceof Error ? err.message : 'Failed to load'}</div>`;
    } finally {
      loading = false;
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

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
    const tbody = el.querySelector('#vl-body')!;
    const rows  = filtered();

    // Update count
    el.querySelector('#vl-count')!.textContent =
      `${rows.length} of ${allRows.length} voucher${allRows.length !== 1 ? 's' : ''}`;

    // Checkbox column on Unapproved and Approved tabs for bulk posting
    const showCheck = canPost && (activeTab === 'unapproved' || activeTab === 'approved');

    if (!rows.length) {
      tbody.innerHTML = `<div class="loading-msg">No vouchers found.</div>`;
      updatePostBtn();
      return;
    }

    tbody.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            ${showCheck ? `<th style="width:36px"><input type="checkbox" id="vl-check-all" title="Select all" /></th>` : ''}
            <th>Voucher No</th>
            <th>Date (BS)</th>
            <th style="width:60px">Type</th>
            <th>Description</th>
            <th style="width:110px">Status</th>
            <th style="width:140px">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => rowHtml(r, showCheck)).join('')}
        </tbody>
      </table>
    `;

    // Select-all
    if (showCheck) {
      const chkAll = tbody.querySelector<HTMLInputElement>('#vl-check-all')!;
      chkAll.addEventListener('change', () => {
        tbody.querySelectorAll<HTMLInputElement>('.vl-chk').forEach(c => {
          c.checked = chkAll.checked;
          const id = parseInt(c.dataset['id']!);
          if (chkAll.checked) selectedIds.add(id); else selectedIds.delete(id);
        });
        updatePostBtn();
      });
    }

    // Row checkboxes
    tbody.querySelectorAll<HTMLInputElement>('.vl-chk').forEach(chk => {
      chk.addEventListener('change', () => {
        const id = parseInt(chk.dataset['id']!);
        if (chk.checked) selectedIds.add(id); else selectedIds.delete(id);
        updatePostBtn();
      });
    });

    // Action buttons
    tbody.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => handleAction(btn));
    });
  }

  function rowHtml(r: VoucherRow, showCheck: boolean): string {
    const isUnapproved = r.status === 'unapproved';
    const isApproved   = r.status === 'approved';

    const badge = isUnapproved
      ? `<span class="badge badge-pending">unapproved</span>`
      : isApproved
        ? `<span class="badge badge-approved">approved</span>`
        : `<span class="badge badge-posted">posted</span>`;

    const actions: string[] = [];
    actions.push(`<a href="#voucher-form?head_id=${r.id}" class="btn btn-secondary" style="padding:3px 8px;font-size:0.78rem">Edit</a>`);
    if (canApprove && isUnapproved)                actions.push(`<button class="btn btn-secondary" data-action="approve"   data-id="${r.id}" style="padding:3px 8px;font-size:0.78rem">Approve</button>`);
    if (canApprove && isApproved)                  actions.push(`<button class="btn btn-secondary" data-action="unapprove" data-id="${r.id}" style="padding:3px 8px;font-size:0.78rem">Unapprove</button>`);
    if (canPost    && (isUnapproved || isApproved)) actions.push(`<button class="btn btn-primary"   data-action="post"      data-id="${r.id}" style="padding:3px 8px;font-size:0.78rem">Post</button>`);

    return `
      <tr>
        ${showCheck ? `<td><input type="checkbox" class="vl-chk" data-id="${r.id}" ${selectedIds.has(r.id) ? 'checked' : ''} /></td>` : ''}
        <td style="font-family:monospace;font-size:.88rem">${r.voucher_no}</td>
        <td>${bsDisplay(r.voucher_date)}</td>
        <td><span class="badge badge-posted" style="font-size:0.7rem">${r.tran_type}</span></td>
        <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)">${r.description ?? ''}</td>
        <td>${badge}</td>
        <td><div style="display:flex;gap:4px">${actions.join('')}</div></td>
      </tr>
    `;
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  async function handleAction(btn: HTMLButtonElement): Promise<void> {
    const action = btn.dataset['action']!;
    const id     = parseInt(btn.dataset['id']!);
    btn.disabled = true;
    try {
      if (action === 'approve') {
        await approveVoucher(id);
      } else if (action === 'unapprove') {
        const ok = await confirmDialog('Move this voucher back to unapproved?', 'Unapprove Voucher');
        if (!ok) { btn.disabled = false; return; }
        await unapproveVoucher(id);
      } else if (action === 'post') {
        const ok = await confirmDialog('Post this voucher? A permanent number will be assigned and it cannot be edited afterwards.', 'Post Voucher');
        if (!ok) { btn.disabled = false; return; }
        await postVoucher(id);
      }
      await load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Action failed');
      btn.disabled = false;
    }
  }

  function updatePostBtn(): void {
    if (!postManyBtn) return;
    postManyBtn.disabled = selectedIds.size === 0;
    if (selectedIds.size > 0) {
      postManyBtn.textContent = `Post Selected (${selectedIds.size})`;
    } else {
      postManyBtn.textContent = 'Post Selected';
    }
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  load();
}
