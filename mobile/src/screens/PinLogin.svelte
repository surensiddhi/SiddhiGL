<script>
  // Daily unlock with the 4-digit PIN
  import { onMount } from 'svelte';
  import PinPad from '../components/PinPad.svelte';
  import { getDevice, pinLogin } from '../lib/auth.js';
  import { isPhoneBlocked } from '../lib/api.js';

  let { onUnlocked, onForgot, onBlocked } = $props();

  let dev = $state(null);
  let busy = $state(false);
  let error = $state('');
  let clear = $state(0);

  onMount(async () => {
    dev = await getDevice();
  });

  async function entered(pin) {
    busy = true;
    error = '';
    try {
      const r = await pinLogin(pin);
      if (r.ok) {
        onUnlocked();
        return;
      }
      error = r.code === 'WRONG_PIN' && r.attempts_left != null
        ? `Wrong PIN. ${r.attempts_left} ${r.attempts_left === 1 ? 'try' : 'tries'} left.`
        : r.message;
    } catch (e) {
      if (isPhoneBlocked(e)) {
        onBlocked(e.message);
        return;
      }
      error = e.message;
    } finally {
      busy = false;
      clear++;
    }
  }
</script>

<main class="screen narrow center">
  <header class="brand-head">
    <div class="logo">S</div>
    <h1>Namaste{dev?.full_name ? ', ' + dev.full_name.split(' ')[0] : ''}</h1>
    <p class="muted">{dev?.company_name ?? ''}</p>
  </header>

  <p class="prompt">Enter your PIN</p>
  <PinPad onComplete={entered} disabled={busy} clearSignal={clear} />

  {#if error}<p class="msg error">{error}</p>{/if}

  <button class="link" type="button" onclick={onForgot}>Forgot PIN? Log in with password</button>
</main>
