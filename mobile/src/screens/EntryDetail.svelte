<script>
  // Entry detail + temporary bill (Phase 4). Opened from My Entries or the Saved screen.
  import { onMount, onDestroy } from 'svelte';
  import { db } from '../lib/db.js';
  import { money } from '../lib/entries.js';
  import { billText, shareText, copyText, companyInfo, vatSplit, lineAmount, entryDate } from '../lib/share.js';
  import Icon from '../components/Icon.svelte';
  import PayQR from '../components/PayQR.svelte';

  let { entry, onBack } = $props();

  let company = $state({ name: '', vat_pct: 13 });
  let photos = $state([]);          // { photo_id, url, status }
  let msg = $state('');
  let busy = $state(false);
  let showQr = $state(false);
  const canQr = ['SALE', 'RECEIPT'].includes(entry.entry_type) && entry.payment_mode === 'DIGITAL'
                && entry.server_status !== 'APPROVED';

  const TYPE = { SALE: 'Sale estimate', EXPENSE: 'Expense', RECEIPT: 'Receipt', PAYMENT: 'Payment', PHOTO: 'Photo bill' };
  const MODE = { CASH: 'Cash', BANK: 'Bank', DIGITAL: 'Digital', CREDIT: 'Credit' };
  const isSale = entry.entry_type === 'SALE';
  const v = $derived(vatSplit(entry.total, company.vat_pct));

  function status(e) {
    if (e.status === 'PENDING') return { text: 'Waiting to send', cls: 'warn' };
    if (e.status === 'FAILED') return { text: 'Not accepted', cls: 'error' };
    if (e.server_status === 'APPROVED') return { text: 'Approved', cls: 'ok' };
    if (e.server_status === 'REJECTED') return { text: 'Rejected', cls: 'error' };
    return { text: 'Sent for review', cls: 'info' };
  }
  const st = status(entry);

  onMount(async () => {
    company = await companyInfo();
    // Photos still on this phone. Sent photos are cleared to save space.
    const rows = await db.photos.where('entry_id').equals(entry.entry_id).toArray();
    photos = rows.map(p => ({ photo_id: p.photo_id, status: p.status, url: p.blob ? URL.createObjectURL(p.blob) : null }));
  });

  onDestroy(() => photos.forEach(p => p.url && URL.revokeObjectURL(p.url)));

  async function share() {
    busy = true; msg = '';
    try {
      const r = await shareText(await billText(entry), entry.temp_no ?? 'Bill');
      if (r === 'whatsapp') msg = 'Opened WhatsApp. Text is also copied.';
    } finally { busy = false; }
  }

  async function copy() {
    try { await copyText(await billText(entry)); msg = 'Copied.'; }
    catch { msg = 'Could not copy on this phone.'; }
  }

  const sentPhotos = $derived(photos.filter(p => !p.url).length);
</script>

<main class="screen">
  <header class="topbar">
    <button class="icon-btn" type="button" onclick={onBack} aria-label="Back"><Icon name="back" size={24} /></button>
    <h2>{TYPE[entry.entry_type] ?? 'Entry'}</h2>
    <span class="badge {st.cls}">{st.text}</span>
  </header>

  <section class="bill">
    {#if company.name}<div class="co">{company.name}</div>{/if}
    <div class="meta">
      <span>{entry.temp_no ?? ''}</span>
      <span>{entryDate(entry)}</span>
    </div>
    {#if entry.party_name}
      <div class="party">{entry.entry_type === 'PAYMENT' ? 'To' : 'Customer'}: <strong>{entry.party_name}</strong></div>
    {/if}

    {#if isSale}
      <table>
        <thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Amount</th></tr></thead>
        <tbody>
          {#each entry.lines ?? [] as l (l.item_code)}
            <tr>
              <td>{l.item_name}{#if l.price_edited}<span class="ed">edited</span>{/if}</td>
              <td class="n">{l.qty}</td>
              <td class="n">{money(l.price_incl_vat)}</td>
              <td class="n">{money(lineAmount(l))}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      <div class="sum"><span>Taxable</span><span>{money(v.taxable)}</span></div>
      <div class="sum"><span>VAT {company.vat_pct}%</span><span>{money(v.vat)}</span></div>
      <div class="sum total"><span>Total</span><span>Rs {money(v.total)}</span></div>
    {:else}
      {#if entry.lines?.[0]?.head_name}<div class="head">{entry.lines[0].head_name}</div>{/if}
      {#if entry.total}<div class="sum total"><span>Amount</span><span>Rs {money(entry.total)}</span></div>{/if}
    {/if}

    {#if entry.payment_mode}<div class="line">Mode: {MODE[entry.payment_mode] ?? entry.payment_mode}</div>{/if}
    {#if entry.pay_ref}<div class="line">Payment ref: {entry.pay_ref}</div>{/if}
    {#if entry.note}<div class="line">Note: {entry.note}</div>{/if}
    <p class="stamp">
      {entry.server_status === 'APPROVED' ? 'Approved. Tax invoice will follow.' : 'Estimate / Provisional. Not a tax invoice.'}
    </p>
  </section>

  {#if entry.price_flag}<p class="note warn">Price change needs approval.</p>{/if}
  {#if entry.server_total != null && Math.abs(entry.server_total - entry.total) > 0.01}
    <p class="note warn">Server total is Rs {money(entry.server_total)}. The server's price is used.</p>
  {/if}
  {#if entry.status === 'FAILED'}<p class="note error">{entry.error}</p>{/if}
  {#if entry.server_status === 'REJECTED' && entry.reject_reason}<p class="note error">Reason: {entry.reject_reason}</p>{/if}

  {#if photos.length}
    <div class="photos">
      {#each photos.filter(p => p.url) as p (p.photo_id)}
        <img src={p.url} alt="Bill" />
      {/each}
    </div>
    {#if sentPhotos}<p class="muted small">{sentPhotos} photo{sentPhotos === 1 ? '' : 's'} sent to the office.</p>{/if}
  {/if}

  {#if canQr}
    <button class="qrbtn" type="button" onclick={() => (showQr = true)}><Icon name="qr" size={22} /> Show payment QR</button>
  {/if}

  <div class="acts">
    <button class="primary" type="button" onclick={share} disabled={busy}>Share</button>
    <button class="ghost" type="button" onclick={copy}>Copy</button>
  </div>
  {#if msg}<p class="muted small center">{msg}</p>{/if}
</main>

{#if showQr}<PayQR amount={entry.total} onClose={() => (showQr = false)} />{/if}

<style>
  .topbar .badge { margin-left: auto; }
  .badge { font-size: 12px; font-weight: 700; border-radius: 10px; padding: 3px 8px; white-space: nowrap; }
  .badge.warn { background: var(--warn-bg); color: var(--warn); }
  .badge.error { background: var(--error-bg); color: var(--error); }
  .badge.ok { background: var(--brand-tint); color: var(--brand); }
  .badge.info { background: var(--bg); color: var(--ink-2); border: 1px solid var(--line); }

  .bill {
    margin-top: 16px; background: var(--card); border: 1px solid var(--line);
    border-radius: 14px; padding: 16px;
  }
  .co { font-size: 18px; font-weight: 800; text-align: center; }
  .meta { display: flex; justify-content: space-between; color: var(--ink-2); font-size: 13px; margin: 8px 0; }
  .party, .head, .line { margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 14px; }
  th { text-align: left; color: var(--ink-2); font-weight: 600; font-size: 12px; border-bottom: 1px solid var(--line); padding: 4px 0; }
  td { padding: 6px 0; border-bottom: 1px dashed var(--line); vertical-align: top; }
  .n { text-align: right; padding-left: 8px; white-space: nowrap; }
  .ed { margin-left: 6px; font-size: 11px; color: var(--warn); }
  .sum { display: flex; justify-content: space-between; padding: 3px 0; font-size: 14px; }
  .sum.total { font-size: 18px; font-weight: 800; border-top: 1px solid var(--line); margin-top: 6px; padding-top: 8px; }
  .stamp { margin: 14px 0 0; text-align: center; font-size: 12px; font-weight: 700; color: var(--warn); }

  .note { margin: 10px 0 0; font-size: 13px; font-weight: 600; }
  .note.warn { color: var(--warn); }
  .note.error { color: var(--error); }

  .photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 14px; }
  .photos img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 10px; border: 1px solid var(--line); }

  .qrbtn {
    width: 100%; height: 52px; margin-top: 16px; border-radius: 14px; border: 1px solid var(--brand);
    background: var(--brand-tint); color: var(--brand); font-weight: 700; font-size: 16px;
    display: flex; align-items: center; justify-content: center; gap: 8px;
  }
  .acts { display: flex; gap: 10px; margin-top: 18px; }
  .acts .primary { flex: 2; margin: 0; }
  .ghost { flex: 1; height: 56px; border-radius: 14px; border: 1px solid var(--line); background: var(--card); font-weight: 700; }
  .center { text-align: center; }
</style>
