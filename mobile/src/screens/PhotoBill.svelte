<script>
  // Photo Bill: just snap the paper bill. Our team enters it from the photo.
  import { saveEntry, today, money } from '../lib/entries.js';
  import Icon from '../components/Icon.svelte';
  import PhotoField from '../components/PhotoField.svelte';

  let { onBack, onSaved } = $props();

  let photos = $state([]);
  let note = $state('');
  let amount = $state('');
  let busy = $state(false);
  let error = $state('');

  const value = $derived(Number(amount) || 0);

  async function save() {
    error = '';
    if (!photos.length) return (error = 'Take a photo of the bill first.');
    busy = true;
    try {
      const entry = await saveEntry({
        entry_type: 'PHOTO',
        entry_date: today(),
        title: note.trim() ? 'Photo bill · ' + note.trim() : 'Photo bill',
        note: note.trim() || null,
        amount: value || null,
        total: value
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
    <h2>Photo Bill</h2>
    <span style="width:44px"></span>
  </header>

  <p class="muted">Snap the paper bill. Our team will enter it for you.</p>

  <PhotoField bind:photos label="Bill photo" big />

  <label class="block">
    What is it? (optional)
    <input bind:value={note} maxlength="300" placeholder="e.g. Purchase from Supplier X" />
  </label>

  <label class="block">
    Amount (optional)
    <input bind:value={amount} inputmode="decimal" placeholder="0" />
  </label>

  {#if error}<p class="msg error">{error}</p>{/if}

  <footer class="footer">
    <div>
      <div class="muted small">{photos.length} photo{photos.length === 1 ? '' : 's'}</div>
      <div class="total">{value ? 'Rs ' + money(value) : ''}</div>
    </div>
    <button class="primary" type="button" onclick={save} disabled={busy || !photos.length}>Save</button>
  </footer>
</main>

<style>
  .block { margin-top: 14px; }
</style>
