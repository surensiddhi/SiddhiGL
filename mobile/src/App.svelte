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

  let screen = $state('loading');   // loading | register | setpin | pin | home | coming
  let hasPin = $state(false);
  let notice = $state('');
  let tile = $state(null);

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

    return () => {
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

  function open(t, title) {
    tile = { ...t, title };
    screen = 'coming';
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
{:else if screen === 'coming'}
  <Coming title={tile.title} icon={tile.icon} onBack={() => (screen = 'home')} />
{/if}
