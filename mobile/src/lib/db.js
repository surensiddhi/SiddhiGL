// SiddhiGL Mobile — src/lib/db.js
// Local phone database (IndexedDB via Dexie). Works offline.

import Dexie from 'dexie';

export const db = new Dexie('siddhigl_mobile');

db.version(1).stores({
  meta:          'key',                         // device, session, company, last_sync
  menu:          'code',
  expense_heads: 'code',
  items:         'item_code, item_name',
  prices:        '[item_code+level_no], item_code',
  parties:       'party_code, party_name, party_type',
  settings:      'key',
  outbox:        'entry_id, status, created_at', // entries waiting to be sent
  photos:        'photo_id, entry_id'             // photo blobs waiting to upload
});

// v2 (Phase 3): photos can be found by status
db.version(2).stores({
  photos: 'photo_id, entry_id, status'
});

export async function getMeta(key) {
  const row = await db.meta.get(key);
  return row ? row.value : null;
}

export async function setMeta(key, value) {
  await db.meta.put({ key, value });
}

// Replace all masters with what mob.sync_masters returned
export async function saveMasters(m) {
  const tables = [db.menu, db.expense_heads, db.items, db.prices, db.parties, db.settings, db.meta];
  await db.transaction('rw', tables, async () => {
    await Promise.all([db.menu.clear(), db.expense_heads.clear(), db.items.clear(),
                       db.prices.clear(), db.parties.clear(), db.settings.clear()]);
    // keep the server's order (sort_order) with a running index
    await db.menu.bulkPut(m.menu.map((t, i) => ({ ...t, sort: i })));
    await db.expense_heads.bulkPut(m.expense_heads.map((e, i) => ({ ...e, sort: i })));
    await db.items.bulkPut(m.items);
    await db.prices.bulkPut(m.prices);
    await db.parties.bulkPut(m.parties);
    await db.settings.bulkPut(Object.entries(m.settings).map(([key, value]) => ({ key, value })));
    await setMeta('company', m.company);
    await setMeta('last_sync', m.server_time);
  });
}

// Price incl. VAT for an item at a quantity: picks the quantity level.
// VIP discount applies to level 1 only (same rule as the server's mob._list_price).
export async function priceFor(itemCode, qty, vip = false) {
  const levels = await db.prices.where('item_code').equals(itemCode).sortBy('level_no');
  const hit = levels.find(l => qty >= l.qty_from && (l.qty_to == null || qty <= l.qty_to));
  if (!hit) return 0;
  let price = Number(hit.price_incl_vat);
  if (vip && hit.level_no === 1) {
    const item = await db.items.get(itemCode);
    price = Math.round(price * (1 - Number(item?.vip_disc_pct ?? 0) / 100) * 100) / 100;
  }
  return price;
}
