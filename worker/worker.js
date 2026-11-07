/**
 * worker.js  —  Supabase proxy for SiddhiGL (Cloudflare Worker)
 * ----------------------------------------------------------------------------
 * Dedicated proxy — completely separate from mgl-proxy. Never share secrets.
 *
 * Frontend calls:  POST {WORKER_URL}/rpc/{fnName}   body = params JSON
 * Worker forwards: POST {SUPABASE_URL}/rest/v1/rpc/{fnName}
 *
 * TWO GUARDS (added 2026-10-05):
 *   1. ALLOW-LIST  — only the function names in RULES below are forwarded.
 *      Anything else (admin_*, lite_*, create_tenant_with_users, ...) gets 403.
 *      A new screen that calls a new database function MUST add it here.
 *   2. SESSION TOKEN — login_verify returns a signed token. Every later call
 *      must send it (Authorization: Bearer <token>). The Worker then takes the
 *      tenant and the user FROM THE TOKEN and overwrites whatever the browser
 *      sent, so nobody can pretend to be another tenant or another user.
 *
 * SECRETS (set once via `wrangler secret put`):
 *   SUPABASE_URL    = https://YOURPROJECT.supabase.co
 *   SUPABASE_KEY    = the Supabase API key the Worker calls with
 *   ALLOW_ORIGIN    = https://siddhigl-web.pages.dev
 *   SESSION_SECRET  = long random text used to sign session tokens
 *
 * The token check cannot be switched off. (A rollout switch, ENFORCE_TOKEN,
 * existed on 5 Oct 2026 only and was removed on purpose: a login check that
 * can be turned off by a setting is a login check that will be turned off by
 * mistake.) Without SESSION_SECRET the Worker refuses every call.
 */

const TOKEN_HOURS = 12;

// How the Worker stamps tenant + user onto each allowed function.
//   'ctx'     -> params.p_tenant / params.p_caller            (the normal case)
//   'payload' -> params.payload.tenant / params.payload.caller
//   'post'    -> params.p_tenant / params.p_posted_by
//   'pwd'     -> params.p_tenant_id / params.p_username
//   'raw'     -> nothing stamped (function takes no tenant/user)
//   'public'  -> callable without a token (login only)
const RULES = {
  login_verify: 'public',
  change_password: 'pwd',
  post_many: 'post',
  adj_save: 'payload', bill_save: 'payload', save_voucher: 'payload',
  bill_request_submit: 'payload',
  generate_number: 'raw',
};
[
  'account_title', 'adj_list', 'ap_list', 'ap_save', 'ap_set_active', 'approve_voucher',
  'bill_get', 'bill_lines_get', 'bill_list', 'bill_vat_register', 'bill_void',
  'bill_request_cancel', 'bill_request_decide', 'bill_request_list', 'bill_request_post',
  'save_billing_controls',
  'cc_list', 'cc_save', 'cc_set_active', 'clear_sample_data', 'dashboard_summary',
  'delete_account', 'delete_account_type', 'delete_party',
  'dept_list', 'dept_save', 'dept_set_active', 'generate_coa_from_types',
  'get_aging', 'get_audit_log', 'get_balance_sheet', 'get_company_config', 'get_day_book',
  'get_ledger', 'get_posted_voucher', 'get_profit_loss', 'get_trial_balance', 'get_voucher',
  'hs_code_list', 'hs_code_save', 'hs_code_set_active',
  'import_landing_post', 'import_landing_preview', 'import_shipment_delete',
  'import_shipment_freight_lines_get', 'import_shipment_get', 'import_shipment_lines_get',
  'import_shipment_list', 'import_shipment_pp_lines_get', 'import_shipment_save',
  'import_shipment_vat_register', 'item_expiry_report', 'item_group_list', 'item_group_save',
  'item_group_set_active', 'item_list', 'item_price_grid', 'item_price_save', 'item_save',
  'item_set_active', 'item_stock_balance',
  'list_account_types', 'list_accounts', 'list_parties',
  'lk_account_purposes', 'lk_account_types', 'lk_accounts', 'lk_control_accounts',
  'lk_cost_centres', 'lk_departments', 'lk_items', 'lk_parties', 'lk_parties_by_account',
  'lk_party_types', 'lk_posted_list', 'lk_tran_types', 'lk_users', 'lk_voucher_list',
  'menu_list',
  'next_account_no', 'next_party_code', 'next_type_code',
  'open_stock_list', 'open_stock_remove', 'open_stock_save', 'resolve_account',
  'save_account', 'save_account_type', 'save_company_config', 'save_party', 'save_prices_include_vat', 'save_sales_discount_account',
  'setup_trading_accounts', 'setup_wizard_finish', 'setup_wizard_progress_save',
  'setup_wizard_reset', 'trading_setup_status',
  'udf_report_list', 'udf_report_params', 'udf_report_run', 'unapprove_voucher',
  'user_create', 'user_reset_password', 'user_set_active', 'user_update', 'users_list',
].forEach(fn => { RULES[fn] = 'ctx'; });

// ── SiddhiGL Mobile (added 2026-11-07) ──────────────────────────────────────
// The phone calls /rpc/mob_<name>; the Worker forwards it to function <name>
// in database schema "mob" (Supabase: Settings → API → Exposed schemas → add mob).
//   register_device / pin_login: callable without a token, like login_verify;
//     a successful result gets a session token added.
//   set_pin: callable without a token; the database checks the device id + secret.
Object.assign(RULES, {
  mob_register_device: 'public',
  mob_pin_login:       'public',
  mob_set_pin:         'public',
  mob_sync_masters:    'ctx',
  mob_list_devices:    'ctx',
  mob_revoke_device:   'ctx',
  mob_reset_pin:       'ctx',
});
const TOKEN_ISSUERS = ['login_verify', 'mob_register_device', 'mob_pin_login'];
const MOB_PREFIX    = 'mob_';

export default {
  async fetch(request, env) {
    const origin = pickOrigin(request, env);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, origin);
    }

    const url   = new URL(request.url);
    const match = url.pathname.match(/^\/rpc\/([A-Za-z0-9_]+)$/);
    if (!match) {
      return json({ error: 'Not found' }, 404, origin);
    }
    const fnName = match[1];

    // Guard 1: allow-list
    const rule = Object.prototype.hasOwnProperty.call(RULES, fnName) ? RULES[fnName] : null;
    if (!rule) {
      return json({
        error: 'Function not allowed: ' + fnName,
        code:  'FN_NOT_ALLOWED',
        fn:    fnName,
        message: 'The server does not allow the action "' + fnName + '". ' +
                 'If the program was just updated, the server (Worker) still needs to be redeployed.'
      }, 403, origin);
    }

    if (!env.SUPABASE_URL || !env.SUPABASE_KEY || !env.SESSION_SECRET) {
      return json({ error: 'Server not configured' }, 500, origin);
    }

    let params;
    try { params = await request.json(); } catch { params = {}; }
    if (!params || typeof params !== 'object' || Array.isArray(params)) params = {};

    // Guard 2: session token
    if (rule !== 'public') {
      const auth  = request.headers.get('Authorization') || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const who   = token ? await verifyToken(token, env.SESSION_SECRET) : null;
      if (!who) {
        return json({ error: 'Session expired. Please sign in again.' }, 401, origin);
      }
      stamp(rule, params, who);
    }

    // mob_xxx -> function xxx in schema mob; everything else stays in public
    const isMob   = fnName.startsWith(MOB_PREFIX);
    const dbFn    = isMob ? fnName.slice(MOB_PREFIX.length) : fnName;
    const headers = {
      'Content-Type': 'application/json',
      'apikey':        env.SUPABASE_KEY,
      'Authorization': 'Bearer ' + env.SUPABASE_KEY
    };
    if (isMob) headers['Content-Profile'] = 'mob';

    let upstream;
    try {
      upstream = await fetch(
        env.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/rpc/' + dbFn,
        { method: 'POST', headers, body: JSON.stringify(params) }
      );
    } catch (e) {
      return json({ error: 'Upstream fetch failed' }, 502, origin);
    }

    let text = await upstream.text();

    // A successful login gets a signed token added to its row.
    if (TOKEN_ISSUERS.includes(fnName) && upstream.ok) {
      text = await addTokenToLogin(text, env.SESSION_SECRET);
    }

    return new Response(text, {
      status:  upstream.status,
      headers: { 'Content-Type': 'application/json', ...cors(origin) }
    });
  }
};

/** Overwrite tenant + user in the params with the values from the token. */
function stamp(rule, params, who) {
  if (rule === 'ctx') {
    params.p_tenant = who.t; params.p_caller = who.u;
  } else if (rule === 'post') {
    params.p_tenant = who.t; params.p_posted_by = who.u;
  } else if (rule === 'pwd') {
    params.p_tenant_id = who.t; params.p_username = who.u;
  } else if (rule === 'payload') {
    if (!params.payload || typeof params.payload !== 'object' || Array.isArray(params.payload)) {
      params.payload = {};
    }
    params.payload.tenant = who.t; params.payload.caller = who.u;
  }
}

async function addTokenToLogin(text, secret) {
  let data;
  try { data = JSON.parse(text); } catch { return text; }
  const row = Array.isArray(data) ? data[0] : data;
  // Only a successful tenant-aware login returns tenant_id; no tenant, no token.
  // (mob_pin_login with a wrong PIN returns {ok:false} and no tenant_id.)
  if (!row || typeof row !== 'object' || !row.tenant_id || !row.username) return text;
  row.token = await signToken(
    { t: row.tenant_id, u: row.username, exp: Math.floor(Date.now() / 1000) + TOKEN_HOURS * 3600 },
    secret
  );
  return JSON.stringify(data);
}

// ── Token helpers (HMAC-SHA256, "<payload>.<signature>", base64url) ──────────
const enc = new TextEncoder();

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function hmacKey(secret, usage) {
  return crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]
  );
}

async function signToken(payload, secret) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig  = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(body));
  return body + '.' + b64url(new Uint8Array(sig));
}

/** Returns { t, u, exp } for a valid, unexpired token; otherwise null. */
async function verifyToken(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const ok = await crypto.subtle.verify(
      'HMAC', await hmacKey(secret, 'verify'), unb64url(parts[1]), enc.encode(parts[0])
    );
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64url(parts[0])));
    if (!p || typeof p.t !== 'string' || typeof p.u !== 'string' || !p.t || !p.u) return null;
    if (typeof p.exp !== 'number' || p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch {
    return null;
  }
}

/**
 * Reflect back the request's Origin if it's on the allowlist.
 * Localhost ports are always allowed for local dev.
 */
function pickOrigin(request, env) {
  const prod    = env.ALLOW_ORIGIN || '*';
  const reqOrigin = request.headers.get('Origin') || '';
  const allowed = [
    prod,
    'http://localhost:5173',
    'http://localhost:4173',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:4173',
    'http://localhost:5174',          // SiddhiGL Mobile dev
    'http://localhost:4174',          // SiddhiGL Mobile preview
    'http://127.0.0.1:5174',
    'http://127.0.0.1:4174'
  ];
  if (allowed.includes(reqOrigin)) return reqOrigin;
  if (reqOrigin.endsWith('.siddhigl-web.pages.dev') ||
      reqOrigin === 'https://siddhigl-web.pages.dev' ||
      reqOrigin.endsWith('.siddhigl-mobile.pages.dev') ||
      reqOrigin === 'https://siddhigl-mobile.pages.dev' ||
      reqOrigin === 'https://gl.siddhi.cc') return reqOrigin;
  return prod;
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origin) }
  });
}
