-- SiddhiGL Mobile — 04_functions.sql
-- Run after 03_views.sql. Run each $function$ block ONE AT A TIME in the SQL editor,
-- then the GRANTS block at the end, then: notify pgrst, 'reload schema';
--
-- Called by the phone (through the Worker):
--   register_device  password login on a new phone, returns device id + secret
--   set_pin          set or change the 4-digit PIN
--   pin_login        daily unlock with PIN
--   sync_masters     menu, settings, items, prices, parties for the phone
-- Called by SiddhiGL Online (admin):
--   list_devices, revoke_device, reset_pin
--
-- Note: failed PIN attempts RETURN {ok:false} instead of raising an error,
-- because an error would roll back the failed-attempt counter.


-- ===== 1. Read one mobile setting, with a default =====
create or replace function mob._setting(p_tenant text, p_key text, p_default text)
returns text
language sql stable security definer
set search_path = mob, public
as $function$
  select coalesce(
    (select s.value from mob.settings s where s.tenant_id = p_tenant and s.key = p_key),
    p_default);
$function$;


-- ===== 2. User still active and subscription still valid =====
create or replace function mob._check_account(p_tenant text, p_username text)
returns void
language plpgsql stable security definer
set search_path = mob, public
as $function$
declare
  v_active boolean; v_super boolean; v_status text; v_valid date;
begin
  select u.active, coalesce(u.is_super_admin, false)
    into v_active, v_super
    from public.users u
   where u.tenant_id = p_tenant and u.username = p_username;

  if v_active is null or not v_active then
    raise exception 'This user is not active. Contact your administrator.';
  end if;

  if not v_super then
    select t.status, t.valid_until into v_status, v_valid
      from public.tenants t where t.tenant_id = p_tenant;
    if v_status is distinct from 'active' then
      raise exception 'Subscription is % for this customer', coalesce(v_status, 'unknown');
    end if;
    if v_valid is not null and v_valid < current_date then
      raise exception 'Subscription expired on %', v_valid;
    end if;
  end if;
end $function$;


-- ===== 3. Device id + secret are valid and not blocked =====
create or replace function mob._check_device(p_device_id uuid, p_device_secret text)
returns mob.devices
language plpgsql stable security definer
set search_path = mob, public, extensions
as $function$
declare v mob.devices;
begin
  select d.* into v from mob.devices d where d.device_id = p_device_id;
  if not found or v.secret_hash <> crypt(coalesce(p_device_secret, ''), v.secret_hash) then
    raise exception 'This phone is not registered. Please log in with your password.';
  end if;
  if v.revoked then
    raise exception 'This phone has been blocked. Contact your administrator.';
  end if;
  return v;
end $function$;


-- ===== 4. Only admin or manager =====
create or replace function mob._require_admin(p_tenant text, p_caller text)
returns void
language plpgsql stable security definer
set search_path = mob, public
as $function$
begin
  if not exists (
    select 1 from public.users u
     where u.tenant_id = p_tenant and u.username = p_caller and u.active
       and (u.role in ('admin', 'manager') or coalesce(u.is_super_admin, false))
  ) then
    raise exception 'Only an admin or manager can do this';
  end if;
end $function$;


-- ===== 5. Check a PIN and count failures (never raises) =====
create or replace function mob._verify_pin(p_tenant text, p_username text, p_pin text)
returns jsonb
language plpgsql security definer
set search_path = mob, public, extensions
as $function$
declare
  v mob.user_pins; v_max int := 5; v_lock int;
begin
  select up.* into v from mob.user_pins up
   where up.tenant_id = p_tenant and up.username = p_username
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'NO_PIN',
      'message', 'PIN not set. Log in with your password.');
  end if;

  if v.locked_until is not null and v.locked_until > now() then
    return jsonb_build_object('ok', false, 'code', 'LOCKED',
      'message', 'Too many wrong PINs. Try again after '
                 || ceil(extract(epoch from v.locked_until - now()) / 60)::int || ' minutes.');
  end if;

  if v.pin_hash = crypt(coalesce(p_pin, ''), v.pin_hash) then
    update mob.user_pins up set failed_count = 0, locked_until = null
     where up.tenant_id = p_tenant and up.username = p_username;
    return jsonb_build_object('ok', true);
  end if;

  v_lock := mob._setting(p_tenant, 'pin_lock_minutes', '15')::int;

  update mob.user_pins up
     set failed_count = case when up.failed_count + 1 >= v_max then 0 else up.failed_count + 1 end,
         locked_until = case when up.failed_count + 1 >= v_max
                             then now() + make_interval(mins => v_lock) end
   where up.tenant_id = p_tenant and up.username = p_username;

  if v.failed_count + 1 >= v_max then
    return jsonb_build_object('ok', false, 'code', 'LOCKED',
      'message', 'Too many wrong PINs. Locked for ' || v_lock || ' minutes.');
  end if;

  return jsonb_build_object('ok', false, 'code', 'WRONG_PIN', 'message', 'Wrong PIN',
    'attempts_left', v_max - (v.failed_count + 1));
end $function$;


-- ===== 6. Register a phone (password login) =====
create or replace function mob.register_device(
  p_tenant text, p_username text, p_password text, p_device_name text)
returns jsonb
language plpgsql security definer
set search_path = mob, public, extensions
as $function$
declare
  v_u record; v_n int; v_code text; v_secret text; v_id uuid;
begin
  -- Reuse the main system's password check (also checks subscription)
  select lv.* into v_u
    from public.login_verify(p_tenant, p_username, p_password) lv
   limit 1;
  if not found then
    raise exception 'Wrong customer ID, username or password';
  end if;
  if v_u.must_change_password then
    raise exception 'Please change your password in SiddhiGL Online first';
  end if;

  perform pg_advisory_xact_lock(hashtext('mob.devices.' || p_tenant));
  select coalesce(max(substring(d.device_code from 2)::int), 0) + 1
    into v_n
    from mob.devices d where d.tenant_id = p_tenant;

  v_code   := 'M' || lpad(v_n::text, 2, '0');
  v_secret := encode(gen_random_bytes(32), 'hex');

  insert into mob.devices (tenant_id, username, device_name, device_code, secret_hash)
  values (p_tenant, v_u.username,
          left(coalesce(nullif(trim(p_device_name), ''), 'Phone'), 60),
          v_code, crypt(v_secret, gen_salt('bf')))
  returning device_id into v_id;

  insert into mob.temp_seq (device_id) values (v_id);

  return jsonb_build_object(
    'device_id',     v_id,
    'device_code',   v_code,
    'device_secret', v_secret,       -- shown once; the phone keeps it
    'tenant_id',     p_tenant,
    'username',      v_u.username,
    'full_name',     v_u.full_name,
    'role',          v_u.role,
    'company_name',  v_u.company_name,
    'has_pin',       exists (select 1 from mob.user_pins up
                              where up.tenant_id = p_tenant and up.username = v_u.username));
end $function$;


-- ===== 7. Set or change PIN =====
-- Old PIN is needed, unless this phone was registered in the last 10 minutes
-- (that is, the user just logged in with their password). Forgot PIN = log in with password again.
create or replace function mob.set_pin(
  p_device_id uuid, p_device_secret text, p_new_pin text, p_old_pin text default null)
returns jsonb
language plpgsql security definer
set search_path = mob, public, extensions
as $function$
declare
  v mob.devices; v_has boolean; v_check jsonb;
begin
  v := mob._check_device(p_device_id, p_device_secret);
  perform mob._check_account(v.tenant_id, v.username);

  if coalesce(p_new_pin, '') !~ '^[0-9]{4}$' then
    raise exception 'PIN must be 4 digits';
  end if;
  if p_new_pin ~ '^(.)\1{3}$'
     or p_new_pin in ('1234','2345','3456','4567','5678','6789','0123','4321','9876') then
    raise exception 'This PIN is too easy to guess. Choose another.';
  end if;

  v_has := exists (select 1 from mob.user_pins up
                    where up.tenant_id = v.tenant_id and up.username = v.username);

  if v_has and v.registered_at < now() - interval '10 minutes' then
    v_check := mob._verify_pin(v.tenant_id, v.username, p_old_pin);
    if not (v_check ->> 'ok')::boolean then
      return v_check;
    end if;
  end if;

  insert into mob.user_pins as up (tenant_id, username, pin_hash)
  values (v.tenant_id, v.username, crypt(p_new_pin, gen_salt('bf')))
  on conflict (tenant_id, username) do update
     set pin_hash = excluded.pin_hash, failed_count = 0,
         locked_until = null, updated_at = now();

  return jsonb_build_object('ok', true);
end $function$;


-- ===== 8. Daily unlock with PIN =====
create or replace function mob.pin_login(p_device_id uuid, p_device_secret text, p_pin text)
returns jsonb
language plpgsql security definer
set search_path = mob, public, extensions
as $function$
declare
  v mob.devices; v_check jsonb; v_name text; v_role text;
begin
  v := mob._check_device(p_device_id, p_device_secret);
  perform mob._check_account(v.tenant_id, v.username);

  v_check := mob._verify_pin(v.tenant_id, v.username, p_pin);
  if not (v_check ->> 'ok')::boolean then
    return v_check;
  end if;

  update mob.devices d set last_seen = now() where d.device_id = v.device_id;

  select u.full_name, u.role into v_name, v_role
    from public.users u
   where u.tenant_id = v.tenant_id and u.username = v.username;

  return jsonb_build_object(
    'ok',           true,
    'tenant_id',    v.tenant_id,
    'username',     v.username,
    'full_name',    v_name,
    'role',         v_role,
    'device_code',  v.device_code,
    'company_name', (select cc.company_name from public.company_config cc
                      where cc.tenant_id = v.tenant_id),
    'server_time',  now());
end $function$;


-- ===== 9. Masters for the phone =====
-- Full lists each time (item_master and parties have no updated_at yet).
create or replace function mob.sync_masters(p_tenant text, p_caller text, p_device_id uuid)
returns jsonb
language plpgsql security definer
set search_path = mob, public
as $function$
declare
  v_dev mob.devices; v_role text;
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

  select u.role into v_role from public.users u
   where u.tenant_id = p_tenant and u.username = p_caller;

  update mob.devices d set last_seen = now() where d.device_id = p_device_id;

  return jsonb_build_object(
    'server_time', now(),

    'company', (select jsonb_build_object(
                   'name',                    cc.company_name,
                   'vat_pct',                 coalesce(cc.vat_pct, 13),
                   'rate_edit_tolerance_pct', coalesce(cc.rate_edit_tolerance_pct, 0))
                  from public.company_config cc where cc.tenant_id = p_tenant),

    'settings', coalesce((select jsonb_object_agg(s.key, s.value)
                            from mob.settings s where s.tenant_id = p_tenant), '{}'::jsonb),

    'menu', coalesce((select jsonb_agg(jsonb_build_object(
                         'code', m.code, 'label_en', m.label_en, 'label_np', m.label_np,
                         'icon', m.icon, 'action', m.action)
                       order by m.sort_order, m.code)
                        from mob.menu m
                       where m.tenant_id = p_tenant and m.active and v_role = any (m.roles)),
                     '[]'::jsonb),

    'expense_heads', coalesce((select jsonb_agg(jsonb_build_object(
                         'code', e.code, 'label_en', e.label_en, 'label_np', e.label_np,
                         'photo_required', e.photo_required)
                       order by e.sort_order, e.code)
                        from mob.expense_heads e
                       where e.tenant_id = p_tenant and e.active),
                     '[]'::jsonb),

    'items', coalesce((select jsonb_agg(to_jsonb(i) - 'tenant_id' order by i.item_name)
                         from mob.v_items i), '[]'::jsonb),

    'prices', coalesce((select jsonb_agg(jsonb_build_object(
                          'item_code', pr.item_code, 'level_no', pr.level_no,
                          'qty_from', pr.qty_from, 'qty_to', pr.qty_to,
                          'price_incl_vat', pr.price_incl_vat)
                        order by pr.item_code, pr.level_no)
                         from mob.v_prices pr), '[]'::jsonb),

    'parties', coalesce((select jsonb_agg(to_jsonb(pt) - 'tenant_id' order by pt.party_name)
                           from mob.v_parties pt), '[]'::jsonb)
  );
end $function$;


-- ===== 10. Admin: list phones =====
create or replace function mob.list_devices(p_tenant text, p_caller text)
returns jsonb
language plpgsql security definer
set search_path = mob, public
as $function$
begin
  perform public._set_tenant(p_tenant, p_caller);
  perform mob._require_admin(p_tenant, p_caller);
  return coalesce((select jsonb_agg(jsonb_build_object(
            'device_id', d.device_id, 'device_code', d.device_code,
            'device_name', d.device_name, 'username', d.username,
            'registered_at', d.registered_at, 'last_seen', d.last_seen,
            'revoked', d.revoked)
          order by d.device_code)
           from mob.devices d where d.tenant_id = p_tenant), '[]'::jsonb);
end $function$;


-- ===== 11. Admin: block a phone (lost or stolen) =====
create or replace function mob.revoke_device(p_tenant text, p_caller text, p_device_id uuid)
returns jsonb
language plpgsql security definer
set search_path = mob, public
as $function$
begin
  perform public._set_tenant(p_tenant, p_caller);
  perform mob._require_admin(p_tenant, p_caller);

  update mob.devices d
     set revoked = true, revoked_by = p_caller, revoked_at = now()
   where d.device_id = p_device_id and d.tenant_id = p_tenant;
  if not found then
    raise exception 'Phone not found';
  end if;
  return jsonb_build_object('ok', true);
end $function$;


-- ===== 12. Admin: clear a user's PIN (user logs in with password again) =====
create or replace function mob.reset_pin(p_tenant text, p_caller text, p_username text)
returns jsonb
language plpgsql security definer
set search_path = mob, public
as $function$
begin
  perform public._set_tenant(p_tenant, p_caller);
  perform mob._require_admin(p_tenant, p_caller);

  delete from mob.user_pins up
   where up.tenant_id = p_tenant and up.username = p_username;
  return jsonb_build_object('ok', true);
end $function$;


-- ===== GRANTS: only the public mob functions are callable =====
revoke all on all functions in schema mob from public, anon, authenticated;

grant execute on function
  mob.register_device(text, text, text, text),
  mob.set_pin(uuid, text, text, text),
  mob.pin_login(uuid, text, text),
  mob.sync_masters(text, text, uuid),
  mob.list_devices(text, text),
  mob.revoke_device(text, text, uuid),
  mob.reset_pin(text, text, text)
to anon;

notify pgrst, 'reload schema';
