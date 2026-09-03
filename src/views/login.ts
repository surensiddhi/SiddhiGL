/** login.ts — Login + forced/on-demand password change flow. */

import { login, changePassword, getSession } from '../lib/session';

export function init(el: HTMLElement): void {
  const session = getSession();
  if (session?.must_change_password) {
    renderChangePassword(el, true);
  } else {
    renderLogin(el);
  }
}

/** Called from sidebar for on-demand change password. */
export function initChangePassword(el: HTMLElement): void {
  renderChangePassword(el, false);
}

function renderLogin(el: HTMLElement): void {
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100dvh;background:#F5F5F4">
      <div style="background:#fff;border:1px solid #E7E5E4;border-radius:12px;padding:40px;width:360px;max-width:95vw">
        <h1 style="font-size:1.6rem;font-weight:900;margin-bottom:4px;letter-spacing:-.02em">
          Siddhi<span style="color:#0284C7">GL</span>
        </h1>
        <p style="color:#78716C;margin-bottom:28px;font-size:0.875rem">Accounting System</p>

        <form id="login-form">
          <div class="field" style="margin-bottom:14px">
            <label>Tenant ID</label>
            <input id="tenant-id" type="text" required autocomplete="organization" placeholder="e.g. NDS" />
          </div>
          <div class="field" style="margin-bottom:14px">
            <label>Username</label>
            <input id="username" type="text" required autocomplete="username" />
          </div>
          <div class="field" style="margin-bottom:20px">
            <label>Password</label>
            <input id="password" type="password" required autocomplete="current-password" />
          </div>
          <div id="login-error" hidden style="color:#DC2626;font-size:0.875rem;margin-bottom:12px;padding:8px;background:#FEF2F2;border-radius:6px"></div>
          <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center">
            Sign in
          </button>
        </form>
      </div>
    </div>
  `;

  const form    = el.querySelector<HTMLFormElement>('#login-form')!;
  const errorEl = el.querySelector<HTMLElement>('#login-error')!;
  const btn     = el.querySelector<HTMLButtonElement>('button[type=submit]')!;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Signing in…';

    const tenantId = (el.querySelector<HTMLInputElement>('#tenant-id')!).value.trim();
    const username = (el.querySelector<HTMLInputElement>('#username')!).value.trim();
    const password = (el.querySelector<HTMLInputElement>('#password')!).value;

    try {
      const session = await login(tenantId, username, password);
      if (session.must_change_password) {
        renderChangePassword(el, true);
      } else {
        window.location.hash = '#voucher-list';
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      errorEl.textContent = msg;
      errorEl.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });
}

function renderChangePassword(el: HTMLElement, forced: boolean): void {
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100dvh;background:#F5F5F4">
      <div style="background:#fff;border:1px solid #E7E5E4;border-radius:12px;padding:40px;width:380px;max-width:95vw">
        <h2 style="font-size:1.2rem;font-weight:700;margin-bottom:8px">
          ${forced ? '🔒 Password Change Required' : 'Change Password'}
        </h2>
        <p style="color:#78716C;margin-bottom:24px;font-size:0.875rem">
          ${forced
            ? 'Your account requires a new password before you can continue.'
            : 'Enter your current password and choose a new one.'}
        </p>
        <form id="cp-form">
          <div class="field" style="margin-bottom:14px">
            <label>Current Password</label>
            <input id="old-pw" type="password" required />
          </div>
          <div class="field" style="margin-bottom:14px">
            <label>New Password</label>
            <input id="new-pw" type="password" required minlength="6" />
          </div>
          <div class="field" style="margin-bottom:20px">
            <label>Confirm New Password</label>
            <input id="confirm-pw" type="password" required minlength="6" />
          </div>
          <div id="cp-error" hidden style="color:#DC2626;font-size:0.875rem;margin-bottom:12px;padding:8px;background:#FEF2F2;border-radius:6px"></div>
          <div style="display:flex;gap:10px">
            ${!forced ? `<button type="button" id="cp-cancel" class="btn" style="flex:1;justify-content:center">Cancel</button>` : ''}
            <button type="submit" class="btn btn-primary" style="flex:1;justify-content:center">
              Set Password
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  const form    = el.querySelector<HTMLFormElement>('#cp-form')!;
  const errorEl = el.querySelector<HTMLElement>('#cp-error')!;
  const btn     = el.querySelector<HTMLButtonElement>('button[type=submit]')!;

  el.querySelector('#cp-cancel')?.addEventListener('click', () => {
    window.history.back();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const oldPw  = (el.querySelector<HTMLInputElement>('#old-pw')!).value;
    const newPw  = (el.querySelector<HTMLInputElement>('#new-pw')!).value;
    const confPw = (el.querySelector<HTMLInputElement>('#confirm-pw')!).value;

    if (newPw !== confPw) {
      errorEl.textContent = 'Passwords do not match';
      errorEl.hidden = false;
      return;
    }
    if (newPw.length < 6) {
      errorEl.textContent = 'New password must be at least 6 characters';
      errorEl.hidden = false;
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Saving…';
    errorEl.hidden = true;

    try {
      await changePassword(oldPw, newPw);
      window.location.hash = '#voucher-list';
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to change password';
      errorEl.textContent = msg;
      errorEl.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Set Password';
    }
  });
}
