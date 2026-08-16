begin;

select plan(46);

select has_table(
  'public', 'procurement_supplier_directory',
  'supplier directory table exists'
);
select col_is_pk(
  'public', 'procurement_supplier_directory', 'odoo_supplier_id',
  'supplier directory is keyed by Odoo supplier id'
);
select has_table(
  'public', 'procurement_product_vendor_prices',
  'supplier-specific vendor price table exists'
);
select col_is_pk(
  'public', 'procurement_product_vendor_prices',
  array['product_code', 'supplier_id', 'minimum_qty'],
  'vendor price tiers are keyed by product, supplier and minimum quantity'
);
select has_table(
  'public', 'procurement_product_purchase_metadata',
  'product purchase metadata table exists'
);
select col_is_pk(
  'public', 'procurement_product_purchase_metadata', 'product_code',
  'product purchase metadata is keyed by product code'
);
select has_view(
  'public', 'api_procurement_supplier_directory',
  'service supplier projection exists'
);
select has_view(
  'public', 'api_procurement_brand_options',
  'brand option projection exists'
);

select ok(
  exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'api_procurement_supplier_directory'
      and c.reloptions::text[] @> array['security_invoker=true']
  ),
  'supplier projection uses security_invoker'
);
select ok(
  exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'api_procurement_brand_options'
      and c.reloptions::text[] @> array['security_invoker=true']
  ),
  'brand projection uses security_invoker'
);

select throws_ok(
  $$insert into public.procurement_supplier_directory (
      odoo_supplier_id, supplier_name, active, supplier_rank, synced_at
    ) values (90001, 'Customer Only', true, -1, now())$$,
  '23514',
  null,
  'supplier rank cannot be negative'
);

insert into public.procurement_supplier_directory (
  odoo_supplier_id,
  supplier_name,
  supplier_code,
  active,
  supplier_rank,
  source_updated_at,
  synced_at
) values
  (91001, 'Active Supplier', 'SUP-001', true, 2, '2026-08-16T00:00:00Z', now()),
  (91002, 'Customer Only', 'CUS-001', true, 0, '2026-08-16T00:00:00Z', now()),
  (91003, 'Inactive Supplier', 'SUP-003', false, 5, '2026-08-16T00:00:00Z', now());

select is(
  (select count(*) from public.api_procurement_supplier_directory),
  1::bigint,
  'supplier projection contains active Odoo suppliers only'
);

insert into public.procurement_product_purchase_metadata (
  product_code,
  odoo_product_id,
  odoo_product_tmpl_id,
  brand_id,
  brand_name,
  purchase_uom_id,
  purchase_uom_name,
  order_multiple,
  source_updated_at,
  synced_at
) values
  ('TEST-BRAND-1', 92001, 92001, 71, 'Official Brand', 1, 'Units', 6, now(), now()),
  ('TEST-BRAND-2', 92002, 92002, 71, 'Official Brand', 1, 'Units', null, now(), now()),
  ('TEST-BRAND-3', 92003, 92003, null, null, null, null, null, now(), now());

insert into public.procurement_product_vendor_prices (
  product_code, supplier_id, minimum_qty, price, currency, delay_days,
  sequence, source_updated_at, synced_at
) values
  ('TEST-BRAND-1', 91001, 0, 100, 'SAR', 3, 10, now(), now()),
  ('TEST-BRAND-1', 91001, 12, 95, 'SAR', 3, 10, now(), now());

select is(
  (select count(*) from public.procurement_product_vendor_prices where product_code = 'TEST-BRAND-1'),
  2::bigint,
  'multiple supplier price tiers are preserved for the same product'
);

select is(
  (select count(*) from public.api_procurement_brand_options),
  1::bigint,
  'brand projection exposes distinct non-null official brands only'
);

-- supplier table SELECT permission matrix
select ok(not has_table_privilege('public', 'public.procurement_supplier_directory', 'select'), 'PUBLIC cannot select supplier directory');
select ok(not has_table_privilege('anon', 'public.procurement_supplier_directory', 'select'), 'anon cannot select supplier directory');
select ok(not has_table_privilege('authenticated', 'public.procurement_supplier_directory', 'select'), 'authenticated cannot select supplier directory');
select ok(has_table_privilege('service_role', 'public.procurement_supplier_directory', 'select'), 'service_role can select supplier directory');

-- supplier table INSERT permission matrix
select ok(not has_table_privilege('public', 'public.procurement_supplier_directory', 'insert'), 'PUBLIC cannot insert supplier directory');
select ok(not has_table_privilege('anon', 'public.procurement_supplier_directory', 'insert'), 'anon cannot insert supplier directory');
select ok(not has_table_privilege('authenticated', 'public.procurement_supplier_directory', 'insert'), 'authenticated cannot insert supplier directory');
select ok(has_table_privilege('service_role', 'public.procurement_supplier_directory', 'insert'), 'service_role can insert supplier directory');

-- product metadata SELECT permission matrix
select ok(not has_table_privilege('public', 'public.procurement_product_purchase_metadata', 'select'), 'PUBLIC cannot select product metadata');
select ok(not has_table_privilege('anon', 'public.procurement_product_purchase_metadata', 'select'), 'anon cannot select product metadata');
select ok(not has_table_privilege('authenticated', 'public.procurement_product_purchase_metadata', 'select'), 'authenticated cannot select product metadata');
select ok(has_table_privilege('service_role', 'public.procurement_product_purchase_metadata', 'select'), 'service_role can select product metadata');

-- product metadata INSERT permission matrix
select ok(not has_table_privilege('public', 'public.procurement_product_purchase_metadata', 'insert'), 'PUBLIC cannot insert product metadata');
select ok(not has_table_privilege('anon', 'public.procurement_product_purchase_metadata', 'insert'), 'anon cannot insert product metadata');
select ok(not has_table_privilege('authenticated', 'public.procurement_product_purchase_metadata', 'insert'), 'authenticated cannot insert product metadata');
select ok(has_table_privilege('service_role', 'public.procurement_product_purchase_metadata', 'insert'), 'service_role can insert product metadata');

-- vendor prices SELECT permission matrix
select ok(not has_table_privilege('public', 'public.procurement_product_vendor_prices', 'select'), 'PUBLIC cannot select vendor prices');
select ok(not has_table_privilege('anon', 'public.procurement_product_vendor_prices', 'select'), 'anon cannot select vendor prices');
select ok(not has_table_privilege('authenticated', 'public.procurement_product_vendor_prices', 'select'), 'authenticated cannot select vendor prices');
select ok(has_table_privilege('service_role', 'public.procurement_product_vendor_prices', 'select'), 'service_role can select vendor prices');

-- vendor prices INSERT permission matrix
select ok(not has_table_privilege('public', 'public.procurement_product_vendor_prices', 'insert'), 'PUBLIC cannot insert vendor prices');
select ok(not has_table_privilege('anon', 'public.procurement_product_vendor_prices', 'insert'), 'anon cannot insert vendor prices');
select ok(not has_table_privilege('authenticated', 'public.procurement_product_vendor_prices', 'insert'), 'authenticated cannot insert vendor prices');
select ok(has_table_privilege('service_role', 'public.procurement_product_vendor_prices', 'insert'), 'service_role can insert vendor prices');

-- supplier view SELECT permission matrix
select ok(not has_table_privilege('public', 'public.api_procurement_supplier_directory', 'select'), 'PUBLIC cannot select supplier projection');
select ok(not has_table_privilege('anon', 'public.api_procurement_supplier_directory', 'select'), 'anon cannot select supplier projection');
select ok(not has_table_privilege('authenticated', 'public.api_procurement_supplier_directory', 'select'), 'authenticated cannot select supplier projection');
select ok(has_table_privilege('service_role', 'public.api_procurement_supplier_directory', 'select'), 'service_role can select supplier projection');

-- brand view SELECT permission matrix
select ok(not has_table_privilege('public', 'public.api_procurement_brand_options', 'select'), 'PUBLIC cannot select brand projection');
select ok(not has_table_privilege('anon', 'public.api_procurement_brand_options', 'select'), 'anon cannot select brand projection');
select ok(not has_table_privilege('authenticated', 'public.api_procurement_brand_options', 'select'), 'authenticated cannot select brand projection');
select ok(has_table_privilege('service_role', 'public.api_procurement_brand_options', 'select'), 'service_role can select brand projection');

select * from finish();
rollback;
