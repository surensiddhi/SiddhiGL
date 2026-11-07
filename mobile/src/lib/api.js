// SiddhiGL Mobile — calls to the SiddhiGL Worker.
// Same pattern as the main app's rpc.ts: the phone never talks to Supabase directly.
// Mobile functions are named mob_<name>; the Worker sends them to schema "mob".

import { WORKER } from './config.js';
import { session } from '../stores/session.svelte.js';

export class ApiError extends Error {
  constructor(message, status = 0, code = null) {
    super(message);
    this.status = status;
    this.code = code;   // OFFLINE, EXPIRED, FN_NOT_ALLOWED, or a code from the database
  }
}

export function call(fn, params = {}) {
  return send(`/rpc/${fn}`, 'application/json', JSON.stringify(params), fn);
}

// Send one photo (JPEG blob) for an entry that is already on the server
export function uploadPhoto(query, blob) {
  return send(`/upload/mob_photo?${new URLSearchParams(query)}`, 'image/jpeg', blob, 'photo upload');
}

async function send(path, contentType, body, fn) {
  if (!WORKER) throw new ApiError('VITE_WORKER_URL is not set in .env.local');
  if (!navigator.onLine) throw new ApiError('No internet connection.', 0, 'OFFLINE');

  const headers = { 'Content-Type': contentType };
  if (session.token) headers.Authorization = 'Bearer ' + session.token;

  let res;
  try {
    res = await fetch(WORKER + path, { method: 'POST', headers, body });
  } catch {
    throw new ApiError('Cannot reach the server. Check your internet.', 0, 'OFFLINE');
  }

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  if (res.status === 401) {
    session.token = null;
    throw new ApiError('Session expired. Enter your PIN again.', 401, 'EXPIRED');
  }
  if ((res.status === 403 && data?.code === 'FN_NOT_ALLOWED') || (res.status === 404 && fn === 'photo upload')) {
    throw new ApiError(`The server is not updated yet (${fn}). Redeploy the Worker.`, 403, 'FN_NOT_ALLOWED');
  }
  if (!res.ok) {
    throw new ApiError(data?.message ?? data?.error ?? `Request failed (${res.status})`, res.status);
  }
  return data;
}

// The database refuses a revoked or unknown phone with one of these messages
export function isPhoneBlocked(err) {
  return /has been blocked|is not registered/i.test(err?.message ?? '');
}
