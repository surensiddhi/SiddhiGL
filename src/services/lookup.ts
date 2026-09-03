/** lookup.ts — mirrors Lookupservice.js */

import { rpc } from '../lib/rpc';
import { ctx } from '../lib/session';
import type { LookupResult } from '../types';

interface LookupConfig {
  fn:          string;
  clientCache: boolean;
  hasRuntime?: boolean;
}

const LOOKUP_MAP: Record<string, LookupConfig> = {
  accounts:           { fn: 'lk_accounts',           clientCache: false },
  control_accounts:   { fn: 'lk_control_accounts',   clientCache: true  },
  account_types:      { fn: 'lk_account_types',       clientCache: true  },
  party_types:        { fn: 'lk_party_types',         clientCache: true  },
  cost_centres:       { fn: 'lk_cost_centres',        clientCache: true  },
  tran_types:         { fn: 'lk_tran_types',          clientCache: true  },
  parties_by_account: { fn: 'lk_parties_by_account',  clientCache: false, hasRuntime: true },
};

/** Client-side cache for stable, small lookups (clientCache: true). */
const _clientCache: Record<string, LookupResult> = {};

/**
 * Fetch lookup data by config name.
 * - clientCache lookups are loaded once and returned from memory on repeat calls.
 * - Server-search lookups (clientCache: false) always go to the server.
 * @param configName  key in LOOKUP_MAP
 * @param term        free-text search term (server-search lookups)
 * @param runtimeFilter  e.g. 'control_account_no=eq.10005' for parties_by_account
 */
export async function lookupData(
  configName: string,
  term = '',
  runtimeFilter = ''
): Promise<LookupResult> {
  const cfg = LOOKUP_MAP[configName];
  if (!cfg) throw new Error(`Unknown lookup: "${configName}"`);

  // Return cached result for stable lookups (when no search term)
  if (cfg.clientCache && !term && _clientCache[configName]) {
    return _clientCache[configName]!;
  }

  const params: Record<string, unknown> = {
    ...ctx(),
    p_term: term || null
  };

  if (cfg.hasRuntime && runtimeFilter) {
    // Parse 'col=eq.VALUE' -> value
    const parts = runtimeFilter.split('=eq.');
    params['p_control'] = parts.length === 2 ? decodeURIComponent(parts[1]!) : null;
  }

  const rows = await rpc<Array<{ value: string; label: string }>>(cfg.fn, params) ?? [];
  const result: LookupResult = {
    columns:     ['value', 'label'],
    valueColumn: 'value',
    labelColumn: 'label',
    clientCache: cfg.clientCache,
    rows:        rows.map(r => ({ value: r.value, label: r.label, row: r as Record<string, unknown> }))
  };

  if (cfg.clientCache && !term) {
    _clientCache[configName] = result;
  }

  return result;
}

/** Invalidate a cached lookup (call after saving a master record). */
export function invalidateLookupCache(configName: string): void {
  delete _clientCache[configName];
}

/** Invalidate all caches (e.g. on tenant switch). */
export function clearLookupCache(): void {
  for (const key of Object.keys(_clientCache)) {
    delete _clientCache[key];
  }
}
