<script>
  // SiddhiGL Mobile — screen switcher (one screen at a time, like FormXxx in Delphi)
  import { onMount } from 'svelte';
  import { db } from './lib/db.js';
  import { getDevice, lock, forgetDevice } from './lib/auth.js';
  import { session } from './stores/session.svelte.js';
  import Register from './screens/Register.svelte';
  import SetPin from './screens/SetPin.svelte';
  import PinLogin from './screens/PinLogin.svelte';
  import Home from './screens/Home.svelte';
  import Coming from './screens/Coming.svelte';
  import Sale from './screens/Sale.svelte';
  import Expense from './screens/Expense.svelte';
  import Saved from './screens/Saved.svelte';
  import MyEntries from './screens/MyEntries.svelte';
  import Money from './screens/Money.svelte';
  import PhotoBill from './screens/PhotoBill.svelte';
  import EntryDetail from './screens/EntryDetail.svelte';
  import { sendPending } from './lib/entries.js';

  // loading | register | setpin | pin | home | coming | sale | expense | saved | entries | detail
  let screen = $state('loading');
  let saved = $state(null);         // the entry just saved
  let formKey = $state(0);          // bump to start a fresh form
  let hasPin = $state(false);
  let notice = $state('');
  let tile = $state(null);
  let detail = $state(null);        // { entry, back } for the detail screen

  // Auto-lock after idle minutes (mob.settings: idle_lock_minutes)
  let lastActive = Date.now();
  let idleMinutes = 5;

  async function readIdleSetting() {
    const s = await db.settings.get('idle_lock_minutes');
    idleMinutes = Number(s?.value) || 5;
  }

  function checkIdle() {
    if (session.user && Date.now() - lastActive > idleMinutes * 60000) doLock();
  }

  onMount(() => {
    getDevice().then(dev => (screen = dev ? 'pin' : 'register'));

    const touch = () => (lastActive = Date.now());
    const onVisible = () => document.visibilityState === 'visible' && checkIdle();
    addEventListener('pointerdown', touch, { passive: true });
    addEventListener('keydown', touch);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(checkIdle, 30000);
    const onOnline = () => sendPending();     // internet back: send what is waiting
    addEventListener('online', onOnline);

    return () => {
      removeEventListener('online', onOnline);
      removeEventListener('pointerdown', touch);
      removeEventListener('keydown', touch);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  });

  function registered(r) {
    notice = '';
    hasPin = r.hasPin;
    screen = 'setpin';
  }

  async function unlocked() {
    lastActive = Date.now();
    await readIdleSetting();
    screen = 'home';
  }

  function doLock() {
    lock();
    screen = 'pin';
  }

  async function blocked(message) {
    await forgetDevice();
    notice = message;
    screen = 'register';
  }

  // Tile action (from mob.menu) -> screen
  const SCREENS = {
    SALE: 'sale', EXPENSE: 'expense', RECEIPT: 'receipt', PAYMENT: 'payment',
    PHOTO: 'photo', MY_ENTRIES: 'entries'
  };

  function open(t, title) {
    tile = { ...t, title };
    formKey++;
    screen = SCREENS[t.action] ?? 'coming';
  }

  function afterSave(entry) {
    saved = entry;
    screen = 'saved';
  }

  function again() {
    formKey++;
    screen = SCREENS[saved.entry_type] ?? 'home';
  }

  const home = () => (screen = 'home');

  // Detail opens from My Entries or Saved; Back returns there
  function view(entry, back) {
    detail = { entry, back };
    screen = 'detail';
  }
</script>

{#if screen === 'register'}
  <Register onRegistered={registered} {notice} />
{:else if screen === 'setpin'}
  <SetPin {hasPin} onDone={unlocked} />
{:else if screen === 'pin'}
  <PinLogin onUnlocked={unlocked} onForgot={() => (screen = 'register')} onBlocked={blocked} />
{:else if screen === 'home'}
  <Home onOpen={open} onLock={doLock} onBlocked={blocked} />
{:else if screen === 'sale'}
  {#key formKey}<Sale onBack={home} onSaved={afterSave} />{/key}
{:else if screen === 'expense'}
  {#key formKey}<Expense onBack={home} onSaved={afterSave} />{/key}
{:else if screen === 'receipt'}
  {#key formKey}<Money type="RECEIPT" onBack={home} onSaved={afterSave} />{/key}
{:else if screen === 'payment'}
  {#key formKey}<Money type="PAYMENT" onBack={home} onSaved={afterSave} />{/key}
{:else if screen === 'photo'}
  {#key formKey}<PhotoBill onBack={home} onSaved={afterSave} />{/key}
{:else if screen === 'saved'}
  <Saved entry={saved} onAgain={again} onHome={home} onView={(e) => view(e, 'saved')} />
{:else if screen === 'entries'}
  <MyEntries onBack={home} onOpen={(e) => view(e, 'entries')} />
{:else if screen === 'detail'}
  <EntryDetail entry={detail.entry} onBack={() => (screen = detail.back)} />
{:else if screen === 'coming'}
  <Coming title={tile.title} icon={tile.icon} onBack={home} />
{/if}
