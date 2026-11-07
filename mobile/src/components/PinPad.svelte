<script>
  // 4-digit PIN entry with a big number pad. Calls onComplete(pin) at the 4th digit.
  // Change clearSignal (any new number) to empty the dots.
  let { onComplete, disabled = false, clearSignal = 0 } = $props();
  let pin = $state('');

  $effect(() => {
    clearSignal;
    pin = '';
  });

  function press(d) {
    if (disabled || pin.length >= 4) return;
    pin += d;
    if (pin.length === 4) onComplete(pin);
  }

  function back() {
    if (!disabled) pin = pin.slice(0, -1);
  }
</script>

<div class="dots" aria-label="{pin.length} of 4 digits entered">
  {#each [0, 1, 2, 3] as i}
    <span class:filled={i < pin.length}></span>
  {/each}
</div>

<div class="pad">
  {#each ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as d}
    <button type="button" onclick={() => press(d)} {disabled}>{d}</button>
  {/each}
  <span></span>
  <button type="button" onclick={() => press('0')} {disabled}>0</button>
  <button type="button" class="back" onclick={back} {disabled} aria-label="Delete last digit">
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H9l-6 7 6 7h12z"/><path d="M17 9l-6 6M11 9l6 6"/></svg>
  </button>
</div>

<style>
  .dots { display: flex; justify-content: center; gap: 18px; margin: 8px 0 28px; }
  .dots span {
    width: 16px; height: 16px; border-radius: 50%;
    border: 2px solid var(--ink-2);
  }
  .dots span.filled { background: var(--brand); border-color: var(--brand); }
  .pad {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
    width: 100%; max-width: 300px; margin: 0 auto;
  }
  .pad button {
    height: 64px; border-radius: 16px; border: 1px solid var(--line);
    background: var(--card); color: var(--ink); font-size: 26px; font-weight: 600;
    display: flex; align-items: center; justify-content: center;
  }
  .pad button:active { background: var(--brand-tint); }
  .pad button.back { border-color: transparent; background: transparent; color: var(--ink-2); }
</style>
