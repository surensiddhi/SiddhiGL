/**
 * rpc.ts — Worker-proxy RPC wrapper.
 * All Supabase calls go through the Cloudflare Worker (siddhigl-proxy),
 * so the Supabase URL and service_role key never reach the browser.
 *
 * Frontend env required:
 *   VITE_WORKER_URL = https://siddhigl-proxy.your-account.workers.dev
 */

const WORKER = (import.meta.env.VITE_WORKER_URL as string ?? '').replace(/\/+$/, '');

export async function rpc<T = unknown>(
  fn: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  if (!WORKER) throw new Error('VITE_WORKER_URL is not set');

  const res = await fetch(`${WORKER}/rpc/${fn}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(params),
  });

  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!res.ok) {
    const e = data as Record<string, string> | null;
    const msg = e?.message ?? e?.error ?? e?.hint ?? `RPC ${fn} failed (${res.status})`;
    throw new Error(msg);
  }

  return data as T;
}
