begin;

select plan(11);

select is(
  (select forecast_qty from public.procurement_calculate_recommendation(10, 40, 14, 4, 7, 1, 'SUFFICIENT')),
  140::numeric,
  'forecast quantity uses selected coverage days'
);

select is(
  (select lead_time_qty from public.procurement_calculate_recommendation(10, 40, 14, 4, 7, 1, 'SUFFICIENT')),
  40::numeric,
  'lead-time quantity uses product lead time'
);

select is(
  (select safety_stock_qty from public.procurement_calculate_recommendation(10, 40, 14, 4, 7, 1, 'SUFFICIENT')),
  70::numeric,
  'safety-stock quantity uses product safety days'
);

select is(
  (select suggested_qty from public.procurement_calculate_recommendation(10, 40, 14, 4, 7, 1, 'SUFFICIENT')),
  210::numeric,
  'suggested quantity deducts free stock from coverage plus lead time plus safety stock'
);

select is(
  (select priority from public.procurement_calculate_recommendation(10, 40, 14, 4, 7, 1, 'SUFFICIENT')),
  'CRITICAL'::text,
  'priority is critical when actual coverage equals lead time'
);

select is(
  (select suggested_qty from public.procurement_calculate_recommendation(10, 40, 14, 4, 7, 1, 'INSUFFICIENT')),
  null::numeric,
  'insufficient data never produces a purchase recommendation'
);

select is(
  (select suggested_qty from public.procurement_calculate_recommendation(3, 0, 7, 0, 0, 5, 'SUFFICIENT')),
  25::numeric,
  'suggested quantity rounds upward to the order multiple'
);

insert into public.procurement_supplier_receipts (
  odoo_receipt_line_id,
  receipt_id,
  receipt_name,
  company_id,
  product_id,
  product_code,
  product_name,
  supplier_id,
  supplier_name,
  received_qty,
  unit_cost,
  received_at
) values
  (7001, 701, 'WH/IN/00701', 1, 91, 'BEHAVIOR-SKU', 'Behavior Product', 20, 'Supplier Older', 50, 10, '2026-07-20T10:00:00Z'),
  (7002, 702, 'WH/IN/00702', 2, 91, 'BEHAVIOR-SKU', 'Behavior Product', 30, 'Supplier Latest Smaller', 20, 11, '2026-07-21T10:00:00Z'),
  (7003, 703, 'WH/IN/00703', 1, 91, 'BEHAVIOR-SKU', 'Behavior Product', 40, 'Supplier Latest Larger', 30, 12, '2026-07-21T10:00:00Z');

select is(
  (select supplier_id from public.api_latest_supplier_receipt where product_code = 'BEHAVIOR-SKU'),
  40::bigint,
  'latest supplier tie-break prefers larger received quantity'
);

select is(
  (select supplier_name from public.api_latest_supplier_receipt where product_code = 'BEHAVIOR-SKU'),
  'Supplier Latest Larger'::text,
  'latest supplier view returns the selected supplier name'
);

select ok(
  not has_table_privilege('anon', 'public.api_latest_supplier_receipt', 'select'),
  'anonymous browser role cannot read supplier receipt API view'
);

select ok(
  not has_table_privilege('authenticated', 'public.api_sync_status', 'select'),
  'authenticated browser role cannot read sync status API view directly'
);

select * from finish();
rollback;
