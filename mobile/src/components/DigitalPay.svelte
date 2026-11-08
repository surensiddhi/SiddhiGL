<script>
  // Shown when the payment mode is Digital: show QR to the customer, then type the reference.
  import PayQR from './PayQR.svelte';
  import Icon from './Icon.svelte';

  let { amount = 0, payRef = $bindable('') } = $props();
  let showing = $state(false);
</script>

<div class="dpay">
  <button class="qrbtn" type="button" onclick={() => (showing = true)}>
    <Icon name="qr" size={22} /> Show QR to customer
  </button>
  <label>
    Payment ref <small class="muted">(last 6 digits from customer's app)</small>
    <input bind:value={payRef} inputmode="numeric" maxlength="40" placeholder="e.g. 381920" />
  </label>
</div>

{#if showing}<PayQR {amount} onClose={() => (showing = false)} />{/if}

<style>
  .dpay { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
  .qrbtn {
    height: 52px; border-radius: 14px; border: 1px solid var(--brand); background: var(--brand-tint);
    color: var(--brand); font-weight: 700; font-size: 16px;
    display: flex; align-items: center; justify-content: center; gap: 8px;
  }
</style>
