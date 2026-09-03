# SiddhiGL — Session Status Report
*Last updated: 2026-08-29*

---

## Stack
- Vite + Vanilla TypeScript SPA, hash-based router
- Cloudflare Worker proxy (`siddhigl-proxy`) — browser → Worker → Supabase RPC
- Supabase project `gxejyhandboeqyeswcba` (ap-southeast-1), shared with mGL Lite
- Custom Postgres auth: `login_verify` / `change_password` RPCs
- Device folder: `D:\Projects\SiddhiGL\`

## Security Rules (non-negotiable)
- `lite_` prefixed DB functions must NEVER be modified
- `siddhigl-proxy` Worker must NOT conflict with `mgl-proxy`
- Supabase `service_role` key lives ONLY in Cloudflare Worker secrets, never in browser

---

## Completed Views

| View | File | Notes |
|---|---|---|
| Login | `views/login.ts` | Custom Postgres auth |
| Account Type | `views/account-type.ts` | Tree, collapsible, +Child, filter |
| Account Master | `views/account-master.ts` | CRUD, posting-level types only, single open balance |
| Cost Centre | `views/cost-centre.ts` | No delete (DB has no delete fn), activate/deactivate toggle |
| Party Master | `views/party-master.ts` | Composite key (code+type), control account lookup |
| Transaction List | `views/voucher-list.ts` | 3 tabs (New/Approved/All), search, 3-stage status flow |

## Completed Infrastructure

| File | Notes |
|---|---|
| `lib/perm.ts` | **Bug fixed** — `hasRank` now uses `roleLevel(s)` not `s.role` (was always returning false) |
| `lib/session.ts` | Session, ctx(), login, logout, changePassword |
| `lib/rpc.ts` | Browser → Worker proxy |
| `lib/bs-calendar.ts` | ISO → BS date conversion |
| `services/voucher.ts` | Corrected to `lk_voucher_list`, real DB signatures |
| `services/party.ts` | list, save, delete, nextCode |
| `services/cost-centre.ts` | ccList, ccSave, ccSetActive |
| `components/confirm-dialog.ts` | Reusable confirm modal |

---

## Verified DB Function Signatures (key ones)

```
lk_voucher_list(p_tenant, p_caller, p_status?)
  → {id, voucher_no, voucher_date, tran_type, description, status}
  status values: 'unapproved' | 'approved' | 'posted'

approve_voucher(p_head_id, p_tenant, p_caller)
unapprove_voucher(p_head_id, p_tenant, p_caller)
post_many(p_ids bigint[], p_posted_by text)   -- no p_tenant!

list_parties(p_party_type, p_tenant, p_caller, p_status, p_term)
save_party(p_tenant, p_caller, p_party_type, p_party_code, p_party_name,
           p_control_account_no, p_address, p_mobile, p_email,
           p_tax_number, p_tax_type, p_active, p_orig_code)

cc_list(p_include_inactive, p_tenant, p_caller)
cc_save(p_tenant, p_caller, p_code, p_name, p_active)
cc_set_active(p_tenant, p_caller, p_code, p_active)
```

---

## To Do (Next Sessions)

### High Priority
- [ ] **Voucher Form** (`views/voucher-form.ts`) — entry form for JV/PV/RV/CV/SV/PUR
  - DB: `get_voucher`, `save_voucher(payload jsonb)`, `next_voucher_no(p_tenant, p_tran_type, p_vdate)`
  - Line items: account lookup, party lookup, cost centre, Dr/Cr amounts
  - Edit mode: `#voucher-form?head_id=X` (already linked from voucher list)
- [ ] **Router** — confirm `#voucher-form?head_id=X` query param is parsed and passed to form init

### Medium Priority
- [ ] **Reports** (read-only views, likely use existing GAS RPC functions)
  - Trial Balance
  - Ledger (account statement)
  - Day Book
  - Profit & Loss
  - Balance Sheet
  - Party Aging
- [ ] **Users & Roles** (`views/users.ts`) — admin only
- [ ] **Company Config / Settings** (`views/company-config.ts`) — admin only

### Infrastructure
- [ ] **Git setup** — initialise repo, `.gitignore` (exclude `.env*`, `node_modules`)
- [ ] **Cloudflare Pages deployment** — connect repo, set build command `npm run build`, dist dir `dist`
- [ ] **Environment config** — confirm `VITE_WORKER_URL` set correctly for prod vs dev

### Pattern Reminders for Next Session
- Always query DB for actual function signatures before coding (`pg_get_function_arguments` / `pg_get_functiondef`)
- File push flow: Write locally → SendUserFile (get uuid) → device_commit_files to `D:\Projects\SiddhiGL\`
- `ctx()` returns `{ p_tenant, p_caller }` — spread into every RPC except `post_many` (no tenant)
- Role levels: viewer=1, user=2, manager=3, admin=4
