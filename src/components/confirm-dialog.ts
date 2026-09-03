/**
 * confirm-dialog.ts
 * Async confirm dialog — replaces the GAS uiConfirm() pattern.
 * Usage: const ok = await confirmDialog('Delete this record?');
 */

export function confirmDialog(message: string, title = 'Confirm'): Promise<boolean> {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,.4);
      display:flex;align-items:center;justify-content:center;z-index:9999
    `;
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:10px;padding:28px 32px;max-width:380px;width:95vw;box-shadow:0 20px 60px rgba(0,0,0,.2)">
        <h3 style="margin-bottom:12px;font-size:1rem">${title}</h3>
        <p style="color:#78716C;margin-bottom:24px;font-size:0.875rem">${message}</p>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button id="cd-cancel" class="btn btn-secondary">Cancel</button>
          <button id="cd-ok" class="btn btn-primary">OK</button>
        </div>
      </div>
    `;

    const close = (result: boolean) => {
      overlay.remove();
      resolve(result);
    };

    overlay.querySelector('#cd-ok')!.addEventListener('click', () => close(true));
    overlay.querySelector('#cd-cancel')!.addEventListener('click', () => close(false));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });

    document.body.appendChild(overlay);
    (overlay.querySelector('#cd-ok') as HTMLElement).focus();
  });
}
