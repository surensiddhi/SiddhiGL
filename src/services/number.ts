/** number.ts — mirrors Numberservice.js */

import { rpc } from '../lib/rpc';
import { ctx } from '../lib/session';

/** Generate the next voucher number for a transaction type (e.g. 'JV', 'PV'). */
export const generateNumber = (tranType: string) =>
  rpc<string>('generate_number', { ...ctx(), p_tran_type: tranType });
