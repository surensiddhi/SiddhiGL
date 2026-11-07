<script>
  // Payment mode buttons: Cash / Bank / Digital (/ Credit)
  let { value = $bindable('CASH'), modes = ['CASH', 'BANK', 'DIGITAL'], onChange } = $props();
  const names = { CASH: 'Cash', BANK: 'Bank', DIGITAL: 'Digital', CREDIT: 'Credit' };

  function pick(m) {
    value = m;
    onChange?.(m);
  }
</script>

<div class="modes" role="radiogroup" aria-label="Payment mode">
  {#each modes as m}
    <button type="button" role="radio" aria-checked={value === m} class:on={value === m} onclick={() => pick(m)}>
      {names[m]}
    </button>
  {/each}
</div>

<style>
  .modes { display: flex; gap: 8px; }
  button {
    flex: 1; height: 44px; border-radius: 12px; border: 1px solid var(--line);
    background: var(--card); font-weight: 600; font-size: 15px;
  }
  button.on { background: var(--brand); border-color: var(--brand); color: #fff; }
</style>
