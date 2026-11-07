<script>
  // Take or attach up to 5 photos. On a phone the button opens the camera.
  // photos: [{ blob, url, kb }]
  import { compress } from '../lib/photo.js';
  import Icon from './Icon.svelte';

  let { photos = $bindable([]), max = 5, label = 'Photo', hint = '', big = false } = $props();

  let busy = $state(false);
  let error = $state('');

  async function added(e) {
    const files = [...e.currentTarget.files];
    e.currentTarget.value = '';
    busy = true;
    error = '';
    try {
      for (const f of files) {
        if (photos.length >= max) break;
        const blob = await compress(f);
        photos.push({ blob, url: URL.createObjectURL(blob), kb: Math.ceil(blob.size / 1024) });
      }
    } catch {
      error = 'Could not read that photo. Try again.';
    } finally {
      busy = false;
    }
  }

  function remove(i) {
    URL.revokeObjectURL(photos[i].url);
    photos.splice(i, 1);
  }
</script>

<div class="photos">
  <div class="head">
    <span class="lbl">{label}</span>
    {#if hint}<span class="hint">{hint}</span>{/if}
  </div>

  <div class="row">
    {#each photos as p, i (p.url)}
      <div class="thumb">
        <img src={p.url} alt="Photo {i + 1}" />
        <button type="button" onclick={() => remove(i)} aria-label="Remove photo {i + 1}">×</button>
      </div>
    {/each}

    {#if photos.length < max}
      <label class="take" class:big={big && !photos.length}>
        <input type="file" accept="image/*" capture="environment" onchange={added} disabled={busy} />
        <Icon name="camera" size={big && !photos.length ? 44 : 26} />
        <span>{busy ? 'Reading...' : photos.length ? 'Add' : 'Take photo'}</span>
      </label>
    {/if}
  </div>

  {#if error}<p class="err">{error}</p>{/if}
</div>

<style>
  .head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
  .lbl { font-weight: 600; font-size: 15px; }
  .hint { font-size: 13px; color: var(--warn); font-weight: 600; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; }
  .thumb { position: relative; width: 84px; height: 84px; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; border-radius: 12px; border: 1px solid var(--line); }
  .thumb button {
    position: absolute; top: -6px; right: -6px; width: 26px; height: 26px; border-radius: 50%;
    border: 0; background: var(--ink); color: var(--bg); font-size: 16px; line-height: 1;
  }
  .take {
    position: relative; width: 84px; height: 84px; border-radius: 12px; border: 2px dashed var(--brand);
    color: var(--brand); display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 2px; font-size: 13px; font-weight: 700; cursor: pointer;
  }
  .take.big { width: 100%; height: 180px; font-size: 17px; gap: 8px; }
  .take input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
  .err { color: var(--error); font-size: 13px; margin: 6px 0 0; }
</style>
