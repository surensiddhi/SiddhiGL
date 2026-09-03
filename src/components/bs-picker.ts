/**
 * bs-picker.ts — Bikram Sambat calendar popup.
 * Attaches to a read-only <input>; stores value as ISO (YYYY-MM-DD) internally.
 *
 * Usage:
 *   const cleanup = attachBsPicker(inputEl, {
 *     value: '2082-04-15',       // initial ISO date (optional)
 *     onChange: (iso) => { ... } // called with 'YYYY-MM-DD' on pick
 *   });
 */

import {
  isoToBs, bsToIso, todayNep,
  daysInBsMonth, bsMonthStartDow, MONTH_NAMES,
} from '../lib/bs-calendar';

export interface BsPickerOptions {
  value?:    string;              // initial ISO date
  onChange:  (iso: string) => void;
}

/** Format a BS 'YYYY/MM/DD' string into display text 'YYYY-MM-DD'. */
function fmtBs(bs: string): string {
  return bs.replace(/\//g, '-');
}

export function attachBsPicker(input: HTMLInputElement, opts: BsPickerOptions): () => void {
  let currentIso = opts.value ?? '';
  let popup: HTMLElement | null = null;

  // ── Seed input display ────────────────────────────────────────────────────
  if (currentIso) {
    const bs = isoToBs(currentIso);
    if (bs) input.value = fmtBs(bs);
  }
  input.readOnly = true;
  input.style.cursor = 'pointer';

  // ── Popup rendering ───────────────────────────────────────────────────────

  function openPicker(): void {
    let viewBs: string;
    if (currentIso) {
      viewBs = isoToBs(currentIso) ?? todayNep();
    } else {
      viewBs = todayNep();
    }
    const [vy, vm] = viewBs.split('/').map(Number) as [number, number];
    renderPopup(vy, vm);
  }

  function renderPopup(viewY: number, viewM: number): void {
    closePopup();

    const rect   = input.getBoundingClientRect();
    const days   = daysInBsMonth(viewY, viewM);
    const startDow = bsMonthStartDow(viewY, viewM); // 0 = Sun

    // Which day is selected (if same Y/M)?
    let selDay = 0;
    if (currentIso) {
      const bs = isoToBs(currentIso);
      if (bs) {
        const [sy, sm, sd] = bs.split('/').map(Number) as [number, number, number];
        if (sy === viewY && sm === viewM) selDay = sd;
      }
    }

    popup = document.createElement('div');
    popup.className = 'bsp-popup';
    popup.style.cssText = `
      position:fixed;top:${rect.bottom + 4}px;left:${rect.left}px;
      width:272px;z-index:8100;
    `;

    // Header row
    const header = document.createElement('div');
    header.className = 'bsp-header';
    header.innerHTML = `
      <button class="bsp-nav" data-d="-1">&#8249;</button>
      <span class="bsp-title">${MONTH_NAMES[viewM - 1]} ${viewY}</span>
      <button class="bsp-nav" data-d="1">&#8250;</button>
    `;
    popup.appendChild(header);

    // Day-of-week row
    const dow = document.createElement('div');
    dow.className = 'bsp-dow';
    ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(d => {
      const cell = document.createElement('span');
      cell.textContent = d;
      dow.appendChild(cell);
    });
    popup.appendChild(dow);

    // Days grid
    const grid = document.createElement('div');
    grid.className = 'bsp-grid';

    for (let i = 0; i < startDow; i++) {
      grid.appendChild(document.createElement('span'));
    }

    for (let d = 1; d <= days; d++) {
      const btn = document.createElement('button');
      btn.textContent = String(d);
      btn.className = 'bsp-day' + (d === selDay ? ' selected' : '');
      btn.addEventListener('click', () => {
        const iso = bsToIso(`${viewY}/${String(viewM).padStart(2,'0')}/${String(d).padStart(2,'0')}`);
        if (!iso) return;
        currentIso = iso;
        const bs = isoToBs(iso);
        if (bs) input.value = fmtBs(bs);
        opts.onChange(iso);
        closePopup();
      });
      grid.appendChild(btn);
    }

    popup.appendChild(grid);

    // Nav button handlers
    popup.querySelectorAll<HTMLElement>('.bsp-nav').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const dir = parseInt(btn.dataset['d'] ?? '0');
        let ny = viewY, nm = viewM + dir;
        if (nm < 1)  { ny--; nm = 12; }
        if (nm > 12) { ny++; nm = 1;  }
        renderPopup(ny, nm);
      });
    });

    document.body.appendChild(popup);
  }

  function closePopup(): void {
    popup?.remove();
    popup = null;
  }

  // ── Document click to dismiss ─────────────────────────────────────────────

  function onDocClick(e: MouseEvent): void {
    if (popup && !popup.contains(e.target as Node) && e.target !== input) {
      closePopup();
    }
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      popup ? closePopup() : openPicker();
    }
    if (e.key === 'Escape') closePopup();
  }

  input.addEventListener('click',   openPicker);
  input.addEventListener('keydown', onKeydown);
  document.addEventListener('click', onDocClick);

  return () => {
    input.removeEventListener('click',   openPicker);
    input.removeEventListener('keydown', onKeydown);
    document.removeEventListener('click', onDocClick);
    closePopup();
  };
}
