<script>
  // Home: tiles from mob.menu (already filtered by role on the server)
  import { onMount } from 'svelte';
  import { db, getMeta, setMeta } from '../lib/db.js';
  import { syncMasters } from '../lib/sync.js';
  import { isPhoneBlocked } from '../lib/api.js';
  import { sendPending, waitingCount } from '../lib/entries.js';
  import { session } from '../stores/session.svelte.js';
  import Icon from '../components/Icon.svelte';

  let { onOpen, onLock, onBlocked } = $props();

  let tiles = $state([]);
  let lastSync = $state(null);
  let lang = $state('en');
  let syncing = $state(false);
  let message = $state('');
  let waiting = $state(0);

  const label = (t) => (lang === 'np' && t.label_np) ? t.label_np : t.label_en;

  const syncText = $derived(
    lastSync
      ? 'Updated ' + new Date(lastSync).toLocaleString('en-GB',
          { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : 'Not updated yet'
  );

  async function load() {
    tiles = (await db.menu.toArray()).sort((a, b) => a.sort - b.sort);
    lastSync = await getMeta('last_sync');
    lang = (await getMeta('lang')) ?? 'en';
    waiting = await waitingCount();
  }

  async function sync() {
    if (!session.token) {
      message = 'Working offline. Unlock with internet on to update.';
      return;
    }
    syncing = true;
    message = '';
    try {
      await sendPending();
      await syncMasters();
      await load();
    } catch (e) {
      if (isPhoneBlocked(e)) return onBlocked(e.message);
      if (e.code === 'EXPIRED') return onLock();
      message = e.code === 'OFFLINE' ? 'No internet. Entries are saved and will be sent later.' : e.message;
    } finally {
      syncing = false;
    }
  }

  async function toggleLang() {
    lang = lang === 'en' ? 'np' : 'en';
    await setMeta('lang', lang);
  }

  onMount(async () => {
    await load();
    if (session.token) sync();
    else if (session.offline) message = 'Working offline. Entries will be sent later.';
  });
</script>

<main class="screen">
  <header class="topbar">
    <div>
      <div class="company">{session.user?.company_name ?? ''}</div>
      <div class="muted small">{session.user?.full_name} · {session.user?.device_code}</div>
    </div>
    <div class="top-actions">
      <button class="chip" type="button" onclick={toggleLang}>{lang === 'en' ? 'नेपाली' : 'English'}</button>
      <button class="icon-btn" type="button" onclick={onLock} aria-label="Lock">
        <Icon name="lock" size={22} />
      </button>
    </div>
  </header>

  <button class="syncbar" class:offline={session.offline} type="button" onclick={sync} disabled={syncing}>
    <span class:spin={syncing}><Icon name="sync" size={18} /></span>
    <span>{syncing ? 'Updating...' : session.offline ? 'Offline' : syncText}</span>
    {#if waiting}<span class="pending-badge">{waiting} to send</span>{/if}
  </button>

  {#if message}<p class="msg warn">{message}</p>{/if}

  {#if tiles.length === 0 && !syncing}
    <p class="empty">No menu yet. Connect to the internet and tap the bar above.</p>
  {/if}

  <div class="tiles">
    {#each tiles as t (t.code)}
      <button class="tile" type="button" onclick={() => onOpen(t, label(t))}>
        <Icon name={t.icon} />
        <span>{label(t)}</span>
      </button>
    {/each}
  </div>
</main>
