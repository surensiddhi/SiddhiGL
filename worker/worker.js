/**
 * worker.js  —  Supabase proxy for SiddhiGL (Cloudflare Worker)
 * ----------------------------------------------------------------------------
 * Dedicated proxy — completely separate from mgl-proxy. Never share secrets.
 *
 * Frontend calls:  POST {WORKER_URL}/rpc/{fnName}   body = params JSON
 * Worker forwards: POST {SUPABASE_URL}/rest/v1/rpc/{fnName}
 *
 * SECRETS (set once via `wrangler secret put`):
 *   SUPABASE_URL   = https://YOURPROJECT.supabase.co
 *   SUPABASE_KEY   = your service_role key  (never the anon key — keep it server-side)
 *   ALLOW_ORIGIN   = https://siddhigl.pages.dev  (your Cloudflare Pages domain)
 */

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

    if (!env.SUPABASE_URL || !env.SUPABASE_KEY) {
      return json({ error: 'Server not configured' }, 500, origin);
    }

    let params;
    try { params = await request.json(); } catch { params = {}; }

    let upstream;
    try {
      upstream = await fetch(
        env.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/rpc/' + fnName,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey':        env.SUPABASE_KEY,
            'Authorization': 'Bearer ' + env.SUPABASE_KEY
          },
          body: JSON.stringify(params || {})
        }
      );
    } catch (e) {
      return json({ error: 'Upstream fetch failed' }, 502, origin);
    }

    const text = await upstream.text();
    return new Response(text, {
      status:  upstream.status,
      headers: { 'Content-Type': 'application/json', ...cors(origin) }
    });
  }
};

/**
 * Reflect back the request's Origin if it's on the allowlist.
 * Localhost ports are always allowed for local dev.
 */
function pickOrigin(request, env) {
  const prod    = env.ALLOW_ORIGIN || '*';
  const allowed = [
    prod,
    'http://localhost:5173',
    'http://localhost:4173',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:4173'
  ];
  const reqOrigin = request.headers.get('Origin');
  return allowed.includes(reqOrigin) ? reqOrigin : prod;
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origin) }
  });
}
