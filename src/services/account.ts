/** account.ts — mirrors Accountservice.js */

import { rpc } from '../lib/rpc';
import { ctx } from '../lib/session';
import type { Account } from '../types';

export const listAccounts = (includeInactive = false) =>
  rpc<Account[]>('list_accounts', { ...ctx(), p_include_inactive: includeInactive });

export const saveAccount = (account: Account) =>
  rpc('save_account', { ...ctx(), ...account });

export const deleteAccount = (accountNo: string) =>
  rpc('delete_account', { ...ctx(), p_account_no: accountNo });

export const nextAccountNo = (parentNo?: string) =>
  rpc<string>('next_account_no', { ...ctx(), p_parent_no: parentNo ?? null });

export const resolveAccount = (accountNo: string) =>
  rpc('resolve_account', { ...ctx(), p_account_no: accountNo });

export const accountTitle = (accountNo: string) =>
  rpc<string>('account_title', { ...ctx(), p_account_no: accountNo });
