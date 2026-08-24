begin;

select plan(41);

select has_table('public', 'procurement_purchase_drafts', 'purchase drafts table exists');
select col_is_pk('public', 'procurement_purchase_drafts', 'id', 'purchase drafts use UUID primary key');
select has_table('public', 'procurement_purchase_draft_lines', 'purchase draft lines table exists');
select col_is_pk('public', 'procurement_purchase_draft_lines', 'id', 'draft lines use UUID primary key');
select has_view('public', 'api_purchase_drafts', 'purchase draft read projection exists');
select has_view('public', 'api_purchase_draft_lines', 'purchase draft line projection exists');

select ok(
  exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'api_purchase_drafts'
      and c.reloptions::text[] @> array['security_invoker=true']
  ),
  'draft projection uses security_invoker'
);
select ok(
  exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'api_purchase_draft_lines'
      and c.reloptions::text[] @> array['security_invoker=true']
  ),
  'draft line projection uses security_invoker'
);

select throws_ok(
  $$insert into public.procurement_purchase_drafts (
      company_id, company_name, supplier_id, supplier_name, status,
      created_by, created_by_display_name, created_by_role
    ) values (
      3, 'Invalid', 99001, 'Supplier', 'DRAFT',
      '44444444-4444-4444-4444-444444444444', 'Invalid', 'reviewer'
    )$$,
  '23514',
  null,
  'draft company is restricted to MAS or Horeca Smart'
);

select throws_ok(
  $$insert into public.procurement_purchase_draft_lines (
      draft_id, product_code, product_name, suggested_qty, approved_qty,
      price_source, warnings, source_recommendation_version
    ) values (
      gen_random_uuid(), 'INVALID', 'Invalid', 10, 0,
      'MISSING', '{}', 0
    )$$,
  '23514',
  null,
  'draft line approved quantity must be positive'
);

insert into auth.users (id) values ('44444444-4444-4444-4444-444444444444')
on conflict (id) do nothing;

insert into public.app_user_roles (user_id, display_name, role) values
  ('44444444-4444-4444-4444-444444444444', 'RFQ Buyer', 'reviewer')
on conflict (user_id) do update set is_active = true, role = 'reviewer';

insert into public.procurement_supplier_directory (
  odoo_supplier_id, supplier_name, supplier_code, active, supplier_rank, synced_at
) values
  (99001, 'RFQ Supplier A', 'RFQ-A', true, 3, now()),
  (99002, 'RFQ Supplier B', 'RFQ-B', true, 2, now()),
  (99003, 'Customer Only', 'CUS-3', true, 0, now());

insert into public.procurement_product_purchase_metadata (
  product_code, odoo_product_id, brand_id, brand_name, purchase_uom_id,
  purchase_uom_name, order_multiple, synced_at
) values
  ('TEST-RFQ-1', 98001, 501, 'Official Test Brand', 1, 'Units', 6, now()),
  ('TEST-RFQ-2', 98002, null, null, null, null, null, now());

insert into public.procurement_product_vendor_prices (
  product_code, supplier_id, minimum_qty, price, currency, delay_days,
  sequence, synced_at
) values
  ('TEST-RFQ-1', 99001, 12, 95, 'SAR', 3, 10, now()),
  ('TEST-RFQ-1', 99001, 24, 90, 'SAR', 3, 10, now());

insert into public.procurement_product_vendor_prices (
  odoo_supplierinfo_id, product_code, supplier_id, company_id, minimum_qty,
  price, currency, delay_days, sequence, valid_from, valid_to, synced_at
) values
  (91001, 'TEST-RFQ-1', 99001, 1, 18, 77, 'SAR', 2, 5,
    current_date - 1, current_date + 30, now()),
  (91002, 'TEST-RFQ-1', 99002, 1, 30, 66, 'SAR', 2, 5,
    current_date - 1, current_date + 30, now());

create or replace view public.v_procurement_recommendation_configurable
with (security_invoker = true)
as
select *
from (
  values
    (1::bigint, 'MAS'::text, 98001::bigint, 'TEST-RFQ-1'::text,
      'Test Product One'::text, 'Test Product One'::text, 27::numeric,
      2::numeric, current_date, now(), 'MANUAL'::text, 2::numeric,
      180::numeric, 27::numeric, 0::numeric, 0::numeric, 0::numeric,
      13.5::numeric, 4::integer, 7::integer, 23::numeric, 'CRITICAL'::text,
      'SUFFICIENT'::text, 'NEEDS_SUPPLIER'::text, null::bigint, null::text,
      null::bigint, null::text, null::timestamptz, 0::bigint),
    (1::bigint, 'MAS'::text, 98002::bigint, 'TEST-RFQ-2'::text,
      'Test Product Two'::text, 'Test Product Two'::text, 15::numeric,
      1::numeric, current_date, now(), 'MANUAL'::text, 1::numeric,
      90::numeric, 15::numeric, 0::numeric, 0::numeric, 0::numeric,
      15::numeric, 4::integer, 7::integer, 10::numeric, 'HIGH'::text,
      'SUFFICIENT'::text, 'NEEDS_SUPPLIER'::text, null::bigint, null::text,
      null::bigint, null::text, null::timestamptz, 0::bigint)
) as source(
  company_id, company_name, product_id, product_code, product_name,
  effective_product_name, available_quantity, effective_daily_demand,
  last_sale_date, snapshot_at, demand_method, manual_daily_demand,
  sales_qty_90d, free_qty, forecast_qty, lead_time_qty, safety_stock_qty,
  actual_coverage_days, lead_time_days, safety_stock_days, suggested_qty, priority, data_status,
  supplier_status, proposed_supplier_id, proposed_supplier_name,
  approved_supplier_id, approved_supplier_name, latest_receipt_at, version
);

select public.procurement_install_api_views();

select throws_ok(
  $$select public.rpc_create_purchase_draft(
    1, 99003, null, null,
    '[{"productCode":"TEST-RFQ-1","expectedRecommendationVersion":0}]'::jsonb,
    '44444444-4444-4444-4444-444444444444', 'rfq-customer-only'
  )$$,
  'SUPPLIER_NOT_FOUND',
  'customer-only partner cannot create a draft'
);

create temporary table created_draft as
select public.rpc_create_purchase_draft(
  1,
  99001,
  current_date + 7,
  'Initial RFQ draft',
  '[
    {"productCode":"TEST-RFQ-1","expectedRecommendationVersion":0},
    {"productCode":"TEST-RFQ-2","expectedRecommendationVersion":0}
  ]'::jsonb,
  '44444444-4444-4444-4444-444444444444',
  'rfq-create-1'
) as payload;

select is(
  (select count(*) from public.procurement_purchase_drafts),
  1::bigint,
  'one draft is created atomically'
);
select is(
  (select count(*) from public.procurement_purchase_draft_lines),
  2::bigint,
  'selected recommendation rows become two draft lines'
);
select is(
  (select supplier_name from public.procurement_purchase_drafts limit 1),
  'RFQ Supplier A',
  'supplier name is snapshotted from the service directory'
);
select is(
  (select approved_qty from public.procurement_purchase_draft_lines
    where product_code = 'TEST-RFQ-1'),
  24::numeric,
  'suggested quantity is copied and rounded upward by trusted MOQ/multiple'
);
select is(
  (select unit_price from public.procurement_purchase_draft_lines
    where product_code = 'TEST-RFQ-1'),
  77::numeric,
  'company-specific valid supplier price is snapshotted'
);
select is(
  (select price_source from public.procurement_purchase_draft_lines
    where product_code = 'TEST-RFQ-1'),
  'ODOO_VENDOR_PRICE',
  'price provenance records the matching Odoo vendor source'
);
select ok(
  (select warnings @> array['PACKAGING_REVIEW_REQUIRED', 'BRAND_UNDEFINED']::text[]
    from public.procurement_purchase_draft_lines where product_code = 'TEST-RFQ-2'),
  'missing packaging and official brand remain explicit warnings'
);

update public.procurement_supplier_directory
set supplier_name = 'Changed Source Name'
where odoo_supplier_id = 99001;
update public.procurement_product_purchase_metadata
set brand_name = 'Changed Source Brand'
where product_code = 'TEST-RFQ-1';

select is(
  (select supplier_name from public.procurement_purchase_drafts limit 1),
  'RFQ Supplier A',
  'later supplier sync cannot mutate the frozen draft snapshot'
);
select is(
  (select brand_name from public.procurement_purchase_draft_lines
    where product_code = 'TEST-RFQ-1'),
  'Official Test Brand',
  'later product sync cannot mutate the frozen line snapshot'
);

select lives_ok(
  format(
    $$select public.rpc_change_purchase_draft_supplier(
      %L::uuid, 99002, 1,
      '44444444-4444-4444-4444-444444444444', 'rfq-supplier-change'
    )$$,
    (select id from public.procurement_purchase_drafts limit 1)
  ),
  'supplier change succeeds with a company-specific valid vendor rule'
);
select is(
  (select supplier_id from public.procurement_purchase_drafts limit 1),
  99002::bigint,
  'supplier change persists the selected supplier'
);
select is(
  (select approved_qty from public.procurement_purchase_draft_lines
    where product_code = 'TEST-RFQ-1'),
  30::numeric,
  'supplier change rerounds quantity using company-aware MOQ'
);
select is(
  (select unit_price from public.procurement_purchase_draft_lines
    where product_code = 'TEST-RFQ-1'),
  66::numeric,
  'supplier change selects the valid company-specific vendor price'
);

select lives_ok(
  format(
    $$select public.rpc_update_purchase_draft_line(
      %L::uuid, %L::uuid, 25, 88, 'Buyer adjusted quantity', 2,
      '44444444-4444-4444-4444-444444444444', 'rfq-line-update'
    )$$,
    (select id from public.procurement_purchase_drafts limit 1),
    (select id from public.procurement_purchase_draft_lines where product_code = 'TEST-RFQ-1')
  ),
  'draft line update succeeds with the expected version'
);
select is(
  (select approved_qty from public.procurement_purchase_draft_lines
    where product_code = 'TEST-RFQ-1'),
  30::numeric,
  'edited quantity is rounded upward using the frozen order multiple'
);
select is(
  (select price_source from public.procurement_purchase_draft_lines
    where product_code = 'TEST-RFQ-1'),
  'MANUAL_CONFIRMED',
  'manual unit price is recorded with explicit provenance'
);
select throws_ok(
  format(
    $$select public.rpc_update_purchase_draft_line(
      %L::uuid, %L::uuid, 31, 89, null, 1,
      '44444444-4444-4444-4444-444444444444', 'rfq-line-stale'
    )$$,
    (select id from public.procurement_purchase_drafts limit 1),
    (select id from public.procurement_purchase_draft_lines where product_code = 'TEST-RFQ-1')
  ),
  '40001',
  'VERSION_CONFLICT',
  'stale line version is rejected'
);

select throws_ok(
  format(
    $$select public.rpc_transition_purchase_draft(
      %L::uuid, 'EXPORTED', 2,
      '44444444-4444-4444-4444-444444444444', 'rfq-invalid-transition'
    )$$,
    (select id from public.procurement_purchase_drafts limit 1)
  ),
  'INVALID_STATUS_TRANSITION',
  'draft cannot skip directly to EXPORTED'
);
select lives_ok(
  format(
    $$select public.rpc_transition_purchase_draft(
      %L::uuid, 'READY_FOR_EXPORT', 2,
      '44444444-4444-4444-4444-444444444444', 'rfq-ready'
    )$$,
    (select id from public.procurement_purchase_drafts limit 1)
  ),
  'draft can become ready for export'
);
select is(
  (select status from public.procurement_purchase_drafts limit 1),
  'READY_FOR_EXPORT',
  'valid transition persists the new status'
);

select is(
  (select count(*) from public.procurement_audit_events
    where module = 'PURCHASE_DRAFT'),
  4::bigint,
  'create, supplier change, line update and status transition are audited'
);
select is(
  (select entity_key from public.procurement_audit_events
    where request_id = 'rfq-create-1'),
  (select id::text from public.procurement_purchase_drafts limit 1),
  'audit event uses the immutable draft id as entity key'
);

select ok(
  not has_table_privilege('anon', 'public.procurement_purchase_drafts', 'select'),
  'anon cannot select drafts directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.procurement_purchase_drafts', 'select'),
  'authenticated cannot select drafts directly'
);
select ok(
  has_table_privilege('service_role', 'public.procurement_purchase_drafts', 'select'),
  'service_role can select drafts'
);
select ok(
  not has_table_privilege('anon', 'public.procurement_purchase_draft_lines', 'select'),
  'anon cannot select draft lines directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.procurement_purchase_draft_lines', 'select'),
  'authenticated cannot select draft lines directly'
);
select ok(
  has_table_privilege('service_role', 'public.procurement_purchase_draft_lines', 'select'),
  'service_role can select draft lines'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.rpc_create_purchase_draft(bigint,bigint,date,text,jsonb,uuid,text)',
    'execute'
  ),
  'authenticated cannot execute draft creation RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.rpc_create_purchase_draft(bigint,bigint,date,text,jsonb,uuid,text)',
    'execute'
  ),
  'service_role can execute draft creation RPC'
);

select * from finish();
rollback;
