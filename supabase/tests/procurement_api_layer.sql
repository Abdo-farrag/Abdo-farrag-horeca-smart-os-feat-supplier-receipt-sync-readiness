begin;

select plan(14);

select has_function(
  'public',
  'procurement_calculate_recommendation',
  array['numeric', 'numeric', 'integer', 'integer', 'integer', 'numeric', 'text'],
  'approved recommendation calculator exists'
);
select has_function(
  'public',
  'procurement_install_api_views',
  array[]::text[],
  'API view installer exists'
);
select has_function(
  'public',
  'rpc_get_procurement_overview',
  'overview RPC exists'
);
select has_function(
  'public',
  'rpc_get_procurement_product_details',
  'product details RPC exists'
);
select has_function(
  'public',
  'rpc_get_supplier_review_queue',
  'supplier review queue RPC exists'
);
select has_function(
  'public',
  'rpc_review_supplier',
  'supplier decision RPC exists'
);
select has_function(
  'public',
  'rpc_bulk_approve_suppliers',
  'bulk supplier approval RPC exists'
);
select has_function(
  'public',
  'rpc_update_product_rule',
  'product rule update RPC exists'
);
select has_function(
  'public',
  'rpc_bulk_update_product_rules',
  'bulk product rule RPC exists'
);
select has_function(
  'public',
  'rpc_get_audit_log',
  'audit query RPC exists'
);
select has_function(
  'public',
  'rpc_undo_audit_event',
  'audit undo RPC exists'
);

select has_view('public', 'api_latest_supplier_receipt', 'latest supplier view exists');
select has_view('public', 'api_supplier_history', 'supplier history view exists');
select has_view('public', 'api_sync_status', 'sync status view exists');

select * from finish();
rollback;
