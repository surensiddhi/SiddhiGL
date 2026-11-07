<script>
  // Sale: party (Cash Customer by default) -> items -> qty -> Save
  // Prices come from SiddhiGL (VAT included) and can be changed;
  // a change above the tolerance % is marked for approval.
  import { onMount } from 'svelte';
  import { db, getMeta, priceFor } from '../lib/db.js';
  import { saveEntry, favouriteItems, today, money } from '../lib/entries.js';
  import Icon from '../components/Icon.svelte';
  import Picker from '../components/Picker.svelte';
  import ModeChips from '../components/ModeChips.svelte';

  let { onBack, onSaved } = $props();

  const CASH = 'CASH';
  let parties = $state([]);
  let items = $state([]);
  let favs = $state([]);
  let tolerance = $state(0);

  let party = $state(null);          // { party_code, party_name, is_vip }
  let mode = $state('CASH');
  let lines = $state([]);            // { item_code, item_name, unit, qty, list, price, edited }
  let picking = $state(null);        // 'party' | 'item' | null
  let editing = $state(null);        // index of the line whose price is open
  let busy = $state(false);
  let error = $state('');

  const total = $derived(lines.reduce((s, l) => s + Math.round(l.qty * l.price * 100) / 100, 0));
  const isVip = $derived(!!party?.is_vip);
  const overTol = (l) => l.edited && (l.list === 0 || Math.abs(l.price - l.list) / l.list * 100 > tolerance);

  onMount(async () => {
    parties = (await db.parties.where('party_type').equals('D').toArray())
      .sort((a, b) => a.party_name.localeCompare(b.party_name));
    items = await db.items.toArray();
    favs = await favouriteItems();
    tolerance = Number((await getMeta('company'))?.rate_edit_tolerance_pct ?? 0);
    party = parties.find(p => p.party_code === CASH) ?? null;
  });

  async function reprice(l) {
    l.list = await priceFor(l.item_code, l.qty, isVip);
    if (!l.edited) l.price = l.list;
  }

  async function pickParty(code) {
    party = parties.find(p => p.party_code === code);
    picking = null;
    if (code === CASH && mode === 'CREDIT') mode = 'CASH';
    for (const l of lines) await reprice(l);       // VIP may change level-1 prices
  }

  async function pickItem(code) {
    picking = null;
    const found = lines.find(l => l.item_code === code);
    if (found) return changeQty(found, 1);
    const it = items.find(i => i.item_code === code);
    const l = { item_code: code, item_name: it.item_name, unit: it.unit, qty: 1, list: 0, price: 0, edited: false };
    await reprice(l);
    lines.push(l);
  }

  async function changeQty(l, step) {
    const q = Math.round((Number(l.qty) + step) * 1000) / 1000;
    if (q <= 0) {
      lines.splice(lines.indexOf(l), 1);
      return;
    }
    l.qty = q;
    await reprice(l);
  }

  async function typedQty(l, v) {
    const q = Number(v);
    if (q > 0) {
      l.qty = q;
      await reprice(l);
    }
  }

  function typedPrice(l, v) {
    const p = Number(v);
    if (p > 0) {
      l.price = p;
      l.edited = Math.abs(p - l.list) >= 0.005;
    }
  }

  function resetPrice(l) {
    l.price = l.list;
    l.edited = false;
  }

  function modeChanged(m) {
    if (m === 'CREDIT' && (!party || party.party_code === CASH)) picking = 'party';
  }

  async function save() {
    error = '';
    if (!lines.length) return (error = 'Add at least one item.');
    if (lines.some(l => !(l.price > 0))) return (error = 'Every item needs a price.');
    if (mode === 'CREDIT' && (!party || party.party_code === CASH)) return (error = 'Credit sale needs a customer.');
    busy = true;
    try {
      const entry = await saveEntry({
        entry_type: 'SALE',
        entry_date: today(),
        party_code: party?.party_code ?? CASH,
        party_name: party?.party_name ?? 'Cash Customer',
        title: party?.party_name ?? 'Cash Customer',
        payment_mode: mode,
        total,
        lines: lines.map(l => ({
          item_code: l.item_code, item_name: l.item_name, qty: l.qty,
          price_incl_vat: l.price, list_price_incl_vat: l.list, price_edited: l.edited
        }))
      });
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
    <h2>Sale</h2>
    <span style="width:44px"></span>
  </header>

  <button class="party" type="button" onclick={() => (picking = 'party')}>
    <span class="muted small">Customer</span>
    <span class="pname">{party?.party_name ?? 'Cash Customer'}{#if isVip}<span class="vip">VIP</span>{/if}</span>
  </button>

  <ModeChips bind:value={mode} modes={['CASH', 'BANK', 'DIGITAL', 'CREDIT']} onChange={modeChanged} />

  <section class="lines">
    {#each lines as l, i (l.item_code)}
      <div class="line">
        <div class="lname">
          <strong>{l.item_name}</strong>
          <button class="x" type="button" onclick={() => lines.splice(i, 1)} aria-label="Remove {l.item_name}">×</button>
        </div>
        <div class="lrow">
          <div class="qty">
            <button type="button" onclick={() => changeQty(l, -1)} aria-label="Less">−</button>
            <input inputmode="decimal" value={l.qty} onchange={(e) => typedQty(l, e.currentTarget.value)} aria-label="Quantity" />
            <button type="button" onclick={() => changeQty(l, 1)} aria-label="More">+</button>
          </div>
          <button class="price" class:edited={l.edited} type="button" onclick={() => (editing = editing === i ? null : i)}>
            @ {money(l.price)}
          </button>
          <div class="amt">{money(l.qty * l.price)}</div>
        </div>
        {#if editing === i}
          <div class="edit">
            <input inputmode="decimal" value={l.price} onchange={(e) => typedPrice(l, e.currentTarget.value)} aria-label="Price incl. VAT" />
            <span class="muted small">List {money(l.list)}</span>
            {#if l.edited}<button class="link small" type="button" onclick={() => resetPrice(l)}>Use list price</button>{/if}
          </div>
        {/if}
        {#if overTol(l)}<p class="flag">Price change above {tolerance}% — needs approval</p>{/if}
      </div>
    {/each}

    <button class="add" type="button" onclick={() => (picking = 'item')}>+ Add item</button>
  </section>

  {#if error}<p class="msg error">{error}</p>{/if}

  <footer class="footer">
    <div>
      <div class="muted small">Total incl. VAT</div>
      <div class="total">Rs {money(total)}</div>
    </div>
    <button class="primary" type="button" onclick={save} disabled={busy || !lines.length}>Save</button>
  </footer>
</main>

{#if picking === 'party'}
  <Picker title="Choose customer" placeholder="Name or code"
    rows={parties.map(p => ({ key: p.party_code, title: p.party_name, sub: p.party_code, badge: p.is_vip ? 'VIP' : '' }))}
    onPick={pickParty} onClose={() => (picking = null)} />
{:else if picking === 'item'}
  <Picker title="Add item" placeholder="Item name or code"
    rows={items.map(i => ({ key: i.item_code, title: i.item_name, sub: i.item_code + (i.unit ? ' · ' + i.unit : '') }))}
    favourites={favs.map(i => ({ key: i.item_code, title: i.item_name }))}
    onPick={pickItem} onClose={() => (picking = null)} />
{/if}

<style>
  .party {
    width: 100%; text-align: left; display: flex; flex-direction: column; gap: 2px;
    padding: 12px 14px; margin-bottom: 12px; border-radius: 14px;
    border: 1px solid var(--line); background: var(--card);
  }
  .pname { font-size: 17px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
  .vip { font-size: 11px; font-weight: 700; color: var(--brand); background: var(--brand-tint); border-radius: 8px; padding: 2px 6px; }
  .lines { margin-top: 16px; display: flex; flex-direction: column; gap: 10px; }
  .line { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 10px 12px; }
  .lname { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
  .x { border: 0; background: none; font-size: 22px; line-height: 1; color: var(--ink-2); padding: 0 4px; }
  .lrow { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
  .qty { display: flex; align-items: center; }
  .qty button {
    width: 40px; height: 40px; border-radius: 10px; border: 1px solid var(--line);
    background: var(--bg); font-size: 22px; font-weight: 600;
  }
  .qty input { width: 56px; height: 40px; text-align: center; padding: 0; margin: 0 4px; font-weight: 700; }
  .price { border: 0; background: none; color: var(--ink-2); font-size: 14px; padding: 6px 4px; text-decoration: underline dotted; }
  .price.edited { color: var(--warn); font-weight: 700; }
  .amt { margin-left: auto; font-weight: 700; }
  .edit { display: flex; align-items: center; gap: 10px; margin-top: 8px; flex-wrap: wrap; }
  .edit input { width: 120px; height: 44px; }
  .link.small { padding: 4px; margin: 0; font-size: 14px; }
  .flag { margin: 8px 0 0; font-size: 13px; color: var(--warn); font-weight: 600; }
  .add {
    height: 52px; border-radius: 14px; border: 2px dashed var(--brand);
    background: transparent; color: var(--brand); font-size: 16px; font-weight: 700;
  }
</style>
