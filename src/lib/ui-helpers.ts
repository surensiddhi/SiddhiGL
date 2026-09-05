/**
 * ui-helpers.ts — Small shared DOM/formatting helpers.
 *
 * Extracted from voucher-form.ts / pv-rv.ts, which used to each declare
 * identical local copies of these functions. Having the same function
 * names independently declared in two separately-chunked (lazy-loaded)
 * route modules triggered a Rollup/Vite chunk-splitting bug: "Cannot
 * access '<var>' before initialization" (a circular-chunk TDZ error),
 * which silently aborted the rest of buildView() before button click
 * handlers (e.g. "+ Add Line") were wired up.
 *
 * Fix: declare these once, here, and import from both views instead of
 * duplicating them. Do not re-add local copies of these in view files.
 */

import { isoToBs } from './bs-calendar';

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function toBS(iso: string): string {
  const bs = isoToBs(iso);
  return bs ? bs.replace(/\//g, '-') : '';
}

export function fmt(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function escAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function q<T extends Element>(el: HTMLElement, sel: string): T {
  return el.querySelector<T>(sel)!;
}
