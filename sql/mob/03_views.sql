-- SiddhiGL Mobile — 03_views.sql
-- Read-only views over public masters. Run after 02_tables.sql.
-- They filter by app.tenant_id, which public._set_tenant sets inside each mob function.

create or replace view mob.v_items as
select im.tenant_id,
       im.item_code,
       im.item_name,
       im.unit,
       im.hs_code,
       im.item_group_code,
       im.taxable,
       coalesce(im.vip_disc_pct, 0) as vip_disc_pct
  from public.item_master im
 where im.tenant_id = current_setting('app.tenant_id', true)
   and im.active;

-- Same price logic as report 103 (public.v_price_list): VAT-inclusive per quantity level
create or replace view mob.v_prices as
select pl.tenant_id,
       pl.item_code,
       pl.level_no,
       pl.qty_from,
       pl.qty_to,
       pl.price_excl_vat,
       pl.selling_price as price_incl_vat
  from public.v_price_list pl;

create or replace view mob.v_parties as
select p.tenant_id,
       p.party_code,
       p.party_name,
       p.mobile,
       p.party_type,
       coalesce(p.is_vip, false) as is_vip
  from public.parties p
 where p.tenant_id = current_setting('app.tenant_id', true)
   and p.active;

revoke all on mob.v_items, mob.v_prices, mob.v_parties from public, anon, authenticated;
