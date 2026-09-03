/**
 * lookup-overlay.ts
 * Attaches a typeahead dropdown to any <input>.
 * - clientCache lookups: load once, filter in-memory
 * - server-search lookups: debounce 300 ms then call lookupData()
 *
 * Usage:
 *   const cleanup = attachLookup(inputEl, {
 *     configName: 'accounts',
 *     onSelect: (row) => { ... },
 *   });
 *   // call cleanup() when the view is destroyed
 */

import { lookupData } from '../services/lookup';
import type { LookupRow } from '../types';

export interface LookupOptions {
  configName:     string;
  runtimeFilter?: string;   // e.g. 'control_account_no=eq.10005'
  onSelect:       (row: LookupRow) => void;
  onClear?:       () => void;
}

export function attachLookup(input: HTMLInputElement, opts: LookupOptions): () => void {
  let dropdown:   HTMLElement | null = null;
  let timer:      ReturnType<typeof setTimeout> | null = null;
  let allRows:    LookupRow[] = [];
  let fromCache = false;
  let loaded    = false;

  // ── Dropdown rendering ────────────────────────────────────────────────────

  function showRows(rows: LookupRow[]): void {
    closeDropdown();
    if (!rows.length) return;

    dropdown = document.createElement('div');
    dropdown.className = 'lookup-dropdown';

    const rect = input.getBoundingClientRect();
    Object.assign(dropdown.style, {
      position:  'fixed',
      top:       `${rect.bottom + 2}px`,
      left:      `${rect.left}px`,
      width:     `${Math.max(rect.width, 300)}px`,
      maxHeight: '240px',
      overflowY: 'auto',
      zIndex:    '8000',
    });

    rows.slice(0, 80).forEach(row => {
      const item = document.createElement('div');
      item.className = 'lookup-item';
      item.textContent = row.label;
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        input.value = row.label;
        opts.onSelect(row);
        closeDropdown();
      });
      dropdown!.appendChild(item);
    });

    document.body.appendChild(dropdown);
  }

  function closeDropdown(): void {
    dropdown?.remove();
    dropdown = null;
  }

  // ── Filtering ─────────────────────────────────────────────────────────────

  function filterAndShow(term: string): void {
    const lc = term.toLowerCase();
    const hits = term
      ? allRows.filter(r => r.label.toLowerCase().includes(lc))
      : allRows;
    showRows(hits);
  }

  async function fetchAndShow(term: string): Promise<void> {
    try {
      const result = await lookupData(opts.configName, term, opts.runtimeFilter ?? '');
      fromCache  = result.clientCache;
      allRows    = result.rows;
      loaded     = true;
      showRows(result.rows);
    } catch (err) {
      console.error('Lookup error:', err);
    }
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  async function onFocus(): Promise<void> {
    if (loaded && fromCache) {
      filterAndShow(input.value.trim());
    } else {
      await fetchAndShow('');
    }
  }

  function onInput(): void {
    const term = input.value.trim();

    if (loaded && fromCache) {
      filterAndShow(term);
      return;
    }

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fetchAndShow(term), 300);
  }

  function onBlur(): void {
    setTimeout(closeDropdown, 160);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (!dropdown) return;
    const items = Array.from(dropdown.querySelectorAll<HTMLElement>('.lookup-item'));
    const active = dropdown.querySelector<HTMLElement>('.lookup-item.focus');
    let idx = active ? items.indexOf(active) : -1;

    if (e.key === 'ArrowDown')  { e.preventDefault(); idx = Math.min(idx + 1, items.length - 1); }
    if (e.key === 'ArrowUp')    { e.preventDefault(); idx = Math.max(idx - 1, 0); }
    if (e.key === 'Escape')     { closeDropdown(); return; }
    if (e.key === 'Enter' && active) {
      e.preventDefault();
      active.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      return;
    }

    items.forEach((el, i) => el.classList.toggle('focus', i === idx));
    items[idx]?.scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('focus',   onFocus);
  input.addEventListener('input',   onInput);
  input.addEventListener('blur',    onBlur);
  input.addEventListener('keydown', onKeydown);

  return () => {
    input.removeEventListener('focus',   onFocus);
    input.removeEventListener('input',   onInput);
    input.removeEventListener('blur',    onBlur);
    input.removeEventListener('keydown', onKeydown);
    closeDropdown();
    if (timer) clearTimeout(timer);
  };
}
