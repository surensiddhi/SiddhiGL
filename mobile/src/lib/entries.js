// SiddhiGL Mobile — save entries on the phone first, then send them (outbox).
//
// Every entry gets its id on the phone. If sending is cut off and retried,
// the server sees the same id and does not save it twice.
//
// Outbox status: PENDING (waiting to send) -> SENT, or FAILED (server refused; see .error)

import { db, getMeta, setMeta } from './db.js';
import { call, uploadPhoto } from './api.js';
import { getDevice } from './auth.js';
import { APP_VERSION } from './config.js';
import { session } from '../stores/session.svelte.js';

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}

// Today's date on the phone, as YYYY-MM-DD
export function today() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export const money = (n) =>
  Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Temporary bill number for sales: device code + running number, e.g. M01-0012
async function nextTempNo() {
  const dev = await getDevice();
  const n = ((await getMeta('temp_seq')) ?? 0) + 1;
  await setMeta('temp_seq', n);
  return `${dev.device_code}-${String(n).padStart(4, '0')}`;
}

// Remember how often each item is sold, for the favourites row
async function countItemUse(lines) {
  const use = (await getMeta('item_use')) ?? {};
  for (const l of lines) if (l.item_code) use[l.item_code] = (use[l.item_code] ?? 0) + 1;
  await setMeta('item_use', use);
}

export async function favouriteItems(limit = 8) {
  const use = (await getMeta('item_use')) ?? {};
  const codes = Object.entries(use).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([c]) => c);
  const items = await db.items.bulkGet(codes);
  return items.filter(Boolean);
}

// photos: [{ blob }] from PhotoField. They upload after the entry itself is accepted.
export async function saveEntry(e, photos = []) {
  const entry = {
    ...e,
    entry_id: newId(),
    temp_no: e.entry_type === 'SALE' ? await nextTempNo() : null,
    created_at: new Date().toISOString(),
    app_version: APP_VERSION,
    photo_count: photos.length,
    status: 'PENDING',
    error: null
  };
  await db.transaction('rw', db.outbox, db.photos, async () => {
    await db.outbox.put(entry);
    for (const p of photos) {
      await db.photos.put({
        photo_id: newId(), entry_id: entry.entry_id, blob: p.blob,
        size_kb: Math.ceil(p.blob.size / 1024), status: 'PENDING', error: null
      });
    }
  });
  if (entry.entry_type === 'SALE') await countItemUse(entry.lines);
  sendPending();            // try now; if offline it waits
  return entry;
}

let sending = null;

// Send all waiting entries. Safe to call often: only one run at a time.
export function sendPending() {
  if (!sending) sending = doSend().finally(() => (sending = null));
  return sending;
}

async function doSend() {
  if (!session.token || !navigator.onLine) return { sent: 0 };
  const dev = await getDevice();
  const waiting = await db.outbox.where('status').equals('PENDING').sortBy('created_at');
  let sent = 0;

  for (const e of waiting) {
    // Only the fields the server reads
    const payload = {
      entry_id: e.entry_id, entry_type: e.entry_type, entry_date: e.entry_date,
      party_code: e.party_code, payment_mode: e.payment_mode, note: e.note, pay_ref: e.pay_ref,
      temp_no: e.temp_no, created_at: e.created_at, app_version: e.app_version,
      amount: e.amount,                          // Receipt / Payment / Photo Bill
      lines: (e.lines ?? []).map(l => ({
        item_code: l.item_code, expense_head: l.expense_head, qty: l.qty,
        price_incl_vat: l.price_incl_vat
      }))
    };
    try {
      const r = await call('mob_submit_entry', { p_device_id: dev.device_id, p_entry: payload });
      await db.outbox.update(e.entry_id, {
        status: 'SENT', server_status: r.status, price_flag: r.price_flag,
        server_total: r.total, sent_at: new Date().toISOString()
      });
      sent++;
    } catch (err) {
      // No connection, session ended, server down or Worker not updated: try again later
      if (['OFFLINE', 'EXPIRED', 'FN_NOT_ALLOWED'].includes(err.code) || !err.status || err.status >= 500) break;
      // The server refused this entry: keep it and show why
      await db.outbox.update(e.entry_id, { status: 'FAILED', error: err.message });
    }
  }

  // Photos: only for entries the server has accepted
  const photos = await db.photos.where('status').equals('PENDING').toArray();
  for (const p of photos) {
    const e = await db.outbox.get(p.entry_id);
    if (!e || e.status !== 'SENT') continue;
    try {
      await uploadPhoto({ entry_id: p.entry_id, photo_id: p.photo_id, device_id: dev.device_id }, p.blob);
      await db.photos.update(p.photo_id, { status: 'SENT', blob: null });   // free the space
      sent++;
    } catch (err) {
      if (['OFFLINE', 'EXPIRED', 'FN_NOT_ALLOWED'].includes(err.code) || !err.status || err.status >= 500) break;
      await db.photos.update(p.photo_id, { status: 'FAILED', error: err.message });
    }
  }
  return { sent };
}

export async function waitingCount() {
  const entries = await db.outbox.where('status').anyOf('PENDING', 'FAILED').count();
  const photos = await db.photos.where('status').anyOf('PENDING', 'FAILED').count();
  return entries + photos;
}

export async function retryEntry(id) {
  const e = await db.outbox.get(id);
  if (e?.status === 'FAILED') await db.outbox.update(id, { status: 'PENDING', error: null });
  await db.photos.where('entry_id').equals(id).modify(p => {
    if (p.status === 'FAILED') { p.status = 'PENDING'; p.error = null; }
  });
  return sendPending();
}

export async function deleteEntry(id) {
  await db.photos.where('entry_id').equals(id).delete();
  await db.outbox.delete(id);
}

// Local entries, newest first, with the latest status from the server when online
export async function myEntries() {
  const local = (await db.outbox.toArray()).sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (session.token && navigator.onLine) {
    try {
      const dev = await getDevice();
      const server = await call('mob_my_entries', { p_device_id: dev.device_id, p_days: 30 });
      const byId = new Map(server.map(s => [s.entry_id, s]));
      for (const e of local) {
        const s = byId.get(e.entry_id);
        if (s && e.status === 'SENT') {
          e.server_status = s.status;
          e.reject_reason = s.reject_reason;
          await db.outbox.update(e.entry_id, { server_status: s.status, reject_reason: s.reject_reason });
        }
      }
    } catch { /* show what the phone has */ }
  }

  // Photos still on the phone, per entry
  const photos = await db.photos.toArray();
  for (const e of local) {
    const mine = photos.filter(p => p.entry_id === e.entry_id);
    e.photos_waiting = mine.filter(p => p.status === 'PENDING').length;
    e.photos_failed = mine.filter(p => p.status === 'FAILED');
  }
  return local;
}
