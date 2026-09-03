/** config.ts — mirrors Configservice.js */

import { rpc } from '../lib/rpc';
import { ctx } from '../lib/session';
import type { CompanyConfig } from '../types';

export const getCompanyConfig = () =>
  rpc<CompanyConfig>('get_company_config', { ...ctx() });

export const saveCompanyConfig = (c: CompanyConfig) =>
  rpc('save_company_config', { ...ctx(), ...c });

export const tradingSetupStatus = () =>
  rpc('trading_setup_status', { ...ctx() });

export const setupTradingAccounts = () =>
  rpc('setup_trading_accounts', { ...ctx() });
