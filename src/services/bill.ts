/**
 * services/bill.ts — Sales Bill (SB) / Purchase Bill (PB) service.
 * Backed by bill_head / bill_detail + the auto-generated tran_head/tran_detail entry.
 * See bill_save() in the DB for the full posting logic.
 */

import { rpc } from '../lib/rpc';
import { ctx } from '../lib/session';

export interface BillLinePayload {
  item_code?:        string | null;
  description:       string;
  qty:                number;
  rate:               number;
  amount:             number;
  taxable:            boolean;
  account_no:         string;
  cost_centre_code?:  string | null;
  batch_no?:          string | null;
  expiry_date?:       string | null;
}

export interface BillSavePayload {
  bill_type:        'SB' | 'PB';
  bill_date:        string;
  bill_date_nep?:   string;
  party_type?:       string | null;
  party_code?:       string | null;
  payment_mode:      'Cash' | 'Bank' | 'Digital' | 'Credit';
  bank_account_no?:  string | null;
  due_date?:         string | null;
  narration?:        string;
  footer_note?:      string;
  lines:             BillLinePayload[];
}

export interface BillListRow {
  id:              number;
  bill_no:         string;
  bill_date:       string;
  party_code:      string | null;
  party_name:      string | null;
  payment_mode:    string;
  taxable_amount:  number;
  vat_amount:      number;
  total_amount:    number;
  status:          'posted' | 'voided';
}

export interface BillHead {
  id:               number;
  bill_type:        'SB' | 'PB';
  bill_no:          string;
  bill_date:        string;
  bill_date_nep:    string | null;
  party_type:       string | null;
  party_code:       string | null;
  payment_mode:     string;
  bank_account_no:  string | null;
  due_date:         string | null;
  taxable_amount:   number;
  vat_amount:       number;
  total_amount:     number;
  narration:        string | null;
  footer_note:      string | null;
  status:           'posted' | 'voided';
}

export interface BillLine {
  line_no:          number;
  item_code:        string | null;
  description:      string | null;
  qty:               number;
  rate:              number;
  amount:            number;
  taxable:           boolean;
  account_no:        string;
  cost_centre_code:  string | null;
}

export function billSave(payload: BillSavePayload): Promise<{ id: number; bill_no: string }[]> {
  const { p_tenant, p_caller } = ctx();
  return rpc('bill_save', { payload: { tenant: p_tenant, caller: p_caller, ...payload } });
}

export function billList(
  billType: 'SB' | 'PB', from?: string, to?: string, status?: string
): Promise<BillListRow[]> {
  return rpc('bill_list', {
    ...ctx(), p_bill_type: billType, p_from: from ?? null, p_to: to ?? null, p_status: status ?? null,
  });
}

export async function billGet(id: number): Promise<BillHead | null> {
  const rows = await rpc<BillHead[]>('bill_get', { ...ctx(), p_id: id });
  return rows?.[0] ?? null;
}

export function billLinesGet(headId: number): Promise<BillLine[]> {
  return rpc('bill_lines_get', { ...ctx(), p_head_id: headId });
}

export function billVoid(headId: number): Promise<void> {
  return rpc('bill_void', { ...ctx(), p_head_id: headId });
}
