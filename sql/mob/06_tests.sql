-- SiddhiGL Mobile — 06_tests.sql
-- Phase 1 checks in SUPER. Run one line at a time; replace the <...> values.

-- 1. Register a phone with a SUPER user's real password.
--    Copy device_id and device_secret from the result.
select mob.register_device('SUPER', '<username>', '<password>', 'Test phone');

-- 2. Set PIN (within 10 minutes of step 1, no old PIN needed). Expect {"ok": true}
select mob.set_pin('<device_id>', '<device_secret>', '2580');

-- 3. Easy PIN is refused. Expect error "too easy to guess"
select mob.set_pin('<device_id>', '<device_secret>', '1111');

-- 4. PIN login. Expect ok true with name, role, company
select mob.pin_login('<device_id>', '<device_secret>', '2580');

-- 5. Wrong PIN. Expect WRONG_PIN with attempts_left 4, then 3 ...
select mob.pin_login('<device_id>', '<device_secret>', '9999');

-- 6. Masters. Expect menu (9 tiles for admin), expense_heads, items, prices, parties
select mob.sync_masters('SUPER', '<username>', '<device_id>');

-- 7. Clean up the lock if you tried 5 wrong PINs
select mob.reset_pin('SUPER', '<username>', '<username>');

-- 8. Block the test phone. Then step 4 should say "blocked"
select mob.revoke_device('SUPER', '<username>', '<device_id>');
