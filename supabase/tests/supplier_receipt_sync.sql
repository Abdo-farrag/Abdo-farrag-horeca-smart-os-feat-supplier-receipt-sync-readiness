begin;

select plan(4);

select has_function(
  'public',
  'procurement_supplier_receipt_cursor',
  array[]::text[],
  'supplier receipt cursor exists'
);
select is(
  public.procurement_supplier_receipt_cursor(),
  0::bigint,
  'empty receipt history starts at cursor zero'
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
  received_at,
  source_updated_at
) values (
  901,
  88,
  'WH/IN/00088',
  1,
  55,
  'P-55',
  'Product',
  77,
  'Supplier A',
  12,
  54.5,
  '2026-07-23T10:00:00Z',
  '2026-07-23T10:05:00Z'
);

select is(
  public.procurement_supplier_receipt_cursor(),
  901::bigint,
  'cursor returns the highest synchronized Odoo receipt line ID'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.procurement_supplier_receipt_cursor()',
    'execute'
  ),
  'anon cannot read the internal synchronization cursor'
);

select * from finish();
rollback;
