/** cost-centre.ts — mirrors Costcentreservice.js */

import { rpc } from '../lib/rpc';
import { ctx } from '../lib/session';
import type { CostCentre } from '../types';

export const ccList = (includeInactive = true) =>
  rpc<CostCentre[]>('cc_list', { ...ctx(), p_include_inactive: includeInactive });

export const ccSave = (code: string, name: string, active: boolean) =>
  rpc('cc_save', { ...ctx(), p_code: code, p_name: name, p_active: active });

export const ccSetActive = (code: string, active: boolean) =>
  rpc('cc_set_active', { ...ctx(), p_code: code, p_active: active });
