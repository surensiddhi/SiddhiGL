/** dashboard.ts — Landing / home screen. Shows SiddhiGL branding. */

import { getSession } from '../lib/session';

export function init(el: HTMLElement): void {
  const s = getSession();
  const company = s?.company_name ?? s?.tenant_name ?? '';

  el.innerHTML = `
    <div style="
      display:flex;flex-direction:column;
      align-items:center;justify-content:center;
      height:100%;min-height:60vh;
      text-align:center;user-select:none;
    ">
      <div style="margin-bottom:32px">
        <div style="font-size:2.8rem;font-weight:900;letter-spacing:-.03em;line-height:1">
          Siddhi<span style="color:#0284C7">GL</span>
        </div>
        <div style="font-size:0.85rem;color:#78716C;margin-top:8px;letter-spacing:.04em">
          Version 1.0
        </div>
      </div>

      <div style="
        border-top:1px solid #E7E5E4;
        padding-top:24px;width:260px;
        color:#A8A29E;font-size:0.8rem;line-height:2;
      ">
        ${company ? `<div style="font-weight:600;color:#57534E">${company}</div>` : ''}
        <div>Developed by <strong style="color:#57534E">Surendra Siddhi Bajracharya</strong></div>
      </div>
    </div>
  `;
}
