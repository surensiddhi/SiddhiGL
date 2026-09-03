/** voucher.ts — Voucher service calls */

import { rpc } from '../lib/rpc';
import { ctx } from '../lib/session';

export interface VoucherRow {
  id:           number;
  voucher_no:   string;
  voucher_date: string;   // ISO date
  tran_type:    string;
  description:  string;
  status:       string;   // 'unapproved' | 'approved' | 'posted'
}

/** p_status: 'unapproved' | 'approved' | 'all' | null (= all except posted) */
export const listVouchers = (status?: string) =>
  rpc<VoucherRow[]>('lk_voucher_list', { ...ctx(), p_status: status ?? null });

export const approveVoucher = (headId: number) =>
  rpc('approve_voucher', { ...ctx(), p_head_id: headId });

export const unapproveVoucher = (headId: number) =>
  rpc('unapprove_voucher', { ...ctx(), p_head_id: headId });

/** Post a single voucher — assigns permanent number, locks it. */
export const postVoucher = (headId: number) => {
  const { p_tenant, p_caller } = ctx();
  return rpc<{ id: number; voucher_no: string }>(
    'post_voucher', { p_head_id: headId, p_tenant, p_posted_by: p_caller }
  );
};

/** Bulk post: passes tenant so post_voucher can scope the number correctly. */
export const postMany = (ids: number[]) => {
  const { p_tenant, p_caller } = ctx();
  return rpc<number>('post_many', { p_ids: ids, p_tenant, p_posted_by: p_caller });
};
