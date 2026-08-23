begin;

select plan(17);

select has_column('public', 'procurement_product_vendor_prices', 'id', 'vendor price has surrogate id');
select col_is_pk('public', 'procurement_product_vendor_prices', 'id', 'surrogate id is primary key');
select has_column('public', 'procurement_product_vendor_prices', 'odoo_supplierinfo_id', 'Odoo supplier-info id is stored');
select has_column('public', 'procurement_product_vendor_prices', 'company_id', 'Odoo company scope is stored');
select has_column('public', 'procurement_product_vendor_prices', 'valid_from', 'vendor start date is stored');
select has_column('public', 'procurement_product_vendor_prices', 'valid_to', 'vendor end date is stored');

insert into public.procurement_product_purchase_metadata (
  product_code, odoo_product_id, synced_at
) values ('TEST-V2-PRICE', 97001, now());

insert into public.procurement_product_vendor_prices (
  odoo_supplierinfo_id, product_code, supplier_id, company_id, minimum_qty,
  price, currency, sequence, valid_from, valid_to, synced_at
) values
  (7001, 'TEST-V2-PRICE', 96001, null, 12, 110, 'SAR', 10, null, null, now()),
  (7002, 'TEST-V2-PRICE', 96001, null, 12, 105, 'SAR', 20, null, null, now()),
  (7003, 'TEST-V2-PRICE', 96001, 1, 12, 90, 'SAR', 10, current_date - 1, current_date + 30, now()),
  (7004, 'TEST-V2-PRICE', 96001, 2, 6, 80, 'SAR', 10, current_date - 30, current_date - 1, now()),
  (7005, 'TEST-V2-PRICE', 96001, null, 24, 95, 'SAR', 10, null, null, now());

insert into public.procurement_product_vendor_prices (
  product_code, supplier_id, company_id, minimum_qty, price, currency,
  sequence, synced_at
) values ('TEST-V2-PRICE', 96001, null, 1, 50, 'SAR', 1, now());

select is(
  (select count(*) from public.procurement_product_vendor_prices
   where product_code = 'TEST-V2-PRICE' and supplier_id = 96001 and minimum_qty = 12),
  3::bigint,
  'same projected product/supplier/MOQ rows coexist when Odoo ids differ'
);

select throws_ok(
  $$insert into public.procurement_product_vendor_prices (
      odoo_supplierinfo_id, product_code, supplier_id, minimum_qty, price, synced_at
    ) values (7001, 'TEST-V2-PRICE', 96001, 1, 99, now())$$,
  '23505', null, 'Odoo supplier-info id is unique'
);

select throws_ok(
  $$insert into public.procurement_product_vendor_prices (
      odoo_supplierinfo_id, product_code, supplier_id, minimum_qty, price,
      valid_from, valid_to, synced_at
    ) values (7999, 'TEST-V2-PRICE', 96001, 1, 99,
      current_date + 1, current_date, now())$$,
  '23514', null, 'invalid vendor validity range is rejected'
);

select is(
  (select unit_price from public.procurement_purchase_price_choice(1, 'TEST-V2-PRICE', 96001, 12)),
  90::numeric,
  'company-specific valid price wins over global price'
);

select is(
  (select unit_price from public.procurement_purchase_price_choice(2, 'TEST-V2-PRICE', 96001, 12)),
  110::numeric,
  'expired company price and legacy fallback are ignored when current Odoo rows exist'
);

select is(
  public.procurement_purchase_minimum_order_qty(1, 'TEST-V2-PRICE', 96001),
  12::numeric,
  'company-specific valid MOQ is selected when present'
);

select is(
  public.procurement_purchase_minimum_order_qty(2, 'TEST-V2-PRICE', 96001),
  12::numeric,
  'global MOQ is the fallback when no valid company row exists'
);

select ok(
  not has_table_privilege('anon', 'public.procurement_product_vendor_prices', 'select'),
  'anon still cannot select vendor prices'
);
select ok(
  not has_table_privilege('authenticated', 'public.procurement_product_vendor_prices', 'select'),
  'authenticated still cannot select vendor prices'
);
select ok(
  has_table_privilege('service_role', 'public.procurement_product_vendor_prices', 'select'),
  'service_role can still select vendor prices'
);
select ok(
  has_sequence_privilege(
    'service_role', 'public.procurement_product_vendor_prices_id_seq', 'usage'
  ),
  'service_role can allocate surrogate ids'
);

select * from finish();
rollback;
