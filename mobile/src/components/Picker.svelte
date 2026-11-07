<script>
  // Full-screen search list for picking a party or an item.
  // rows: [{ key, title, sub, badge }] ; favourites: same shape, shown when the search is empty
  import Icon from './Icon.svelte';

  let { title, rows = [], favourites = [], placeholder = 'Search', onPick, onClose } = $props();

  let q = $state('');
  let input;

  const shown = $derived.by(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows.slice(0, 60);
    return rows
      .filter(r => r.title.toLowerCase().includes(t) || String(r.key).toLowerCase().includes(t))
      .slice(0, 60);
  });

  $effect(() => { input?.focus(); });
</script>

<div class="sheet" role="dialog" aria-label={title}>
  <header class="topbar">
    <button class="icon-btn" type="button" onclick={onClose} aria-label="Close"><Icon name="back" size={24} /></button>
    <h2>{title}</h2>
    <span style="width:44px"></span>
  </header>

  <input class="search" bind:this={input} bind:value={q} {placeholder} type="search" autocomplete="off" />

  {#if !q && favourites.length}
    <div class="label">Most used</div>
    <div class="favs">
      {#each favourites as f (f.key)}
        <button type="button" class="fav" onclick={() => onPick(f.key)}>{f.title}</button>
      {/each}
    </div>
    <div class="label">All</div>
  {/if}

  <ul>
    {#each shown as r (r.key)}
      <li>
        <button type="button" onclick={() => onPick(r.key)}>
          <span class="t">{r.title}</span>
          {#if r.badge}<span class="badge">{r.badge}</span>{/if}
          {#if r.sub}<span class="s">{r.sub}</span>{/if}
        </button>
      </li>
    {:else}
      <li class="none">Nothing found</li>
    {/each}
  </ul>
</div>

<style>
  .sheet {
    position: fixed; inset: 0; z-index: 20; background: var(--bg); overflow-y: auto;
    padding: max(16px, env(safe-area-inset-top)) 16px 24px;
  }
  .search { width: 100%; margin-bottom: 8px; }
  .label { font-size: 13px; color: var(--ink-2); margin: 12px 0 6px; font-weight: 600; }
  .favs { display: flex; flex-wrap: wrap; gap: 8px; }
  .fav {
    padding: 10px 14px; border-radius: 20px; border: 1px solid var(--line);
    background: var(--card); font-size: 14px; font-weight: 600;
  }
  ul { list-style: none; padding: 0; margin: 8px 0 0; }
  li button {
    width: 100%; text-align: left; padding: 14px 4px; border: 0; border-bottom: 1px solid var(--line);
    background: none; display: grid; grid-template-columns: 1fr auto; gap: 2px 8px;
  }
  .t { font-weight: 600; font-size: 16px; }
  .s { grid-column: 1 / -1; color: var(--ink-2); font-size: 13px; }
  .badge {
    align-self: center; font-size: 12px; font-weight: 700; color: var(--brand);
    background: var(--brand-tint); border-radius: 10px; padding: 2px 8px;
  }
  .none { color: var(--ink-2); text-align: center; padding: 24px; }
</style>
