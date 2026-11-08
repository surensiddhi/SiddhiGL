<script>
  // Receipt (money received from a party) or Payment (money paid to a party)
  // Party -> amount -> Save. Cash by default. Photo of a cheque or slip is optional.
  import { onMount } from 'svelte';
  import { db } from '../lib/db.js';
  import { saveEntry, today, money } from '../lib/entries.js';
  import Icon from '../components/Icon.svelte';
  import Picker from '../components/Picker.svelte';
  import ModeChips from '../components/ModeChips.svelte';
  import PhotoField from '../components/PhotoField.svelte';
  import DigitalPay from '../components/DigitalPay.svelte';

  let { type, onBack, onSaved } = $props();   // type: 'RECEIPT' | 'PAYMENT'

  const isReceipt = type === 'RECEIPT';
  const mainType = isReceipt ? 'D' : 'C';      // customers first for receipts, suppliers for payments

  let parties = $state([]);
  let party = $state(null);
  let picking = $state(true);                  // open the party list straight away
  let amount = $state('');
  let mode = $state('CASH');
  let note = $state('');
  let payRef = $state('');
  let photos = $state([]);
  let busy = $state(false);
  let error = $state('');

  const value = $derived(Number(amount) || 0);

  onMount(async () => {
    parties = (await db.parties.toArray())
      .filter(p => p.party_code !== 'CASH')
      .sort((a, b) => (a.party_type === mainType ? 0 : 1) - (b.party_type === mainType ? 0 : 1)
                      || a.party_name.localeCompare(b.party_name));
  });

  function pick(code) {
    party = parties.find(p => p.party_code === code);
    picking = false;
  }

  async function save() {
    error = '';
    if (!party) return (error = isReceipt ? 'Choose who paid you.' : 'Choose who you paid.');
    if (!(value > 0)) return (error = 'Enter the amount.');
    busy = true;
    try {
      const entry = await saveEntry({
        entry_type: type,
        entry_date: today(),
        party_code: party.party_code,
        party_name: party.party_name,
        title: (isReceipt ? 'From ' : 'To ') + party.party_name,
        payment_mode: mode,
        pay_ref: mode === 'DIGITAL' ? payRef.trim() || null : null,
        amount: value,
        total: value,
        note: note.trim() || null
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
    <h2>{isReceipt ? 'Receipt' : 'Payment'}</h2>
    <span style="width:44px"></span>
  </header>

  <button class="party" type="button" onclick={() => (picking = true)}>
    <span class="muted small">{isReceipt ? 'Received from' : 'Paid to'}</span>
    <span class="pname">{party?.party_name ?? 'Tap to choose'}</span>
  </button>

  <label class="amount">
    Amount (Rs)
    <input bind:value={amount} inputmode="decimal" placeholder="0" />
  </label>

  <div class="block"><ModeChips bind:value={mode} /></div>
  {#if isReceipt && mode === 'DIGITAL'}<DigitalPay amount={value} bind:payRef />{/if}

  <label class="block">
    Note (optional)
    <input bind:value={note} maxlength="300" placeholder={mode === 'BANK' ? 'e.g. cheque no. 123456' : ''} />
  </label>

  <div class="block">
    <PhotoField bind:photos label="Cheque or slip photo" hint={mode === 'BANK' && !photos.length ? 'Recommended for bank' : ''} />
  </div>

  {#if error}<p class="msg error">{error}</p>{/if}

  <footer class="footer">
    <div>
      <div class="muted small">{isReceipt ? 'Received' : 'Paid'}</div>
      <div class="total">Rs {money(value)}</div>
    </div>
    <button class="primary" type="button" onclick={save} disabled={busy || !party || !(value > 0)}>Save</button>
  </footer>
</main>

{#if picking}
  <Picker title={isReceipt ? 'Received from' : 'Paid to'} placeholder="Name or code"
    rows={parties.map(p => ({ key: p.party_code, title: p.party_name, sub: p.party_code,
                              badge: p.party_type === 'D' ? 'Customer' : 'Supplier' }))}
    onPick={pick} onClose={() => (picking = false)} />
{/if}

<style>
  .party {
    width: 100%; text-align: left; display: flex; flex-direction: column; gap: 2px;
    padding: 12px 14px; border-radius: 14px; border: 1px solid var(--line); background: var(--card);
  }
  .pname { font-size: 17px; font-weight: 700; }
  .amount { margin-top: 16px; }
  .amount input { height: 64px; font-size: 30px; font-weight: 700; }
  .block { margin-top: 14px; }
</style>
