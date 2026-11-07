-- SiddhiGL Mobile — 08_expense_ledgers_super.sql
-- Map SUPER's mobile expense heads to its real expense accounts.
-- SUPER has no separate tea / fuel / repair account, so those use Operation Cost.
-- To change one later: update mob.expense_heads set account_no = '...' where tenant_id = 'SUPER' and code = '...';

update mob.expense_heads h
   set account_no = m.account_no, updated_at = now()
  from (values
    ('TEA',         '4030101'),   -- Operation Cost
    ('FUEL',        '4030101'),   -- Operation Cost
    ('TRANSPORT',   '4030101'),   -- Operation Cost
    ('REPAIR',      '4030101'),   -- Operation Cost
    ('OTHER',       '4030101'),   -- Operation Cost
    ('STATIONERY',  '4030301'),   -- Printing and Stationary
    ('ELECTRICITY', '4030201')    -- Utility
  ) as m(code, account_no)
 where h.tenant_id = 'SUPER' and h.code = m.code;

-- Check: every head has an active expense account
select h.code, h.label_en, h.account_no, c.name
  from mob.expense_heads h
  left join public.chart_of_accounts c
         on c.tenant_id = h.tenant_id and c.account_no = h.account_no and c.active
 where h.tenant_id = 'SUPER'
 order by h.sort_order;
