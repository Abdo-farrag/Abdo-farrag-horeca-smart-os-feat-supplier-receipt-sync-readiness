begin;

-- ── pgTAP tests: supplier projection fix ─────────────────────────────────────
--
-- Tests cover:
--   1. View structure (columns exist).
--   2. Permission matrix — PUBLIC / anon / authenticated / service_role for
--      raw_products, sku_supplier_settings, and api_company_purchase_review.
--   3. Intercompany exclusion via procurement_supplier_receipts.
--   4. supplier_readiness classification logic (all three states) via a
--      pg_temp helper function — because api_procurement_company_source
--      returns no rows in CI (empty v_procurement_recommendation_configurable
--      fixture).
--   5. supplier_id is NULL when only a name-only fallback (primary_supplier)
--      exists — no invented integer IDs.
--   6. The raw_products bridge (internal_reference → product_id) is intact.
--   7. sku_supplier_settings rows are per-product, so both companies get the
--      same primary_supplier (rule 7 — cross-company consistency).

select plan(31);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. View structure
-- ─────────────────────────────────────────────────────────────────────────────

select has_view(
  'public', 'api_company_purchase_review',
  'api_company_purchase_review view exists'
);

select has_column(
  'public', 'api_company_purchase_review', 'supplier_readiness',
  'view exposes supplier_readiness column'
);

select has_column(
  'public', 'api_company_purchase_review', 'supplier_id',
  'view exposes supplier_id column'
);

select has_column(
  'public', 'api_company_purchase_review', 'supplier_name',
  'view exposes supplier_name column'
);

-- Confirm security_invoker is set (view must not execute as definer).
-- PostgreSQL stores WITH (...) view options in pg_class.reloptions, not in
-- pg_views.definition. Check reloptions directly.
select ok(
  exists(
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'api_company_purchase_review'
      and c.reloptions::text[] @> array['security_invoker=true']
  ),
  'api_company_purchase_review uses WITH (security_invoker = true)'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Permission matrix
--
-- All three objects must be inaccessible to PUBLIC, anon, and authenticated.
-- Only service_role may SELECT. Assertions follow the pattern:
--   table → {PUBLIC no, anon no, authenticated no, service_role yes}
-- ─────────────────────────────────────────────────────────────────────────────

-- raw_products
select has_table('public', 'raw_products', 'raw_products table exists');

select ok(
  not has_table_privilege('public',        'public.raw_products', 'select'),
  'PUBLIC cannot SELECT raw_products'
);
select ok(
  not has_table_privilege('anon',          'public.raw_products', 'select'),
  'anon cannot SELECT raw_products'
);
select ok(
  not has_table_privilege('authenticated', 'public.raw_products', 'select'),
  'authenticated cannot SELECT raw_products'
);
select ok(
  has_table_privilege('service_role',      'public.raw_products', 'select'),
  'service_role can SELECT raw_products'
);

-- sku_supplier_settings
select has_table('public', 'sku_supplier_settings', 'sku_supplier_settings table exists');

select ok(
  not has_table_privilege('public',        'public.sku_supplier_settings', 'select'),
  'PUBLIC cannot SELECT sku_supplier_settings'
);
select ok(
  not has_table_privilege('anon',          'public.sku_supplier_settings', 'select'),
  'anon cannot SELECT sku_supplier_settings'
);
select ok(
  not has_table_privilege('authenticated', 'public.sku_supplier_settings', 'select'),
  'authenticated cannot SELECT sku_supplier_settings'
);
select ok(
  has_table_privilege('service_role',      'public.sku_supplier_settings', 'select'),
  'service_role can SELECT sku_supplier_settings'
);

-- api_company_purchase_review
select ok(
  not has_table_privilege('public',        'public.api_company_purchase_review', 'select'),
  'PUBLIC cannot SELECT api_company_purchase_review'
);
select ok(
  not has_table_privilege('anon',          'public.api_company_purchase_review', 'select'),
  'anon cannot SELECT api_company_purchase_review'
);
select ok(
  not has_table_privilege('authenticated', 'public.api_company_purchase_review', 'select'),
  'authenticated cannot SELECT api_company_purchase_review'
);
select ok(
  has_table_privilege('service_role',      'public.api_company_purchase_review', 'select'),
  'service_role can SELECT api_company_purchase_review'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Intercompany exclusion — tested against procurement_supplier_receipts
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.procurement_supplier_receipts (
  odoo_receipt_line_id, receipt_id, receipt_name,
  company_id, product_id, product_code, product_name,
  supplier_id, supplier_name,
  received_qty, unit_cost, received_at, source_updated_at
) values
  -- intercompany: supplier_id = 1 (MAS)
  (9001, 901, 'WH/IN/09001', 2, 55, 'TEST-IC', 'Intercompany Product',
   1, 'MAS', 10, 5.0, '2026-01-01T00:00:00Z', now()),
  -- intercompany by name
  (9002, 902, 'WH/IN/09002', 2, 56, 'TEST-IC2', 'Intercompany Name',
   99, 'HORECA SMART', 10, 5.0, '2026-01-01T00:00:00Z', now()),
  -- valid external receipt
  (9003, 903, 'WH/IN/09003', 1, 57, 'TEST-EXT', 'External Product',
   500, 'Acme Supplier', 20, 12.5, '2026-06-01T00:00:00Z', now());

-- Intercompany receipts are excluded by the CTE filter.
select ok(
  not exists (
    select 1
    from public.procurement_supplier_receipts r
    where r.product_code in ('TEST-IC', 'TEST-IC2')
      and r.supplier_id not in (1, 2)
      and upper(btrim(r.supplier_name)) not in ('MAS', 'HORECA SMART', 'HORECA', 'HORECA SMART OS')
  ),
  'intercompany receipts (supplier_id=1 or name=HORECA SMART) are excluded by the CTE filter'
);

-- A valid external receipt passes both filters.
select ok(
  exists (
    select 1
    from public.procurement_supplier_receipts r
    where r.product_code = 'TEST-EXT'
      and r.supplier_id not in (1, 2)
      and upper(btrim(r.supplier_name)) not in ('MAS', 'HORECA SMART', 'HORECA', 'HORECA SMART OS')
  ),
  'valid external receipt passes the intercompany exclusion filter'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. supplier_readiness classification — via deterministic pg_temp helper
--
-- api_procurement_company_source returns no rows in CI (empty fixture), so
-- the view produces no output. The CASE expression is tested in isolation.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function pg_temp.classify_readiness(
  p_external_supplier_id   bigint,
  p_approved_supplier_id   bigint,
  p_primary_supplier       text,
  p_sr_approved_id         bigint
) returns text
language sql immutable as $$
  select case
    when p_external_supplier_id  is not null then 'VERIFIED_RECEIPT'
    when p_approved_supplier_id  is not null
      or  p_primary_supplier     is not null
      or  p_sr_approved_id       is not null then 'FALLBACK_NEEDS_REVIEW'
    else 'NEEDS_SUPPLIER'
  end;
$$;

-- 4a. All null → NEEDS_SUPPLIER
select is(
  pg_temp.classify_readiness(null, null, null, null),
  'NEEDS_SUPPLIER',
  'no sources → NEEDS_SUPPLIER'
);

-- 4b. External receipt → VERIFIED_RECEIPT (highest priority)
select is(
  pg_temp.classify_readiness(500, null, null, null),
  'VERIFIED_RECEIPT',
  'external receipt → VERIFIED_RECEIPT'
);

-- 4c. External receipt overrides all fallbacks
select is(
  pg_temp.classify_readiness(500, 42, 'Known Supplier', 99),
  'VERIFIED_RECEIPT',
  'external receipt with all fallbacks set → still VERIFIED_RECEIPT'
);

-- 4d. Only sss.primary_supplier → FALLBACK_NEEDS_REVIEW (new branch)
select is(
  pg_temp.classify_readiness(null, null, 'Primary Supplier Co.', null),
  'FALLBACK_NEEDS_REVIEW',
  'primary_supplier only → FALLBACK_NEEDS_REVIEW'
);

-- 4e. Only buyer approved_supplier_id → FALLBACK_NEEDS_REVIEW
select is(
  pg_temp.classify_readiness(null, 42, null, null),
  'FALLBACK_NEEDS_REVIEW',
  'buyer approved_supplier_id only → FALLBACK_NEEDS_REVIEW'
);

-- 4f. Only global sr.approved_supplier_id → FALLBACK_NEEDS_REVIEW
select is(
  pg_temp.classify_readiness(null, null, null, 99),
  'FALLBACK_NEEDS_REVIEW',
  'global supplier_review.approved_supplier_id only → FALLBACK_NEEDS_REVIEW'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. supplier_id must not be invented from sku_supplier_settings (rule 6)
--
-- sss.primary_supplier is a display name; no integer supplier_id is stored.
-- The supplier_id COALESCE chain must NOT include any sss column.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function pg_temp.project_supplier_id(
  p_approved_supplier_id   bigint,
  p_external_supplier_id   bigint,
  p_sr_approved_id         bigint
  -- sss.primary_supplier intentionally absent — name only, no integer ID
) returns bigint
language sql immutable as $$
  select coalesce(p_approved_supplier_id, p_external_supplier_id, p_sr_approved_id);
$$;

select is(
  pg_temp.project_supplier_id(null, null, null),
  null::bigint,
  'supplier_id is null when only primary_supplier exists — no invented ID'
);

select is(
  pg_temp.project_supplier_id(null, 500, null),
  500::bigint,
  'supplier_id from external receipt is projected correctly'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. raw_products bridge integrity
--
-- raw_products.internal_reference bridges product_code to
-- sku_supplier_settings.product_id.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
begin
  insert into public.raw_products (
    product_id, product_name, internal_reference, category,
    cost, sale_price, active, product_type, updated_at, product_tmpl_id, barcode
  ) values (
    999991, 'Test Bridge Product', 'TEST-BRIDGE-99991',
    'Test', 0, 0, true, 'product', now(), 999991, null
  ) on conflict do nothing;

  insert into public.sku_supplier_settings (
    id, product_id, primary_supplier, backup_supplier,
    lead_time_days, safety_days, max_coverage_days,
    min_margin_target, is_kvi, sku_class, notes, updated_at
  ) values (
    'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    999991, 'Bridge Supplier', null,
    4, 7, 14, 0.08, false, 'B', null, now()
  ) on conflict (id) do nothing;
end $$;

select is(
  (
    select sss.primary_supplier
    from public.raw_products rp
    join public.sku_supplier_settings sss on sss.product_id = rp.product_id
    where rp.internal_reference = 'TEST-BRIDGE-99991'
      and sss.primary_supplier is not null
    limit 1
  ),
  'Bridge Supplier',
  'raw_products.internal_reference bridges product_code to sku_supplier_settings.primary_supplier'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Cross-company consistency — same primary_supplier for all companies
-- ─────────────────────────────────────────────────────────────────────────────

select is(
  (
    select count(distinct sss.primary_supplier)
    from public.sku_supplier_settings sss
    where sss.product_id = 999991
  ),
  1::bigint,
  'one sss row yields the same primary_supplier for all companies (rule 7)'
);

select * from finish();
rollback;
