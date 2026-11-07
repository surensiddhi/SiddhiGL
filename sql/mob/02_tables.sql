-- SiddhiGL Mobile — 02_tables.sql
-- All mobile tables. Run after 01_schema.sql.
-- Masters (items, prices, parties, accounts) stay in public and are NOT copied here.

-- Per-tenant mobile settings (photo_above_amount, pin_lock_minutes, idle_lock_minutes, temp_bill_footer)
-- Price edit tolerance is NOT here: it is read from public.company_config.rate_edit_tolerance_pct.
create table if not exists mob.settings (
  tenant_id  text not null,
  key        text not null,
  value      text,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, key)
);

-- Home screen tiles
create table if not exists mob.menu (
  tenant_id          text not null,
  code               text not null,
  label_en           text not null,
  label_np           text,
  icon               text,
  action             text not null check (action in
                       ('SALE','EXPENSE','RECEIPT','PAYMENT','PHOTO',
                        'MY_ENTRIES','PRICE_LIST','TODAY','DAY_CLOSE')),
  default_account_no text,
  roles              text[] not null default array['admin','manager','user'],
  sort_order         int not null default 100,
  active             boolean not null default true,
  updated_at         timestamptz not null default now(),
  primary key (tenant_id, code)
);

-- Expense picks (Tea, Fuel ...) mapped to ledgers
create table if not exists mob.expense_heads (
  tenant_id      text not null,
  code           text not null,
  label_en       text not null,
  label_np       text,
  account_no     text,
  photo_required boolean not null default false,
  sort_order     int not null default 100,
  active         boolean not null default true,
  updated_at     timestamptz not null default now(),
  primary key (tenant_id, code)
);

-- Registered phones
create table if not exists mob.devices (
  device_id     uuid primary key default gen_random_uuid(),
  tenant_id     text not null,
  username      text not null,
  device_name   text,
  device_code   text not null,          -- M01, M02 ... used in temp bill numbers
  secret_hash   text not null,          -- bcrypt of the device secret
  registered_at timestamptz not null default now(),
  last_seen     timestamptz,
  revoked       boolean not null default false,
  revoked_by    text,
  revoked_at    timestamptz,
  unique (tenant_id, device_code),
  foreign key (username, tenant_id) references public.users (username, tenant_id)
);

-- One PIN per user (works on all that user's phones)
create table if not exists mob.user_pins (
  tenant_id    text not null,
  username     text not null,
  pin_hash     text not null,
  failed_count int not null default 0,
  locked_until timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (tenant_id, username),
  foreign key (username, tenant_id) references public.users (username, tenant_id)
);

-- Temp bill numbering per phone
create table if not exists mob.temp_seq (
  device_id uuid primary key references mob.devices (device_id),
  last_no   int not null default 0
);

-- Parties quick-added on the phone (reviewer links or creates the real party)
create table if not exists mob.new_parties (
  id                uuid primary key,   -- made on the phone
  tenant_id         text not null,
  party_name        text not null,
  mobile            text,
  party_type        text not null default 'D',
  created_by        text not null,
  created_at        timestamptz not null default now(),
  linked_party_code text
);

-- Entries sent from the phone (drafts stay on the phone until sent)
create table if not exists mob.entries (
  entry_id       uuid primary key,      -- made on the phone: a resend never duplicates
  tenant_id      text not null,
  entry_type     text not null check (entry_type in ('SALE','EXPENSE','RECEIPT','PAYMENT','PHOTO')),
  entry_date     date not null,
  party_code     text,
  new_party_id   uuid references mob.new_parties (id),
  payment_mode   text check (payment_mode in ('CASH','BANK','DIGITAL','CREDIT')),
  total_incl_vat numeric(14,2) not null default 0,
  note           text,
  temp_no        text,
  status         text not null default 'SUBMITTED'
                   check (status in ('SUBMITTED','APPROVED','REJECTED')),
  username       text not null,
  device_id      uuid not null references mob.devices (device_id),
  created_at     timestamptz not null,  -- phone time
  received_at    timestamptz not null default now(),
  app_version    text,
  reviewed_by    text,
  reviewed_at    timestamptz,
  reject_reason  text,
  voucher_ref    text                   -- filled when approved and posted
);
create index if not exists entries_tenant_status on mob.entries (tenant_id, status, entry_date);

create table if not exists mob.entry_lines (
  entry_id            uuid not null references mob.entries (entry_id) on delete cascade,
  line_no             int not null,
  tenant_id           text not null,
  item_code           text,
  expense_head        text,
  qty                 numeric(14,3) not null default 1,
  price_incl_vat      numeric(14,4) not null default 0,
  list_price_incl_vat numeric(14,4),
  price_edited        boolean not null default false,
  amount_incl_vat     numeric(14,2) not null default 0,
  primary key (entry_id, line_no),
  check (item_code is not null or expense_head is not null)
);

create table if not exists mob.entry_photos (
  photo_id     uuid primary key,
  entry_id     uuid not null references mob.entries (entry_id) on delete cascade,
  tenant_id    text not null,
  storage_path text not null,
  size_kb      int,
  uploaded_at  timestamptz not null default now()
);
create index if not exists entry_photos_entry on mob.entry_photos (entry_id);

-- Lock every mob table: no direct access, only through mob functions
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'mob' loop
    execute format('alter table mob.%I enable row level security', t);
    execute format('revoke all on mob.%I from public, anon, authenticated', t);
  end loop;
end $$;
