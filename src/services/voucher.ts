/** voucher.ts — mirrors VoucherList_actions.gs */

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

/** post_many(p_ids bigint[], p_tenant text, p_posted_by text DEFAULT NULL) */
export const postMany = (ids: number[]) => {
  const { p_tenant, p_caller } = ctx();
  return rpc<number>('post_many', { p_ids: ids, p_tenant, p_posted_by: p_caller });
};

/** List posted vouchers via dedicated lk_posted_list */
export const listPosted = () =>
  rpc<VoucherRow[]>('lk_posted_list', { ...ctx() });

/** Fetch a single posted voucher with lines */
export const getPostedVoucher = (headId: number) =>
  rpc<any>('get_posted_voucher', { ...ctx(), p_head_id: headId });
