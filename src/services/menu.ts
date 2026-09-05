/**
 * services/menu.ts — fetches the tenant's visible menu tree.
 * Backed by the `menus` table (global catalog, shared across all tenants)
 * filtered server-side in menu_list() by role and by the tenant's active
 * modules (tenant_modules). See sidebar.ts for how this is rendered.
 */

import { rpc } from '../lib/rpc';
import { ctx } from '../lib/session';

export interface MenuRow {
  code:        string;
  parent_code: string | null;
  menu_item:   string;
  node_type:   'B' | 'F';
  form_name:   string | null;
  sort_order:  number;
  min_role:    string | null;
}

export async function menuList(): Promise<MenuRow[]> {
  return rpc<MenuRow[]>('menu_list', ctx());
}
