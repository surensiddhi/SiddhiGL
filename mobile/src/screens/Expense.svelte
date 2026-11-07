<script>
  // Expense: pick head -> amount -> Save (Cash by default)
  import { onMount } from 'svelte';
  import { db, getMeta } from '../lib/db.js';
  import { saveEntry, today, money } from '../lib/entries.js';
  import Icon from '../components/Icon.svelte';
  import ModeChips from '../components/ModeChips.svelte';
  import PhotoField from '../components/PhotoField.svelte';

  let { onBack, onSaved } = $props();

  let lang = $state('en');
  let photos = $state([]);
  let photoAbove = $state(0);     // mob.settings photo_above_amount (0 = never required by amount)
  let heads = $state([]);
  let head = $state(null);
  let amount = $state('');
  let mode = $state('CASH');
  let note = $state('');
  let busy = $state(false);
  let error = $state('');
  let amountBox;

  const label = (h) => (lang === 'np' && h.label_np) ? h.label_np : h.label_en;
  const value = $derived(Number(amount) || 0);
  const photoNeeded = $derived(!!head?.photo_required || (photoAbove > 0 && value >= photoAbove));
  const photoMissing = $derived(photoNeeded && !photos.length);

  onMount(async () => {
    heads = (await db.expense_heads.toArray()).sort((a, b) => a.sort - b.sort);
    lang = (await getMeta('lang')) ?? 'en';
    photoAbove = Number((await db.settings.get('photo_above_amount'))?.value) || 0;
  });

  function pickHead(h) {
    head = h;
    setTimeout(() => amountBox?.focus(), 50);
  }

  async function save() {
    error = '';
    if (!head) return (error = 'Choose what the expense was for.');
    if (!(value > 0)) return (error = 'Enter the amount.');
    if (photoMissing) return (error = 'Take a photo of the bill.');
    busy = true;
    try {
      const entry = await saveEntry({
        entry_type: 'EXPENSE',
        entry_date: today(),
        title: label(head),
        payment_mode: mode,
        note: note.trim() || null,
        total: value,
        lines: [{ expense_head: head.code, head_name: label(head), qty: 1, price_incl_vat: value }]
      }, photos);
      onSaved(entry);
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
    }
  }
</script>

<main class="screen with-footer">
  <header class="topbar">
    <button class="icon-btn" type="button" onclick={onBack} aria-label="Back"><Icon name="back" size={24} /></button>
    <h2>Expense</h2>
    <span style="width:44px"></span>
  </header>

  <div class="heads">
    {#each heads as h (h.code)}
      <button type="button" class:on={head?.code === h.code} onclick={() => pickHead(h)}>{label(h)}</button>
    {/each}
  </div>

  <label class="amount">
    Amount (Rs)
    <input bind:this={amountBox} bind:value={amount} inputmode="decimal" placeholder="0" />
  </label>

  <div class="block">
    <ModeChips bind:value={mode} />
  </div>

  <label class="block">
    Note (optional)
    <input bind:value={note} maxlength="300" placeholder="e.g. bike fuel" />
  </label>

  <div class="block">
    <PhotoField bind:photos label="Bill photo"
      hint={photoMissing ? (head?.photo_required ? 'Needed for this expense' : `Needed from Rs ${photoAbove.toLocaleString('en-IN')}`) : ''} />
  </div>

  {#if error}<p class="msg error">{error}</p>{/if}

  <footer class="footer">
    <div>
      <div class="muted small">{head ? label(head) : 'Expense'}</div>
      <div class="total">Rs {money(value)}</div>
    </div>
    <button class="primary" type="button" onclick={save} disabled={busy || !head || !(value > 0) || photoMissing}>Save</button>
  </footer>
</main>

<style>
  .heads { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .heads button {
    min-height: 56px; padding: 6px; border-radius: 14px; border: 1px solid var(--line);
    background: var(--card); font-weight: 600; font-size: 14px; line-height: 1.2;
  }
  .heads button.on { background: var(--brand); border-color: var(--brand); color: #fff; }
  .amount { margin-top: 18px; }
  .amount input { height: 64px; font-size: 30px; font-weight: 700; }
  .block { margin-top: 14px; }
</style>
