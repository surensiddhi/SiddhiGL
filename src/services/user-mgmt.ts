/** user-mgmt.ts — mirrors Usermgmtservice.js */

import { rpc } from '../lib/rpc';
import { ctx } from '../lib/session';

export const usersList = (includeInactive = false) =>
  rpc('users_list', { ...ctx(), p_include_inactive: includeInactive });

export const userCreate = (p: {
  username:     string;
  display_name: string;
  password:     string;
  role:         number;
}) =>
  rpc('user_create', { ...ctx(), ...p });

export const userUpdate = (p: {
  username:     string;
  display_name: string;
  role:         number;
}) =>
  rpc('user_update', { ...ctx(), ...p });

export const userSetActive = (username: string, active: boolean) =>
  rpc('user_set_active', { ...ctx(), p_username: username, p_active: active });

export const userResetPassword = (username: string, newPassword: string) =>
  rpc('user_reset_password', { ...ctx(), p_username: username, p_new_password: newPassword });
