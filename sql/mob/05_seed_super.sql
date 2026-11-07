-- SiddhiGL Mobile — 05_seed_super.sql
-- Default menu, expense heads and settings for the SUPER demo tenant only.
-- Edit labels or add rows any time: phones pick them up on the next sync.
-- Expense head account_no is left empty: map to real ledgers in Phase 2.

insert into mob.settings (tenant_id, key, value) values
  ('SUPER', 'photo_above_amount', '1000'),
  ('SUPER', 'pin_lock_minutes',   '15'),
  ('SUPER', 'idle_lock_minutes',  '5'),
  ('SUPER', 'temp_bill_footer',   'This is not a tax invoice.')
on conflict (tenant_id, key) do nothing;

insert into mob.menu (tenant_id, code, label_en, label_np, icon, action, roles, sort_order) values
  ('SUPER', 'SALE',       'Sale',       'बिक्री',          'cart',    'SALE',       array['admin','manager','user'],          10),
  ('SUPER', 'EXPENSE',    'Expense',    'खर्च',           'wallet',  'EXPENSE',    array['admin','manager','user'],          20),
  ('SUPER', 'RECEIPT',    'Receipt',    'रकम प्राप्ति',     'in',      'RECEIPT',    array['admin','manager'],                 30),
  ('SUPER', 'PAYMENT',    'Payment',    'भुक्तानी',        'out',     'PAYMENT',    array['admin','manager'],                 40),
  ('SUPER', 'PHOTO',      'Photo Bill', 'बिल फोटो',       'camera',  'PHOTO',      array['admin','manager','user'],          50),
  ('SUPER', 'MY_ENTRIES', 'My Entries', 'मेरो प्रविष्टि',    'list',    'MY_ENTRIES', array['admin','manager','user'],          60),
  ('SUPER', 'PRICE_LIST', 'Price List', 'मूल्य सूची',       'tag',     'PRICE_LIST', array['admin','manager','user','viewer'], 70),
  ('SUPER', 'TODAY',      'Today',      'आज',             'chart',   'TODAY',      array['admin','manager'],                 80),
  ('SUPER', 'DAY_CLOSE',  'Day Close',  'दिन बन्द',        'lock',    'DAY_CLOSE',  array['admin','manager'],                 90)
on conflict (tenant_id, code) do nothing;

insert into mob.expense_heads (tenant_id, code, label_en, label_np, sort_order) values
  ('SUPER', 'TEA',         'Tea / Snacks', 'चिया खाजा', 10),
  ('SUPER', 'FUEL',        'Fuel',         'इन्धन',     20),
  ('SUPER', 'TRANSPORT',   'Transport',    'ढुवानी',    30),
  ('SUPER', 'STATIONERY',  'Stationery',   'मसलन्द',   40),
  ('SUPER', 'REPAIR',      'Repair',       'मर्मत',     50),
  ('SUPER', 'ELECTRICITY', 'Electricity',  'बिजुली',    60),
  ('SUPER', 'OTHER',       'Other',        'अन्य',      90)
on conflict (tenant_id, code) do nothing;
