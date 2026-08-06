begin;

select plan(18);

select ok(
  not has_function_privilege('anon', 'public.rpc_review_supplier(text,text,bigint,text,bigint,text,uuid,text,text)', 'execute'),
  'anon cannot review suppliers'
);
select ok(
  not has_function_privilege('authenticated', 'public.rpc_review_supplier(text,text,bigint,text,bigint,text,uuid,text,text)', 'execute'),
  'authenticated browser users cannot review suppliers directly'
);
select ok(
  has_function_privilege('service_role', 'public.rpc_review_supplier(text,text,bigint,text,bigint,text,uuid,text,text)', 'execute'),
  'service role can review suppliers'
);

select ok(
  not has_function_privilege('anon', 'public.rpc_bulk_approve_suppliers(jsonb,uuid,text,text)', 'execute'),
  'anon cannot bulk approve suppliers'
);
select ok(
  not has_function_privilege('authenticated', 'public.rpc_bulk_approve_suppliers(jsonb,uuid,text,text)', 'execute'),
  'authenticated browser users cannot bulk approve suppliers directly'
);
select ok(
  has_function_privilege('service_role', 'public.rpc_bulk_approve_suppliers(jsonb,uuid,text,text)', 'execute'),
  'service role can bulk approve suppliers'
);

select ok(
  not has_function_privilege('anon', 'public.rpc_update_product_rule(text,integer,integer,bigint,text,uuid,text)', 'execute'),
  'anon cannot update product rules'
);
select ok(
  not has_function_privilege('authenticated', 'public.rpc_update_product_rule(text,integer,integer,bigint,text,uuid,text)', 'execute'),
  'authenticated browser users cannot update product rules directly'
);
select ok(
  has_function_privilege('service_role', 'public.rpc_update_product_rule(text,integer,integer,bigint,text,uuid,text)', 'execute'),
  'service role can update product rules'
);

select ok(
  not has_function_privilege('anon', 'public.rpc_bulk_update_product_rules(jsonb,jsonb,text,uuid,text)', 'execute'),
  'anon cannot bulk update product rules'
);
select ok(
  not has_function_privilege('authenticated', 'public.rpc_bulk_update_product_rules(jsonb,jsonb,text,uuid,text)', 'execute'),
  'authenticated browser users cannot bulk update product rules directly'
);
select ok(
  has_function_privilege('service_role', 'public.rpc_bulk_update_product_rules(jsonb,jsonb,text,uuid,text)', 'execute'),
  'service role can bulk update product rules'
);

select ok(
  not has_function_privilege('anon', 'public.rpc_get_audit_log(uuid,timestamptz,timestamptz,uuid,text[],text[],text,text,boolean,boolean,text,integer,integer)', 'execute'),
  'anon cannot read the audit log RPC'
);
select ok(
  not has_function_privilege('authenticated', 'public.rpc_get_audit_log(uuid,timestamptz,timestamptz,uuid,text[],text[],text,text,boolean,boolean,text,integer,integer)', 'execute'),
  'authenticated browser users cannot read the audit log RPC directly'
);
select ok(
  has_function_privilege('service_role', 'public.rpc_get_audit_log(uuid,timestamptz,timestamptz,uuid,text[],text[],text,text,boolean,boolean,text,integer,integer)', 'execute'),
  'service role can query the audit log'
);

select ok(
  not has_function_privilege('anon', 'public.rpc_undo_audit_event(bigint,uuid,text,text)', 'execute'),
  'anon cannot undo audit events'
);
select ok(
  not has_function_privilege('authenticated', 'public.rpc_undo_audit_event(bigint,uuid,text,text)', 'execute'),
  'authenticated browser users cannot undo audit events directly'
);
select ok(
  has_function_privilege('service_role', 'public.rpc_undo_audit_event(bigint,uuid,text,text)', 'execute'),
  'service role can invoke undo after backend authorization'
);

select * from finish();
rollback;
