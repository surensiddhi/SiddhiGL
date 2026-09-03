/** account-type.ts — mirrors Accounttypeservice.js */

import { rpc } from '../lib/rpc';
import { ctx } from '../lib/session';
import type { AccountType } from '../types';

export const listAccountTypes = (includeInactive = false) =>
  rpc<AccountType[]>('list_account_types', { ...ctx(), p_include_inactive: includeInactive });

export const saveAccountType = (at: AccountType) =>
  rpc('save_account_type', { ...ctx(), ...at });

export const deleteAccountType = (accType: string) =>
  rpc('delete_account_type', { ...ctx(), p_acc_type: accType });

export const nextTypeCode = () =>
  rpc<string>('next_type_code', { ...ctx() });
