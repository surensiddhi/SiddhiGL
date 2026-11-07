<script>
  // Choose a 4-digit PIN (enter twice). Right after setting up the phone, no old PIN is needed.
  import PinPad from '../components/PinPad.svelte';
  import { setPin } from '../lib/auth.js';

  let { hasPin = false, onDone } = $props();

  let first = $state(null);
  let busy = $state(false);
  let error = $state('');
  let clear = $state(0);

  async function entered(pin) {
    error = '';
    if (first === null) {
      first = pin;
      clear++;
      return;
    }
    if (pin !== first) {
      error = 'The two PINs do not match. Start again.';
      first = null;
      clear++;
      return;
    }
    busy = true;
    try {
      await setPin(pin);
      onDone();
    } catch (e) {
      error = e.message;
      first = null;
      clear++;
    } finally {
      busy = false;
    }
  }
</script>

<main class="screen narrow center">
  <h1>{first === null ? 'Choose a 4-digit PIN' : 'Enter the PIN again'}</h1>
  <p class="muted">You will use this PIN every day to open the app.</p>

  <PinPad onComplete={entered} disabled={busy} clearSignal={clear} />

  {#if error}<p class="msg error">{error}</p>{/if}

  {#if hasPin}
    <button class="link" type="button" onclick={onDone}>Keep my current PIN</button>
  {/if}
</main>
