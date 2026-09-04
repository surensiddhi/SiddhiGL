/** user-mgmt.ts — mirrors Usermgmtservice.js */

import { rpc } from '../lib/rpc';
import { ctx } from '../lib/session';

export interface UserRow {
  username:              string;
  full_name:             string;
  email:                 string | null;
  role:                  string; // 'viewer' | 'user' | 'manager' | 'admin'
  active:                boolean;
  must_change_password:  boolean;
  last_login:            string | null;
  created_at:            string;
}

export const usersList = () =>
  rpc<UserRow[]>('users_list', { ...ctx() });

export const userCreate = (p: {
  username:      string;
  full_name:     string;
  email?:        string;
  role:          string;
  temp_password: string;
}) =>
  rpc('user_create', {
    ...ctx(),
    p_username:      p.username,
    p_full_name:     p.full_name,
    p_email:         p.email ?? null,
    p_role:          p.role,
    p_temp_password: p.temp_password,
  });

export const userUpdate = (p: {
  username:  string;
  full_name: string;
  email?:    string;
  role:      string;
}) =>
  rpc('user_update', {
    ...ctx(),
    p_username:  p.username,
    p_full_name: p.full_name,
    p_email:     p.email ?? null,
    p_role:      p.role,
  });

export const userSetActive = (username: string, active: boolean) =>
  rpc('user_set_active', { ...ctx(), p_username: username, p_active: active });

export const userResetPassword = (username: string, tempPassword: string) =>
  rpc('user_reset_password', { ...ctx(), p_username: username, p_temp_password: tempPassword });
