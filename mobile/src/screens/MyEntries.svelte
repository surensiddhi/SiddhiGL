<script>
  // My Entries: what this phone saved, and where each one is now
  import { onMount } from 'svelte';
  import { myEntries, retryEntry, deleteEntry, sendPending, money } from '../lib/entries.js';
  import Icon from '../components/Icon.svelte';

  let { onBack } = $props();
  let list = $state([]);
  let loading = $state(true);

  async function load() {
    loading = true;
    await sendPending();
    list = await myEntries();
    loading = false;
  }

  onMount(load);

  function badge(e) {
    if (e.status === 'PENDING') return { text: 'Waiting to send', cls: 'warn' };
    if (e.status === 'FAILED') return { text: 'Not accepted', cls: 'error' };
    if (e.server_status === 'APPROVED') return { text: 'Approved', cls: 'ok' };
    if (e.server_status === 'REJECTED') return { text: 'Rejected', cls: 'error' };
    return { text: 'Sent for review', cls: 'info' };
  }

  const TYPE = { SALE: 'Sale', EXPENSE: 'Expense', RECEIPT: 'Receipt', PAYMENT: 'Payment', PHOTO: '' };
  const title = (e) => {
    const name = e.title ?? (e.entry_type === 'SALE' ? e.party_name : e.lines?.[0]?.head_name) ?? '';
    return TYPE[e.entry_type] ? `${TYPE[e.entry_type]} · ${name}` : name;
  };

  const when = (e) => new Date(e.created_at).toLocaleString('en-GB',
    { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  async function retry(e) { await retryEntry(e.entry_id); await load(); }
  async function remove(e) { await deleteEntry(e.entry_id); await load(); }
</script>

<main class="screen">
  <header class="topbar">
    <button class="icon-btn" type="button" onclick={onBack} aria-label="Back"><Icon name="back" size={24} /></button>
    <h2>My Entries</h2>
    <button class="icon-btn" type="button" onclick={load} aria-label="Refresh"><Icon name="sync" size={20} /></button>
  </header>

  {#if loading && !list.length}
    <p class="empty">Loading...</p>
  {:else if !list.length}
    <p class="empty">No entries yet.</p>
  {/if}

  <ul>
    {#each list as e (e.entry_id)}
      {@const b = badge(e)}
      <li>
        <div class="row">
          <strong>{title(e)}</strong>
          <span class="amt">{e.total ? 'Rs ' + money(e.total) : ''}</span>
        </div>
        <div class="row small">
          <span class="muted">{when(e)}{e.temp_no ? ' · ' + e.temp_no : ''}</span>
          <span class="badge {b.cls}">{b.text}</span>
        </div>
        {#if e.price_flag}<p class="note warn">Price change needs approval</p>{/if}
        {#if e.photos_waiting}<p class="note warn">{e.photos_waiting} photo{e.photos_waiting === 1 ? '' : 's'} waiting to send</p>{/if}
        {#each e.photos_failed ?? [] as p (p.photo_id)}
          <p class="note error">Photo not accepted: {p.error}</p>
        {/each}
        {#if e.photos_failed?.length && e.status === 'SENT'}
          <div class="acts"><button type="button" onclick={() => retry(e)}>Send photos again</button></div>
        {/if}
        {#if e.status === 'FAILED'}
          <p class="note error">{e.error}</p>
          <div class="acts">
            <button type="button" onclick={() => retry(e)}>Try again</button>
            <button type="button" onclick={() => remove(e)}>Delete</button>
          </div>
        {/if}
        {#if e.server_status === 'REJECTED' && e.reject_reason}
          <p class="note error">Reason: {e.reject_reason}</p>
        {/if}
      </li>
    {/each}
  </ul>
</main>

<style>
  ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
  li { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .row.small { margin-top: 6px; font-size: 13px; }
  .amt { font-weight: 700; white-space: nowrap; }
  .badge { font-size: 12px; font-weight: 700; border-radius: 10px; padding: 3px 8px; white-space: nowrap; }
  .badge.warn { background: var(--warn-bg); color: var(--warn); }
  .badge.error { background: var(--error-bg); color: var(--error); }
  .badge.ok { background: var(--brand-tint); color: var(--brand); }
  .badge.info { background: var(--bg); color: var(--ink-2); border: 1px solid var(--line); }
  .note { margin: 8px 0 0; font-size: 13px; font-weight: 600; }
  .note.warn { color: var(--warn); }
  .note.error { color: var(--error); }
  .acts { display: flex; gap: 8px; margin-top: 8px; }
  .acts button {
    flex: 1; height: 40px; border-radius: 10px; border: 1px solid var(--line);
    background: var(--bg); font-weight: 600;
  }
</style>
