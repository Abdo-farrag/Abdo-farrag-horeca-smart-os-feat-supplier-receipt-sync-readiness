begin;

select plan(22);

insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');

insert into public.app_user_roles (user_id, display_name, role) values
  ('11111111-1111-1111-1111-111111111111', 'Test Reviewer', 'reviewer'),
  ('22222222-2222-2222-2222-222222222222', 'Test Admin', 'admin');

insert into public.procurement_supplier_receipts (
  odoo_receipt_line_id, receipt_id, receipt_name, company_id,
  product_id, product_code, product_name, supplier_id, supplier_name,
  received_qty, unit_cost, received_at
) values
  (91001, 81001, 'WH/IN/91001', 1, 71001, 'TX-SKU-1', 'Transaction Product 1', 501, 'Supplier One', 10, 100, '2026-07-20T08:00:00Z'),
  (91002, 81002, 'WH/IN/91002', 1, 71001, 'TX-SKU-1', 'Transaction Product 1', 502, 'Supplier Two', 20, 95, '2026-07-21T08:00:00Z'),
  (91003, 81003, 'WH/IN/91003', 2, 71002, 'TX-SKU-2', 'Transaction Product 2', 503, 'Supplier Three', 15, 75, '2026-07-22T08:00:00Z'),
  (91004, 81004, 'WH/IN/91004', 1, 71003, 'TX-SKU-3', 'Transaction Product 3', 504, 'Supplier Four', 12, 80, '2026-07-23T08:00:00Z');

select lives_ok(
  $$select public.rpc_review_supplier(
    'TX-SKU-1', 'approve', 502, 'Supplier Two', 0, 'Approved in test',
    '11111111-1111-1111-1111-111111111111', 'reviewer', 'req-approve-1'
  )$$,
  'reviewer can approve a supplier from product receipt history'
);

select is(
  (select status from public.procurement_supplier_reviews where product_code = 'TX-SKU-1'),
  'APPROVED',
  'supplier review becomes approved'
);

select is(
  (select approved_supplier_id from public.procurement_supplier_reviews where product_code = 'TX-SKU-1'),
  502::bigint,
  'approved supplier is persisted'
);

select is(
  (select version from public.procurement_supplier_reviews where product_code = 'TX-SKU-1'),
  1::bigint,
  'supplier review version increments atomically'
);

select is(
  (select count(*)::integer from public.procurement_audit_events where request_id = 'req-approve-1'),
  1,
  'approval writes exactly one audit event'
);

select is(
  (select event_type from public.procurement_audit_events where request_id = 'req-approve-1'),
  'SUPPLIER_APPROVED',
  'approval audit event has the correct action'
);

select throws_ok(
  $$select public.rpc_review_supplier(
    'TX-SKU-1', 'reject', null, null, 0, 'stale version',
    '11111111-1111-1111-1111-111111111111', 'reviewer', 'req-conflict-1'
  )$$,
  '40001',
  'VERSION_CONFLICT',
  'stale supplier review version is rejected'
);

select is(
  (select count(*)::integer from public.procurement_audit_events where request_id = 'req-conflict-1'),
  0,
  'version conflict writes no audit event'
);

select throws_ok(
  $$select public.rpc_review_supplier(
    'TX-SKU-1', 'change-supplier', 9999, 'Unknown Supplier', 1, null,
    '11111111-1111-1111-1111-111111111111', 'reviewer', 'req-invalid-supplier'
  )$$,
  'P0001',
  'SUPPLIER_NOT_IN_PRODUCT_HISTORY',
  'supplier outside product history is rejected'
);

select is(
  (select count(*)::integer from public.procurement_audit_events where request_id = 'req-invalid-supplier'),
  0,
  'failed supplier change is fully rolled back'
);

select lives_ok(
  $$select public.rpc_bulk_approve_suppliers(
    '[{"productCode":"TX-SKU-2","supplierId":503,"supplierName":"Supplier Three","expectedVersion":0},{"productCode":"TX-SKU-3","supplierId":504,"supplierName":"Supplier Four","expectedVersion":0}]'::jsonb,
    '11111111-1111-1111-1111-111111111111', 'reviewer', 'req-bulk-1'
  )$$,
  'bulk approval succeeds for valid pending products'
);

select is(
  (select count(*)::integer from public.procurement_supplier_reviews where product_code in ('TX-SKU-2', 'TX-SKU-3') and status = 'APPROVED'),
  2,
  'bulk approval updates every selected product'
);

select is(
  (select count(distinct batch_id)::integer from public.procurement_audit_events where request_id = 'req-bulk-1'),
  1,
  'bulk approval audit events share one batch id'
);

select is(
  (select count(*)::integer from public.procurement_audit_events where request_id = 'req-bulk-1'),
  2,
  'bulk approval writes one audit event per product'
);

select lives_ok(
  $$select public.rpc_update_product_rule(
    'TX-RULE-1', 6, 9, 0, 'Rule test',
    '22222222-2222-2222-2222-222222222222', 'req-rule-1'
  )$$,
  'admin can create a product procurement rule'
);

select is(
  (select version from public.procurement_product_rules where product_code = 'TX-RULE-1'),
  1::bigint,
  'new product rule starts at version one'
);

select throws_ok(
  $$select public.rpc_update_product_rule(
    'TX-RULE-1', 7, 10, 0, 'stale rule',
    '22222222-2222-2222-2222-222222222222', 'req-rule-conflict'
  )$$,
  '40001',
  'VERSION_CONFLICT',
  'stale product rule update is rejected'
);

select lives_ok(
  format(
    'select public.rpc_undo_audit_event(%s, %L::uuid, %L, %L)',
    (select id from public.procurement_audit_events where request_id = 'req-approve-1'),
    '22222222-2222-2222-2222-222222222222',
    'Undo approval test',
    'req-undo-1'
  ),
  'admin can undo the latest compatible supplier approval'
);

select is(
  (select count(*)::integer from public.procurement_supplier_reviews where product_code = 'TX-SKU-1'),
  0,
  'undo restores the pre-approval state when no prior review existed'
);

select is(
  (select count(*)::integer from public.procurement_audit_events where request_id in ('req-approve-1', 'req-undo-1')),
  2,
  'undo preserves original audit event and appends a new event'
);

select is(
  (select undo_of from public.procurement_audit_events where request_id = 'req-undo-1'),
  (select id from public.procurement_audit_events where request_id = 'req-approve-1'),
  'undo event points to the immutable original event'
);

select throws_ok(
  format(
    'select public.rpc_undo_audit_event(%s, %L::uuid, %L, %L)',
    (select id from public.procurement_audit_events where request_id = 'req-approve-1'),
    '22222222-2222-2222-2222-222222222222',
    'Second undo',
    'req-undo-2'
  ),
  '40001',
  'AUDIT_EVENT_ALREADY_UNDONE',
  'the same audit event cannot be undone twice'
);

select * from finish();
rollback;
