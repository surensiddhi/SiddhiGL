// SiddhiGL Mobile — bring menu, settings, items, prices and parties to the phone.
import { call } from './api.js';
import { saveMasters } from './db.js';
import { getDevice } from './auth.js';

export async function syncMasters() {
  const dev = await getDevice();
  // The Worker adds tenant and user from the session token
  const m = await call('mob_sync_masters', { p_device_id: dev.device_id });
  await saveMasters(m);
  return m;
}
