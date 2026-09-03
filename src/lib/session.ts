/**
 * session.ts
 * Custom auth session — mirrors the GAS _ctx() / CURRENT_USER pattern.
 * Uses login_verify / change_password Postgres functions via the Worker proxy.
 */

import { rpc } from './rpc';

const SESSION_KEY = 'siddhigl_session';

export interface UserSession {
  tenant_id:          string;
  tenant_name:        string;
  company_name:       string;
  username:           string;
  full_name:          string;
  role:               string;   // 'viewer' | 'user' | 'manager' | 'admin'
  is_super_admin:     boolean;
  modules:            string;
  must_change_password: boolean;
}

const ROLE_NUM: Record<string, number> = {
  viewer: 1, user: 2, manager: 3, admin: 4,
};

/** Convert role string to numeric level for permission checks. */
export function roleLevel(session: UserSession): number {
  return ROLE_NUM[session.role] ?? 1;
}

/** Read the current session (null if not logged in). */
export function getSession(): UserSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as UserSession) : null;
  } catch {
    return null;
  }
}

/**
 * ctx() — equivalent to the GAS _ctx() helper.
 * Every service call spreads this into its RPC params.
 */
export function ctx(): { p_tenant: string; p_caller: string } {
  const s = getSession();
  if (!s) throw new Error('Not authenticated');
  return { p_tenant: s.tenant_id, p_caller: s.username };
}

/** Log in via the Postgres login_verify function (routed through Worker). */
export async function login(
  tenantId: string,
  username: string,
  password: string
): Promise<UserSession> {
  const raw = await rpc<UserSession | UserSession[]>('login_verify', {
    p_tenant_id: tenantId,
    p_username:  username,
    p_password:  password,
  });
  const data = Array.isArray(raw) ? raw[0] : raw;
  if (!data) throw new Error('Invalid credentials');
  localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  return data;
}

/** Change password via the Postgres change_password function. */
export async function changePassword(
  oldPassword: string,
  newPassword: string
): Promise<void> {
  const s = getSession();
  if (!s) throw new Error('Not authenticated');
  const ok = await rpc<boolean>('change_password', {
    p_tenant_id:    s.tenant_id,
    p_username:     s.username,
    p_old_password: oldPassword,
    p_new_password: newPassword,
  });
  if (ok === false) throw new Error('Current password is incorrect');
  // Clear the must_change_password flag locally
  const updated = { ...s, must_change_password: false };
  localStorage.setItem(SESSION_KEY, JSON.stringify(updated));
}

/** Clear session and redirect to login. */
export function logout(): void {
  localStorage.removeItem(SESSION_KEY);
  window.location.hash = '#login';
}
