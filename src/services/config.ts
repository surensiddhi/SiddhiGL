/** config.ts — mirrors Configservice.js */

import { rpc } from '../lib/rpc';
import { ctx } from '../lib/session';
import type { CompanyConfig } from '../types';

export const getCompanyConfig = () =>
  rpc<CompanyConfig>('get_company_config', { ...ctx() });

export const saveCompanyConfig = (c: CompanyConfig) =>
  rpc('save_company_config', {
    ...ctx(),
    p_company_name:      c.company_name,
    p_address:            c.address ?? null,
    p_pan_no:             c.pan_no ?? null,
    p_phone:              c.phone ?? null,
    p_email:              c.email ?? null,
    p_fiscal_year_start:  c.fiscal_year_start,
    p_business_type:      c.business_type,
    p_age_b1:             c.age_b1 ?? null,
    p_age_b2:             c.age_b2 ?? null,
    p_age_b3:             c.age_b3 ?? null,
    p_age_b4:             c.age_b4 ?? null,
    p_lock_date:          c.lock_date ?? null,
    p_vat_pct:                   c.vat_pct ?? null,
    p_vat_payable_account_no:    c.vat_payable_account_no ?? null,
    p_vat_receivable_account_no: c.vat_receivable_account_no ?? null,
    p_default_sales_due_days:    c.default_sales_due_days ?? null,
    p_default_purchase_due_days: c.default_purchase_due_days ?? null,
  });

export const tradingSetupStatus = () =>
  rpc('trading_setup_status', { ...ctx() });

export const setupTradingAccounts = () =>
  rpc('setup_trading_accounts', { ...ctx() });
