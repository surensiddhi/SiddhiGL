-- SiddhiGL Mobile — 09_photos_receipts.sql (Phase 3: photos, Receipt, Payment, Photo Bill)
-- Run after 07 and 08. Run part 1 as one block, then each $function$ block ONE AT A TIME,
-- then the GRANTS block.
--
--   Photos go to a PRIVATE storage bucket "mob-photos", path <tenant>/<entry_id>/<photo_id>.jpg
--   The phone never talks to storage: it sends the photo to the Worker, which uploads it
--   and then calls mob.add_photo to record it.


-- ===== 1. Private photo bucket (2 MB max, JPEG/WebP only) =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mob-photos', 'mob-photos', false, 2097152, array['image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- The Worker uploads with its server key. It may add new photos to this bucket only
-- (no reading, changing or deleting from here).
drop policy if exists "mob photos insert" on storage.objects;
create policy "mob photos insert" on storage.objects
  for insert to anon
  with check (bucket_id = 'mob-photos');


-- ===== 2. Receive one entry (now also RECEIPT, PAYMENT and PHOTO) =====
-- SALE / EXPENSE work exactly as in 07. New:
--   RECEIPT  money received from a party   (party + amount, Cash/Bank/Digital)
--   PAYMENT  money paid to a party         (party + amount, Cash/Bank/Digital)
--   PHOTO    photo of a paper bill only; our team enters it from the photo
--            (note and amount optional; photos arrive just after)
create or replace function mob.submit_entry(
  p_tenant text, p_caller text, p_device_id uuid, p_entry jsonb)
returns jsonb
language plpgsql security definer
set search_path = mob, public
as $function$
declare
  v_dev    mob.devices;
  v_id     uuid;
  v_type   text;
  v_date   date;
  v_mode   text;
  v_party  text;
  v_vip    boolean := false;
  v_ptype  text;
  v_tol    numeric;
  v_lock   date;
  v_line   jsonb;
  v_no     int := 0;
  v_item   text;
  v_head   text;
  v_qty    numeric;
  v_price  numeric;
  v_list   numeric;
  v_edit   boolean;
  v_flag   boolean := false;
  v_total  numeric := 0;
  v_old    mob.entries;
begin
  perform public._set_tenant(p_tenant, p_caller);

  select d.* into v_dev from mob.devices d
   where d.device_id = p_device_id and d.tenant_id = p_tenant and d.username = p_caller;
  if not found then
    raise exception 'This phone is not registered. Please log in with your password.';
  end if;
  if v_dev.revoked then
    raise exception 'This phone has been blocked. Contact your administrator.';
  end if;

  v_id := (p_entry ->> 'entry_id')::uuid;
  if v_id is null then
    raise exception 'Entry id is missing';
  end if;

  -- Sent before (phone retried): answer the same, never insert twice
  select e.* into v_old from mob.entries e where e.entry_id = v_id;
  if found then
    if v_old.tenant_id <> p_tenant then
      raise exception 'Entry id already used';
    end if;
    return jsonb_build_object('ok', true, 'entry_id', v_old.entry_id, 'status', v_old.status,
                              'total', v_old.total_incl_vat, 'price_flag', v_old.price_flag,
                              'duplicate', true);
  end if;

  v_type := upper(coalesce(p_entry ->> 'entry_type', ''));
  if v_type not in ('SALE', 'EXPENSE', 'RECEIPT', 'PAYMENT', 'PHOTO') then
    raise exception 'Entry type % is not supported', v_type;
  end if;

  v_date := coalesce((p_entry ->> 'entry_date')::date, current_date);
  if v_date > current_date + 1 then
    raise exception 'Date % is in the future', v_date;
  end if;
  select cc.lock_date, coalesce(cc.rate_edit_tolerance_pct, 0)
    into v_lock, v_tol
    from public.company_config cc where cc.tenant_id = p_tenant;
  if v_lock is not null and v_date <= v_lock then
    raise exception 'Books are locked up to %. Choose a later date.', v_lock;
  end if;

  if v_type in ('SALE', 'EXPENSE')
     and (jsonb_typeof(p_entry -> 'lines') is distinct from 'array'
          or jsonb_array_length(p_entry -> 'lines') = 0) then
    raise exception 'Add at least one line';
  end if;

  v_mode  := upper(coalesce(nullif(p_entry ->> 'payment_mode', ''), 'CASH'));
  v_party := nullif(trim(p_entry ->> 'party_code'), '');

  if v_type = 'SALE' then
    if v_mode not in ('CASH', 'BANK', 'DIGITAL', 'CREDIT') then
      raise exception 'Payment mode % is not valid', v_mode;
    end if;
    v_party := coalesce(v_party, 'CASH');
  elsif v_type = 'PHOTO' then
    v_mode := nullif(v_mode, 'CASH');          -- not known from a photo; reviewer decides
    if v_mode is not null and v_mode not in ('BANK', 'DIGITAL', 'CREDIT') then
      v_mode := null;
    end if;
  else
    if v_mode not in ('CASH', 'BANK', 'DIGITAL') then
      raise exception 'Payment mode % is not valid here', v_mode;
    end if;
  end if;

  if v_type in ('RECEIPT', 'PAYMENT') and v_party is null then
    raise exception 'Choose who the money was %.',
      case v_type when 'RECEIPT' then 'received from' else 'paid to' end;
  end if;

  if v_party is not null then
    select p.is_vip, p.party_type into v_vip, v_ptype
      from mob.v_parties p where p.party_code = v_party;
    if not found then
      raise exception 'Party % not found', v_party;
    end if;
  end if;

  if v_type = 'SALE' and v_mode = 'CREDIT' and (v_party = 'CASH' or v_ptype <> 'D') then
    raise exception 'Credit sale needs a customer. Pick the customer first.';
  end if;

  insert into mob.entries (entry_id, tenant_id, entry_type, entry_date, party_code, payment_mode,
                           note, temp_no, status, username, device_id, created_at, app_version)
  values (v_id, p_tenant, v_type, v_date, v_party, v_mode,
          left(nullif(trim(p_entry ->> 'note'), ''), 300),
          nullif(p_entry ->> 'temp_no', ''), 'SUBMITTED', p_caller, p_device_id,
          coalesce((p_entry ->> 'created_at')::timestamptz, now()),
          left(p_entry ->> 'app_version', 20));

  if v_type in ('SALE', 'EXPENSE') then
    for v_line in select * from jsonb_array_elements(p_entry -> 'lines') loop
      v_no := v_no + 1;

      if v_type = 'SALE' then
        v_item := v_line ->> 'item_code';
        if not exists (select 1 from mob.v_items i where i.item_code = v_item) then
          raise exception 'Line %: item % not found or not active', v_no, v_item;
        end if;
        v_qty := (v_line ->> 'qty')::numeric;
        if v_qty is null or v_qty <= 0 then
          raise exception 'Line %: quantity must be more than 0', v_no;
        end if;
        v_list  := coalesce(mob._list_price(v_item, v_qty, v_vip), 0);
        v_price := coalesce((v_line ->> 'price_incl_vat')::numeric, v_list);
        if v_price <= 0 then
          raise exception 'Line %: item % has no price. Enter a price.', v_no, v_item;
        end if;
        v_edit := abs(v_price - v_list) >= 0.005;
        if v_edit and (v_list = 0 or abs(v_price - v_list) / v_list * 100 > v_tol) then
          v_flag := true;
        end if;
        v_head := null;
      else
        v_head := v_line ->> 'expense_head';
        if not exists (select 1 from mob.expense_heads e
                        where e.tenant_id = p_tenant and e.code = v_head and e.active) then
          raise exception 'Line %: expense head % not found', v_no, v_head;
        end if;
        v_qty   := 1;
        v_price := (v_line ->> 'price_incl_vat')::numeric;
        if v_price is null or v_price <= 0 then
          raise exception 'Enter the expense amount';
        end if;
        v_list := null;
        v_edit := false;
        v_item := null;
      end if;

      insert into mob.entry_lines (entry_id, line_no, tenant_id, item_code, expense_head, qty,
                                   price_incl_vat, list_price_incl_vat, price_edited, amount_incl_vat)
      values (v_id, v_no, p_tenant, v_item, v_head, v_qty,
              v_price, v_list, v_edit, round(v_qty * v_price, 2));

      v_total := v_total + round(v_qty * v_price, 2);
    end loop;
  else
    -- RECEIPT / PAYMENT / PHOTO: one amount, no lines
    v_total := round(coalesce((p_entry ->> 'amount')::numeric, 0), 2);
    if v_type in ('RECEIPT', 'PAYMENT') and v_total <= 0 then
      raise exception 'Enter the amount';
    end if;
    if v_total < 0 then
      raise exception 'Amount cannot be negative';
    end if;
  end if;

  update mob.entries e
     set total_incl_vat = v_total, price_flag = v_flag,
         vip_applied = (v_type = 'SALE' and v_vip)
   where e.entry_id = v_id;

  update mob.devices d set last_seen = now() where d.device_id = p_device_id;

  return jsonb_build_object('ok', true, 'entry_id', v_id, 'status', 'SUBMITTED',
                            'total', v_total, 'price_flag', v_flag, 'duplicate', false);
end $function$;


-- ===== 3. Record a photo the Worker has just uploaded =====
create or replace function mob.add_photo(
  p_tenant text, p_caller text, p_device_id uuid,
  p_entry_id uuid, p_photo_id uuid, p_path text, p_size_kb int)
returns jsonb
language plpgsql security definer
set search_path = mob, public
as $function$
begin
  perform public._set_tenant(p_tenant, p_caller);

  if not exists (select 1 from mob.devices d
                  where d.device_id = p_device_id and d.tenant_id = p_tenant
                    and d.username = p_caller and not d.revoked) then
    raise exception 'This phone is not registered. Please log in with your password.';
  end if;

  if not exists (select 1 from mob.entries e
                  where e.entry_id = p_entry_id and e.tenant_id = p_tenant
                    and e.username = p_caller) then
    raise exception 'Entry not found for this photo';
  end if;

  if p_path is distinct from p_tenant || '/' || p_entry_id || '/' || p_photo_id || '.jpg' then
    raise exception 'Photo path is not valid';
  end if;

  if (select count(*) from mob.entry_photos ph where ph.entry_id = p_entry_id) >= 5 then
    raise exception 'An entry can have at most 5 photos';
  end if;

  insert into mob.entry_photos (photo_id, entry_id, tenant_id, storage_path, size_kb)
  values (p_photo_id, p_entry_id, p_tenant, p_path, p_size_kb)
  on conflict (photo_id) do nothing;      -- resend of the same photo

  return jsonb_build_object('ok', true, 'photo_id', p_photo_id);
end $function$;


-- ===== 4. My Entries: now with the number of photos received =====
create or replace function mob.my_entries(
  p_tenant text, p_caller text, p_device_id uuid, p_days int default 30)
returns jsonb
language plpgsql security definer
set search_path = mob, public
as $function$
begin
  perform public._set_tenant(p_tenant, p_caller);
  if not exists (select 1 from mob.devices d
                  where d.device_id = p_device_id and d.tenant_id = p_tenant
                    and d.username = p_caller and not d.revoked) then
    raise exception 'This phone is not registered. Please log in with your password.';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'entry_id',      e.entry_id,
             'status',        e.status,
             'reject_reason', e.reject_reason,
             'voucher_ref',   e.voucher_ref,
             'reviewed_at',   e.reviewed_at,
             'total',         e.total_incl_vat,
             'price_flag',    e.price_flag,
             'photos',        (select count(*) from mob.entry_photos ph where ph.entry_id = e.entry_id))
           order by e.created_at desc)
      from mob.entries e
     where e.tenant_id = p_tenant
       and e.username = p_caller
       and e.created_at >= now() - make_interval(days => greatest(p_days, 1))
  ), '[]'::jsonb);
end $function$;


-- ===== GRANTS =====
revoke all on function mob.add_photo(text, text, uuid, uuid, uuid, text, int) from public, anon, authenticated;
grant execute on function mob.add_photo(text, text, uuid, uuid, uuid, text, int) to anon;

notify pgrst, 'reload schema';
