<script>
  // Shown after Save: what was saved and whether it was sent
  import { onMount } from 'svelte';
  import { db } from '../lib/db.js';
  import { sendPending, money } from '../lib/entries.js';

  let { entry, onAgain, onHome, onView } = $props();
  let status = $state(entry.status);
  let photosLeft = $state(entry.photo_count ?? 0);

  const AGAIN = { SALE: 'New sale', EXPENSE: 'New expense', RECEIPT: 'New receipt', PAYMENT: 'New payment', PHOTO: 'Another photo bill' };

  onMount(async () => {
    await sendPending();
    status = (await db.outbox.get(entry.entry_id))?.status ?? status;
    photosLeft = await db.photos.where('entry_id').equals(entry.entry_id)
      .filter(p => p.status !== 'SENT').count();
  });
</script>

<main class="screen narrow center">
  <div class="tick"><svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
  <h1>Saved</h1>
  {#if entry.total}<p class="big">Rs {money(entry.total)}</p>{/if}
  <p class="muted">
    {entry.title ?? ''}
    {#if entry.temp_no}<br />Temp no. {entry.temp_no}{/if}
  </p>

  {#if status === 'SENT' && !photosLeft}
    <p class="msg ok">Sent for review{entry.photo_count ? ', with photos' : ''}.</p>
  {:else if status === 'SENT'}
    <p class="msg warn">Sent. {photosLeft} photo{photosLeft === 1 ? '' : 's'} still sending.</p>
  {:else if status === 'FAILED'}
    <p class="msg error">Not accepted. See My Entries.</p>
  {:else}
    <p class="msg warn">Saved on this phone. It will be sent when you are online.</p>
  {/if}

  <button class="share" type="button" onclick={() => onView(entry)}>{entry.entry_type === 'SALE' ? 'View / Share bill' : 'View / Share'}</button>
  <button class="primary" type="button" onclick={onAgain}>{AGAIN[entry.entry_type] ?? 'New'}</button>
  <button class="link" type="button" onclick={onHome}>Home</button>
</main>

<style>
  .tick {
    width: 80px; height: 80px; border-radius: 50%; margin: 0 auto 8px;
    background: var(--brand-tint); color: var(--brand);
    display: flex; align-items: center; justify-content: center;
  }
  .share {
    height: 52px; border-radius: 14px; border: 1px solid var(--brand); background: var(--card);
    color: var(--brand); font-weight: 700; font-size: 16px; margin-top: 8px;
  }
  .big { font-size: 30px; font-weight: 800; margin: 4px 0; }
</style>
