// SiddhiGL Mobile — temporary bill text and sharing (Phase 4)
//
// Built only from what the phone saved, so it works offline.
// Always marked "Estimate / Provisional" until approved in SiddhiGL Online.

import { getMeta } from './db.js';
import { money } from './entries.js';

const TYPE = { SALE: 'SALE ESTIMATE', EXPENSE: 'EXPENSE', RECEIPT: 'RECEIPT', PAYMENT: 'PAYMENT', PHOTO: 'PHOTO BILL' };
const MODE = { CASH: 'Cash', BANK: 'Bank', DIGITAL: 'Digital', CREDIT: 'Credit' };

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
export const lineAmount = (l) => r2(Number(l.qty) * Number(l.price_incl_vat));

export function entryDate(e) {
  return new Date(e.created_at).toLocaleString('en-GB',
    { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// VAT inside a VAT-inclusive total
export function vatSplit(total, vatPct) {
  const t = r2(total);
  const taxable = r2(t / (1 + vatPct / 100));
  return { taxable, vat: r2(t - taxable), total: t };
}

export async function companyInfo() {
  const c = (await getMeta('company')) ?? {};
  return { name: c.name ?? '', vat_pct: Number(c.vat_pct ?? 13) };
}

// Plain text for WhatsApp / Viber. *bold* works in both.
export async function billText(e) {
  const c = await companyInfo();
  const out = [];
  if (c.name) out.push(`*${c.name}*`);
  out.push(`${TYPE[e.entry_type] ?? e.entry_type}${e.temp_no ? ' · ' + e.temp_no : ''}`);
  out.push(entryDate(e));
  if (e.party_name) out.push((e.entry_type === 'PAYMENT' ? 'To: ' : 'Customer: ') + e.party_name);
  out.push('------------------------------');

  if (e.entry_type === 'SALE') {
    (e.lines ?? []).forEach((l, i) => {
      out.push(`${i + 1}. ${l.item_name}`);
      out.push(`   ${l.qty} x ${money(l.price_incl_vat)} = ${money(lineAmount(l))}`);
    });
    const v = vatSplit(e.total, c.vat_pct);
    out.push('------------------------------');
    out.push(`Taxable: Rs ${money(v.taxable)}`);
    out.push(`VAT ${c.vat_pct}%: Rs ${money(v.vat)}`);
    out.push(`*Total: Rs ${money(v.total)}*`);
  } else {
    if (e.lines?.[0]?.head_name) out.push(e.lines[0].head_name);
    if (e.total) out.push(`*Amount: Rs ${money(e.total)}*`);
  }

  if (e.payment_mode) out.push(`Mode: ${MODE[e.payment_mode] ?? e.payment_mode}`);
  if (e.pay_ref) out.push(`Payment ref: ${e.pay_ref}`);
  if (e.note) out.push(`Note: ${e.note}`);
  out.push('');
  out.push(e.server_status === 'APPROVED'
    ? '_Approved. Tax invoice will follow._'
    : '_Estimate / Provisional. Not a tax invoice._');
  return out.join('\n');
}

// Phone share sheet first; WhatsApp link if the browser has no share sheet (desktop)
export async function shareText(text, title = 'Bill') {
  if (navigator.share) {
    try { await navigator.share({ title, text }); return 'shared'; }
    catch (err) { if (err?.name === 'AbortError') return 'cancelled'; }
  }
  try { await navigator.clipboard?.writeText(text); } catch { /* ignore */ }
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
  return 'whatsapp';
}

export async function copyText(text) {
  await navigator.clipboard.writeText(text);
}
