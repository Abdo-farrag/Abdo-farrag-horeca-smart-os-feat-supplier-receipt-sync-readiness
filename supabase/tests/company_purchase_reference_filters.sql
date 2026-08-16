begin;

select plan(9);

select has_view(
  'public', 'api_company_purchase_review',
  'company purchase review API view exists'
);
select has_view(
  'public', 'api_company_purchase_review_supplier_base',
  'canonical supplier projection remains available as the private base'
);
select has_column(
  'public', 'api_company_purchase_review', 'brand_id',
  'review projection exposes the official Odoo brand id'
);
select has_column(
  'public', 'api_company_purchase_review', 'brand_name',
  'review projection exposes the official Odoo brand name'
);
select ok(
  (select reloptions @> array['security_invoker=true']
   from pg_class where oid = 'public.api_company_purchase_review'::regclass),
  'review projection uses security_invoker'
);
select ok(
  has_table_privilege('service_role', 'public.api_company_purchase_review', 'select'),
  'service_role can read the enriched review projection'
);
select ok(
  has_table_privilege(
    'service_role', 'public.api_company_purchase_review_supplier_base', 'select'
  ),
  'service_role can read the private supplier projection base'
);
select ok(
  has_table_privilege(
    'service_role', 'public.procurement_product_purchase_metadata', 'select'
  ),
  'service_role can resolve official Odoo brand metadata'
);
select ok(
  not has_table_privilege('anon', 'public.api_company_purchase_review', 'select'),
  'anon cannot read the enriched review projection directly'
);

select * from finish();
rollback;
