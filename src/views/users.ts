/** users.ts — User Management (Administration) */

import { usersList, userCreate, userUpdate, userSetActive, userResetPassword, type UserRow } from '../services/user-mgmt';

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'viewer',  label: 'viewer — read only' },
  { value: 'user',    label: 'user — data entry' },
  { value: 'manager', label: 'manager — approve & reports' },
  { value: 'admin',   label: 'admin — full access' },
];

function injectStyles(): void {
  if (document.getElementById('um-styles')) return;
  const s = document.createElement('style');
  s.id = 'um-styles';
  s.textContent = `
    .badge-role     { background:#E0E7FF; color:#3730A3; }
    .badge-inactive { background:#FEE2E2; color:#991B1B; }

    #um-overlay {
      position: fixed; inset: 0;
      background: rgba(15, 23, 42, 0.45);
      display: flex; align-items: center; justify-content: center;
      z-index: 1000;
    }
    #um-modal {
      background: var(--surface);
      border-radius: 10px;
      width: 460px;
      max-width: calc(100vw - 40px);
      max-height: calc(100vh - 60px);
      overflow-y: auto;
      padding: 24px 28px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.25);
    }
    #um-modal .um-modal-head {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 18px;
    }
    #um-modal .um-modal-head strong { font-size: 1.15rem; }
    #um-modal .um-modal-close {
      background: none; border: none; cursor: pointer;
      font-size: 1.3rem; color: var(--muted); line-height: 1;
    }
    #um-modal .field { margin-bottom: 14px; }
    #um-form-err {
      color:#DC2626; font-size:.8rem; margin-bottom:12px;
      padding:6px 8px; background:#FEF2F2; border-radius:5px;
    }
    .um-actions a { cursor: pointer; margin-right: 10px; font-size: 0.85rem; }
    .um-actions a:last-child { margin-right: 0; }
  `;
  document.head.appendChild(s);
}

export function init(el: HTMLElement): void {
  injectStyles();

  el.innerHTML = `
    <div class="page-header">
      <span class="page-title">User Management</span>
    </div>
    <div class="card">
      <div style="display:flex;gap:10px;margin-bottom:16px">
        <button id="um-add" class="btn btn-primary">Add User</button>
        <button id="um-refresh" class="btn btn-secondary">Refresh</button>
      </div>

      <table class="data-table" id="um-table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Full Name</th>
            <th>Role</th>
            <th>Status</th>
            <th>Last Login</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="um-body">
          <tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px">Loading…</td></tr>
        </tbody>
      </table>
    </div>
    <div id="um-modal-root"></div>
  `;

  const body = el.querySelector<HTMLTableSectionElement>('#um-body')!;
  const modalRoot = el.querySelector<HTMLElement>('#um-modal-root')!;

  let rows: UserRow[] = [];

  async function load(): Promise<void> {
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px">Loading…</td></tr>`;
    try {
      rows = await usersList();
      render();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      body.innerHTML = `<tr><td colspan="6" style="color:red;padding:10px">${msg}</td></tr>`;
    }
  }

  function fmtLastLogin(v: string | null): string {
    if (!v) return '—';
    const d = new Date(v);
    return d.toLocaleString('en-US', {
      month: 'numeric', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
    });
  }

  function render(): void {
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px">No users.</td></tr>`;
      return;
    }
    body.innerHTML = rows.map(u => `
      <tr data-username="${u.username}">
        <td>${u.username}</td>
        <td>${u.full_name}</td>
        <td><span class="badge badge-role">${u.role}</span></td>
        <td>${u.active
          ? `<span class="badge badge-approved">active</span>`
          : `<span class="badge badge-inactive">inactive</span>`}</td>
        <td>${fmtLastLogin(u.last_login)}</td>
        <td class="um-actions">
          <a class="um-edit" style="color:var(--amber)">Edit</a>
          <a class="um-reset" style="color:var(--amber)">Reset PW</a>
          <a class="um-toggle" style="color:${u.active ? 'var(--red, #DC2626)' : 'var(--amber)'}">${u.active ? 'Deactivate' : 'Activate'}</a>
        </td>
      </tr>
    `).join('');

    body.querySelectorAll<HTMLElement>('.um-edit').forEach(a =>
      a.addEventListener('click', () => {
        const username = a.closest('tr')!.dataset.username!;
        const u = rows.find(r => r.username === username);
        if (u) openForm(u);
      }));

    body.querySelectorAll<HTMLElement>('.um-reset').forEach(a =>
      a.addEventListener('click', () => {
        const username = a.closest('tr')!.dataset.username!;
        openResetPassword(username);
      }));

    body.querySelectorAll<HTMLElement>('.um-toggle').forEach(a =>
      a.addEventListener('click', async () => {
        const username = a.closest('tr')!.dataset.username!;
        const u = rows.find(r => r.username === username);
        if (!u) return;
        const verb = u.active ? 'deactivate' : 'activate';
        if (!confirm(`Are you sure you want to ${verb} "${username}"?`)) return;
        try {
          await userSetActive(username, !u.active);
          await load();
        } catch (e: unknown) {
          alert(e instanceof Error ? e.message : String(e));
        }
      }));
  }

  function closeModal(): void {
    modalRoot.innerHTML = '';
  }

  function openForm(existing?: UserRow): void {
    const isEdit = !!existing;
    modalRoot.innerHTML = `
      <div id="um-overlay">
        <div id="um-modal">
          <div class="um-modal-head">
            <strong>${isEdit ? 'Edit User' : 'Add User'}</strong>
            <button class="um-modal-close" id="um-close">&times;</button>
          </div>
          <form id="um-form">
            <div class="field">
              <label>Username</label>
              <input id="um-username" type="text" required maxlength="40"
                value="${existing?.username ?? ''}" ${isEdit ? 'readonly' : ''} />
            </div>
            <div class="field">
              <label>Full Name</label>
              <input id="um-fullname" type="text" required maxlength="100" value="${existing?.full_name ?? ''}" />
            </div>
            <div class="field">
              <label>Email (optional)</label>
              <input id="um-email" type="email" maxlength="150" value="${existing?.email ?? ''}" />
            </div>
            <div class="field">
              <label>Role</label>
              <select id="um-role">
                ${ROLE_OPTIONS.map(r => `<option value="${r.value}" ${existing?.role === r.value ? 'selected' : ''}>${r.label}</option>`).join('')}
              </select>
            </div>
            ${!isEdit ? `
            <div class="field">
              <label>Temporary Password</label>
              <input id="um-temp-pw" type="text" placeholder="user must change on first login" required minlength="4" />
            </div>` : ''}
            <div id="um-form-err" hidden></div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px">
              <button type="button" id="um-cancel" class="btn btn-secondary">Cancel</button>
              <button type="submit" id="um-save" class="btn btn-primary">Save</button>
            </div>
          </form>
        </div>
      </div>
    `;

    const overlay = modalRoot.querySelector<HTMLElement>('#um-overlay')!;
    const errBox  = modalRoot.querySelector<HTMLElement>('#um-form-err')!;

    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
    modalRoot.querySelector('#um-close')!.addEventListener('click', closeModal);
    modalRoot.querySelector('#um-cancel')!.addEventListener('click', closeModal);

    modalRoot.querySelector('#um-form')!.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.hidden = true;

      const username  = (modalRoot.querySelector('#um-username') as HTMLInputElement).value.trim();
      const full_name = (modalRoot.querySelector('#um-fullname') as HTMLInputElement).value.trim();
      const email     = (modalRoot.querySelector('#um-email') as HTMLInputElement).value.trim();
      const role      = (modalRoot.querySelector('#um-role') as HTMLSelectElement).value;

      try {
        if (isEdit) {
          await userUpdate({ username, full_name, email: email || undefined, role });
        } else {
          const temp_password = (modalRoot.querySelector('#um-temp-pw') as HTMLInputElement).value;
          await userCreate({ username, full_name, email: email || undefined, role, temp_password });
        }
        closeModal();
        await load();
      } catch (err: unknown) {
        errBox.textContent = err instanceof Error ? err.message : String(err);
        errBox.hidden = false;
      }
    });
  }

  function openResetPassword(username: string): void {
    modalRoot.innerHTML = `
      <div id="um-overlay">
        <div id="um-modal" style="width:380px">
          <div class="um-modal-head">
            <strong>Reset Password</strong>
            <button class="um-modal-close" id="um-close">&times;</button>
          </div>
          <form id="um-reset-form">
            <div class="field">
              <label>New Temporary Password for "${username}"</label>
              <input id="um-new-pw" type="text" required minlength="4" placeholder="user must change on first login" />
            </div>
            <div id="um-form-err" hidden></div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px">
              <button type="button" id="um-cancel" class="btn btn-secondary">Cancel</button>
              <button type="submit" id="um-save" class="btn btn-primary">Reset</button>
            </div>
          </form>
        </div>
      </div>
    `;

    const overlay = modalRoot.querySelector<HTMLElement>('#um-overlay')!;
    const errBox  = modalRoot.querySelector<HTMLElement>('#um-form-err')!;

    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
    modalRoot.querySelector('#um-close')!.addEventListener('click', closeModal);
    modalRoot.querySelector('#um-cancel')!.addEventListener('click', closeModal);

    modalRoot.querySelector('#um-reset-form')!.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.hidden = true;
      const pw = (modalRoot.querySelector('#um-new-pw') as HTMLInputElement).value;
      try {
        await userResetPassword(username, pw);
        closeModal();
      } catch (err: unknown) {
        errBox.textContent = err instanceof Error ? err.message : String(err);
        errBox.hidden = false;
      }
    });
  }

  el.querySelector('#um-add')!.addEventListener('click', () => openForm());
  el.querySelector('#um-refresh')!.addEventListener('click', load);

  load();
}
