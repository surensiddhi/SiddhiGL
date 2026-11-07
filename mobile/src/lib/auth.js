// SiddhiGL Mobile — phone registration, PIN and unlock.
//
// First time on a phone: customer ID + username + password  -> mob.register_device
//   The phone keeps device_id + device_secret (never the password).
// Every day: 4-digit PIN -> mob.pin_login (online)
//   No internet: the PIN is checked against a hash saved on the phone,
//   so the user can still record entries. Sync waits until the next online unlock.

import { call, ApiError } from './api.js';
import { db, getMeta, setMeta } from './db.js';
import { session } from '../stores/session.svelte.js';

const DEVICE = 'device';
const PIN_LOCAL = 'pin_local';
const MAX_LOCAL_TRIES = 5;

export const getDevice = () => getMeta(DEVICE);

function userFrom(r) {
  return {
    tenant_id: r.tenant_id,
    username: r.username,
    full_name: r.full_name,
    role: r.role,
    company_name: r.company_name,
    device_code: r.device_code
  };
}

// SHA-256 of secret + PIN. Needs https or localhost; returns null otherwise.
async function localHash(secret, pin) {
  if (!globalThis.crypto?.subtle) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret + ':' + pin));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

async function rememberPin(dev, pin) {
  await setMeta(PIN_LOCAL, { hash: await localHash(dev.device_secret, pin), tries: 0 });
}

export async function register(tenant, username, password, deviceName) {
  const r = await call('mob_register_device', {
    p_tenant: tenant.trim().toUpperCase(),
    p_username: username.trim(),
    p_password: password,
    p_device_name: deviceName.trim()
  });
  await setMeta(DEVICE, { device_id: r.device_id, device_secret: r.device_secret, ...userFrom(r) });
  await setMeta(PIN_LOCAL, null);
  session.token = r.token ?? null;
  session.user = userFrom(r);
  session.offline = false;
  return { hasPin: !!r.has_pin };
}

export async function setPin(newPin, oldPin = null) {
  const dev = await getDevice();
  const r = await call('mob_set_pin', {
    p_device_id: dev.device_id,
    p_device_secret: dev.device_secret,
    p_new_pin: newPin,
    p_old_pin: oldPin
  });
  if (!r.ok) throw new ApiError(r.message, 200, r.code);
  await rememberPin(dev, newPin);
}

// Returns { ok:true } or { ok:false, code, message, attempts_left? }
export async function pinLogin(pin) {
  const dev = await getDevice();
  try {
    const r = await call('mob_pin_login', {
      p_device_id: dev.device_id,
      p_device_secret: dev.device_secret,
      p_pin: pin
    });
    if (!r.ok) return r;
    session.token = r.token;
    session.user = userFrom(r);
    session.offline = false;
    await setMeta(DEVICE, { ...dev, ...userFrom(r) });
    await rememberPin(dev, pin);
    return { ok: true };
  } catch (e) {
    if (e.code !== 'OFFLINE') throw e;
    return offlineUnlock(dev, pin);
  }
}

async function offlineUnlock(dev, pin) {
  const local = await getMeta(PIN_LOCAL);
  if (!local?.hash) {
    return { ok: false, code: 'OFFLINE', message: 'No internet. Connect once to unlock this phone.' };
  }
  if (local.tries >= MAX_LOCAL_TRIES) {
    return { ok: false, code: 'LOCKED', message: 'Too many wrong PINs. Connect to the internet to unlock.' };
  }
  if ((await localHash(dev.device_secret, pin)) === local.hash) {
    await setMeta(PIN_LOCAL, { ...local, tries: 0 });
    session.token = null;
    session.user = userFrom(dev);
    session.offline = true;
    return { ok: true, offline: true };
  }
  const tries = local.tries + 1;
  await setMeta(PIN_LOCAL, { ...local, tries });
  return { ok: false, code: 'WRONG_PIN', message: 'Wrong PIN', attempts_left: MAX_LOCAL_TRIES - tries };
}

export function lock() {
  session.token = null;
  session.user = null;
  session.offline = false;
}

// Phone blocked by the admin: drop its keys so the next user must register again
export async function forgetDevice() {
  await db.meta.delete(DEVICE);
  await db.meta.delete(PIN_LOCAL);
  lock();
}
