<script>
  // Full-screen payment QR for the customer to scan.
  // The QR text is the tenant's own (mob.settings 'pay_qr'), drawn on the phone, works offline.
  import { onMount } from 'svelte';
  import QRCode from 'qrcode';
  import { db } from '../lib/db.js';
  import { money } from '../lib/entries.js';

  let { amount = 0, onClose } = $props();

  let svg = $state('');
  let name = $state('');
  let missing = $state(false);

  onMount(async () => {
    const text = (await db.settings.get('pay_qr'))?.value;
    name = (await db.settings.get('pay_qr_name'))?.value ?? '';
    if (!text) { missing = true; return; }
    svg = await QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 });
  });
</script>

<div class="overlay" role="dialog" aria-modal="true" aria-label="Payment QR">
  <div class="card">
    {#if missing}
      <p class="none">No payment QR is set for this company.<br />Ask the office to add it.</p>
    {:else}
      <div class="qr">{@html svg}</div>
      {#if name}<div class="name">{name}</div>{/if}
      {#if amount > 0}<div class="amt">Rs {money(amount)}</div>{/if}
      <p class="hint">Scan with your bank or wallet app.<br />Enter the amount shown above.</p>
    {/if}
    <button class="primary" type="button" onclick={onClose}>Done</button>
  </div>
</div>

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 50; background: rgba(0, 0, 0, 0.6);
    display: flex; align-items: center; justify-content: center; padding: 16px;
  }
  /* Always white behind the QR, even in dark mode, so scanners can read it */
  .card {
    width: 100%; max-width: 380px; background: #fff; color: #1b2421;
    border-radius: 20px; padding: 20px; text-align: center; display: flex; flex-direction: column;
  }
  .qr :global(svg) { width: 100%; height: auto; display: block; }
  .name { font-size: 17px; font-weight: 700; margin-top: 8px; }
  .amt { font-size: 32px; font-weight: 800; margin: 6px 0; }
  .hint { color: #5d6b66; font-size: 14px; margin: 6px 0 12px; }
  .none { margin: 20px 0; }
  .primary { width: 100%; }
</style>
