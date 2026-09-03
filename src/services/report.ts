/** report.ts — mirrors Reportservice.js */

import { rpc } from '../lib/rpc';
import { ctx } from '../lib/session';

export const trialBalance = (
  fromDate: string,
  toDate: string,
  status: 'posted' | 'pending' | 'all' = 'posted',
  branch?: string
) =>
  rpc('get_trial_balance', {
    ...ctx(),
    p_from_date: fromDate,
    p_to_date:   toDate,
    p_status:    status,
    p_branch:    branch ?? null
  });

export const ledger = (p: {
  mode:        'account' | 'party';
  from:        string;
  to:          string;
  account_no?: string;
  party_type?: string;
  party_code?: string;
  status?:     'posted' | 'pending' | 'all';
}) =>
  rpc('get_ledger', {
    ...ctx(),
    p_mode:       p.mode,
    p_from:       p.from,
    p_to:         p.to,
    p_account_no: p.account_no ?? null,
    p_party_type: p.party_type ?? null,
    p_party_code: p.party_code ?? null,
    p_status:     p.status ?? 'posted'
  });

export const dayBook = (p: {
  from:       string;
  to:         string;
  status?:    'posted' | 'pending' | 'all';
  tran_type?: string;
}) =>
  rpc('get_day_book', {
    ...ctx(),
    p_from:      p.from,
    p_to:        p.to,
    p_status:    p.status ?? 'posted',
    p_tran_type: p.tran_type ?? null
  });

export const profitLoss = (p: {
  from:           string;
  to:             string;
  status?:        'posted' | 'pending' | 'all';
  branch?:        string;
  business_type?: string;
}) =>
  rpc('get_profit_loss', {
    ...ctx(),
    p_from:          p.from,
    p_to:            p.to,
    p_status:        p.status ?? 'posted',
    p_branch:        p.branch ?? null,
    p_business_type: p.business_type ?? null
  });

export const balanceSheet = (p: {
  as_of:    string;
  fy_start?: string;
  status?:  'posted' | 'pending' | 'all';
}) =>
  rpc('get_balance_sheet', {
    ...ctx(),
    p_as_of:    p.as_of,
    p_fy_start: p.fy_start ?? null,
    p_status:   p.status ?? 'posted'
  });

export const aging = (p: {
  as_of:  string;
  mode?:  'receivable' | 'payable';
  status?: 'posted' | 'pending' | 'all';
}) =>
  rpc('get_aging', {
    ...ctx(),
    p_as_of:  p.as_of,
    p_mode:   p.mode ?? 'receivable',
    p_status: p.status ?? 'posted'
  });
