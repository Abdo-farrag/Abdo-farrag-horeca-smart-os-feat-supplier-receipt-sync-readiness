begin;

select plan(14);

-- 1. Table existence
select has_table(
  'public',
  'procurement_company_purchase_reviews',
  'procurement_company_purchase_reviews table exists'
);

-- 2. Primary Key check
select col_is_pk(
  'public',
  'procurement_company_purchase_reviews',
  array['company_id', 'product_code'],
  'primary key is (company_id, product_code)'
);

-- 3, 4, 5. Coexistence, differing quantities, independent updates
insert into auth.users (id) values ('33333333-3333-3333-3333-333333333333')
on conflict (id) do nothing;

insert into public.app_user_roles (user_id, display_name, role) values
  ('33333333-3333-3333-3333-333333333333', 'Company Reviewer', 'reviewer')
on conflict (user_id) do nothing;

select lives_ok(
  $$select public.rpc_review_company_purchase(
    1, '101002', 'APPROVED', 100, 32546, 'Arma Supplier', 'MAS review note', 0,
    '33333333-3333-3333-3333-333333333333', 'req-mas-101002'
  )$$,
  'MAS product 101002 review succeeded'
);

select lives_ok(
  $$select public.rpc_review_company_purchase(
    2, '101002', 'APPROVED', 50, 28795, 'BODUO Supplier', 'Horeca review note', 0,
    '33333333-3333-3333-3333-333333333333', 'req-horeca-101002'
  )$$,
  'Horeca Smart product 101002 review coexists independently'
);

select is(
  (select approved_qty from public.procurement_company_purchase_reviews where company_id = 1 and product_code = '101002'),
  100::numeric,
  'MAS approved quantity is 100'
);

select is(
  (select approved_qty from public.procurement_company_purchase_reviews where company_id = 2 and product_code = '101002'),
  50::numeric,
  'Horeca Smart approved quantity differs (50)'
);

select lives_ok(
  $$select public.rpc_review_company_purchase(
    1, '101002', 'APPROVED', 150, 32546, 'Arma Supplier', 'MAS updated note', 1,
    '33333333-3333-3333-3333-333333333333', 'req-mas-update'
  )$$,
  'Updating MAS decision succeeds'
);

select is(
  (select approved_qty from public.procurement_company_purchase_reviews where company_id = 2 and product_code = '101002'),
  50::numeric,
  'Updating MAS does not modify Horeca Smart approved quantity'
);

-- 6. APPROVED requires approved_qty > 0
select throws_ok(
  $$select public.rpc_review_company_purchase(
    1, '101003', 'APPROVED', 0, null, null, 'Invalid approved qty', 0,
    '33333333-3333-3333-3333-333333333333', 'req-invalid-approved-qty'
  )$$,
  'APPROVED_QTY_REQUIRED',
  'APPROVED status requires approved_qty > 0'
);

-- 7 & 8. Stale version produces VERSION_CONFLICT
select throws_ok(
  $$select public.rpc_review_company_purchase(
    1, '101002', 'APPROVED', 200, 32546, 'Arma Supplier', 'Stale update', 0,
    '33333333-3333-3333-3333-333333333333', 'req-stale-version'
  )$$,
  '40001',
  'VERSION_CONFLICT',
  'stale expectedVersion produces VERSION_CONFLICT'
);

-- 9, 10, 11. Security privileges
select ok(
  not has_table_privilege('anon', 'public.procurement_company_purchase_reviews', 'select'),
  'anon cannot select from company purchase reviews table'
);

select ok(
  not has_table_privilege('authenticated', 'public.procurement_company_purchase_reviews', 'select'),
  'authenticated browser users cannot select directly'
);

select ok(
  has_table_privilege('service_role', 'public.procurement_company_purchase_reviews', 'select'),
  'service role can access company purchase reviews table'
);

-- 12. Audit events distinguish company using company_id:product_code
select is(
  (select entity_key from public.procurement_audit_events where request_id = 'req-mas-101002'),
  '1:101002',
  'Audit event entity_key distinguishes company using company_id:product_code'
);

select * from finish();
rollback;
