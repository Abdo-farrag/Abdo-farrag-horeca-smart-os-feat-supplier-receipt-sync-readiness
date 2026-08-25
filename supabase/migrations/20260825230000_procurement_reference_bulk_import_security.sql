-- Persist the exact normalized preview payload and expose only batch-based apply.
-- Odoo-synchronized tables remain untouched; all writes go to Supabase-owned overrides.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

alter table public.procurement_reference_import_batches
  add column if not exists normalized_rows jsonb not null default '[]'::jsonb
  check (jsonb_typeof(normalized_rows) = 'array');

do $$
begin
  if to_regprocedure(
    'public.record_procurement_reference_import_preview(text,text,text,uuid,text,integer,integer,integer,jsonb)'
  ) is not null then
    alter function public.record_procurement_reference_import_preview(
      text,text,text,uuid,text,integer,integer,integer,jsonb
    ) set schema private;
    alter function private.record_procurement_reference_import_preview(
      text,text,text,uuid,text,integer,integer,integer,jsonb
    ) rename to record_procurement_reference_import_preview_internal;
  end if;

  if to_regprocedure(
    'public.apply_procurement_reference_import(uuid,uuid,text,jsonb)'
  ) is not null then
    alter function public.apply_procurement_reference_import(uuid,uuid,text,jsonb)
      set schema private;
    alter function private.apply_procurement_reference_import(uuid,uuid,text,jsonb)
      rename to apply_procurement_reference_import_rows_internal;
  end if;
end
$$;

revoke all on all functions in schema private from public, anon, authenticated;

create or replace function public.record_procurement_reference_import_preview(
  p_original_filename text,
  p_file_checksum text,
  p_template_version text,
  p_actor_user_id uuid,
  p_actor_display_name text,
  p_total_rows integer,
  p_valid_rows integer,
  p_invalid_rows integer,
  p_rows jsonb,
  p_errors jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
set search_path = pg_catalog, public, private
as $$
declare
  v_batch_id uuid;
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'ROWS_MUST_BE_ARRAY';
  end if;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) <> p_valid_rows then
    raise exception 'IMPORT_ROW_COUNT_MISMATCH';
  end if;

  v_batch_id := private.record_procurement_reference_import_preview_internal(
    p_original_filename,
    p_file_checksum,
    p_template_version,
    p_actor_user_id,
    p_actor_display_name,
    p_total_rows,
    p_valid_rows,
    p_invalid_rows,
    p_errors
  );

  update public.procurement_reference_import_batches
  set normalized_rows = coalesce(p_rows, '[]'::jsonb),
      updated_at = now()
  where id = v_batch_id;

  return v_batch_id;
end;
$$;

create or replace function public.apply_procurement_reference_import(
  p_batch_id uuid,
  p_actor_user_id uuid,
  p_actor_display_name text
)
returns jsonb
language plpgsql
set search_path = pg_catalog, public, private
as $$
declare
  v_rows jsonb;
  v_invalid_rows integer;
  v_status text;
begin
  select normalized_rows, invalid_rows, status
  into v_rows, v_invalid_rows, v_status
  from public.procurement_reference_import_batches
  where id = p_batch_id
  for update;

  if not found then raise exception 'IMPORT_BATCH_NOT_FOUND'; end if;
  if v_status = 'APPLIED' then raise exception 'IMPORT_BATCH_ALREADY_APPLIED'; end if;
  if v_invalid_rows > 0 then raise exception 'IMPORT_HAS_BLOCKING_ERRORS'; end if;

  return private.apply_procurement_reference_import_rows_internal(
    p_batch_id,
    p_actor_user_id,
    p_actor_display_name,
    v_rows
  );
end;
$$;

revoke all on function public.record_procurement_reference_import_preview(
  text,text,text,uuid,text,integer,integer,integer,jsonb,jsonb
) from public, anon, authenticated;
revoke all on function public.apply_procurement_reference_import(
  uuid,uuid,text
) from public, anon, authenticated;
grant execute on function public.record_procurement_reference_import_preview(
  text,text,text,uuid,text,integer,integer,integer,jsonb,jsonb
) to service_role;
grant execute on function public.apply_procurement_reference_import(
  uuid,uuid,text
) to service_role;
grant usage on schema private to service_role;
grant execute on function private.record_procurement_reference_import_preview_internal(
  text,text,text,uuid,text,integer,integer,integer,jsonb
) to service_role;
grant execute on function private.apply_procurement_reference_import_rows_internal(
  uuid,uuid,text,jsonb
) to service_role;

-- Remove circular dependencies before the dashboard starts consuming effective values.
create or replace view public.api_procurement_effective_product_brands
with (security_invoker = true)
as
with products as (
  select source.product_code, min(source.product_name) as product_name
  from public.api_procurement_company_source source
  where source.product_code is not null
  group by source.product_code
)
select
  p.product_code,
  p.product_name,
  case
    when bo.product_code is not null and bo.active then bo.brand_id
    when bo.product_code is not null and not bo.active then null::bigint
    else pm.brand_id
  end as brand_id,
  case
    when bo.product_code is not null and bo.active then bo.brand_name
    when bo.product_code is not null and not bo.active then null::text
    else pm.brand_name
  end as brand_name,
  case
    when bo.product_code is not null and bo.active then bo.source
    when bo.product_code is not null and not bo.active then 'OVERRIDE_DISABLED'
    else 'ODOO_SYNC'
  end as effective_source,
  bo.import_batch_id,
  coalesce(bo.updated_at, pm.updated_at) as updated_at
from products p
left join public.procurement_product_brand_overrides bo
  on bo.product_code = p.product_code
left join public.procurement_product_purchase_metadata pm
  on pm.product_code = p.product_code;

create or replace view public.api_procurement_effective_product_vendors
with (security_invoker = true)
as
with companies(company_id) as (values (1::bigint), (2::bigint)),
odoo_expanded as (
  select
    c.company_id,
    vp.product_code,
    vp.supplier_id,
    null::text as supplier_product_code,
    null::text as purchase_uom_code,
    pm.purchase_uom_name,
    pm.order_multiple as pack_size,
    vp.minimum_qty,
    vp.price,
    coalesce(nullif(upper(btrim(vp.currency)), ''), 'EGP') as currency_code,
    vp.delay_days,
    vp.sequence,
    false as is_primary,
    true as active,
    'ODOO_SYNC'::text as effective_source,
    null::uuid as import_batch_id,
    vp.updated_at
  from public.procurement_product_vendor_prices vp
  join companies c on vp.company_id = c.company_id or vp.company_id is null
  left join public.procurement_product_purchase_metadata pm
    on pm.product_code = vp.product_code
)
select
  o.company_id, o.product_code, o.supplier_id, o.supplier_product_code,
  o.purchase_uom_code, o.purchase_uom_name, o.pack_size, o.minimum_qty,
  o.price, o.currency_code, o.delay_days, o.sequence, o.is_primary,
  o.active, o.source as effective_source, o.import_batch_id, o.updated_at
from public.procurement_product_vendor_overrides o
where o.active = true
union all
select
  s.company_id, s.product_code, s.supplier_id, s.supplier_product_code,
  s.purchase_uom_code, s.purchase_uom_name, s.pack_size, s.minimum_qty,
  s.price, s.currency_code, s.delay_days, s.sequence, s.is_primary,
  s.active, s.effective_source, s.import_batch_id, s.updated_at
from odoo_expanded s
where not exists (
  select 1
  from public.procurement_product_vendor_overrides o
  where o.company_id = s.company_id
    and o.product_code = s.product_code
    and o.supplier_id = s.supplier_id
);

create or replace view public.api_company_purchase_review_supplier_base
with (security_invoker = true)
as
with latest_external_receipts as (
  select distinct on (r.company_id, r.product_code)
    r.company_id, r.product_code, r.supplier_id, r.supplier_name,
    r.received_at, r.unit_cost
  from public.procurement_supplier_receipts r
  where r.received_qty > 0
    and r.supplier_id <> all (array[1::bigint, 2::bigint])
    and upper(btrim(r.supplier_name)) <> all (
      array['MAS'::text, 'HORECA SMART'::text, 'HORECA'::text, 'HORECA SMART OS'::text]
    )
  order by r.company_id, r.product_code, r.received_at desc, r.received_qty desc, r.id desc
)
select
  s.company_id,
  s.company_name,
  s.product_code,
  s.product_name,
  c.priority,
  s.free_qty,
  s.effective_daily_demand,
  c.actual_coverage_days as coverage_days,
  14::numeric as target_coverage_days,
  c.suggested_qty,
  r.approved_qty,
  coalesce(r.approved_supplier_id, ov.supplier_id, er.supplier_id, sr.approved_supplier_id) as supplier_id,
  coalesce(r.approved_supplier_name, ov.supplier_name, er.supplier_name, sr.approved_supplier_name) as supplier_name,
  case
    when r.approved_supplier_id is not null then 'FALLBACK_NEEDS_REVIEW'
    when ov.supplier_id is not null then 'FALLBACK_NEEDS_REVIEW'
    when er.supplier_id is not null then 'VERIFIED_RECEIPT'
    when sr.approved_supplier_id is not null then 'FALLBACK_NEEDS_REVIEW'
    else 'NEEDS_SUPPLIER'
  end as supplier_readiness,
  er.received_at as latest_receipt_at,
  coalesce(ov.price, er.unit_cost) as latest_unit_cost,
  case
    when coalesce(ov.price, er.unit_cost) is not null then
      round(
        coalesce(r.approved_qty, c.suggested_qty, 0::numeric)
        * coalesce(ov.price, er.unit_cost),
        2
      )
    else null::numeric
  end as estimated_value,
  coalesce(r.decision_status, 'NEW') as decision_status,
  r.buyer_note,
  coalesce(r.version, 0::bigint) as version,
  r.updated_at::text as source_updated_at,
  coalesce(r.decision_status, 'NEW') = 'APPROVED'
    and coalesce(r.approved_qty, 0::numeric) > 0
    and coalesce(r.approved_supplier_id, ov.supplier_id, er.supplier_id, sr.approved_supplier_id) is not null
    as ready_for_po
from public.api_procurement_company_source s
cross join lateral public.procurement_calculate_recommendation(
  s.effective_daily_demand, s.free_qty, 14, s.lead_time_days,
  s.safety_stock_days, s.order_multiple, s.data_status
) c
left join public.procurement_company_purchase_reviews r
  on r.company_id = s.company_id and r.product_code = s.product_code
left join latest_external_receipts er
  on er.company_id = s.company_id and er.product_code = s.product_code
left join public.procurement_supplier_reviews sr
  on sr.product_code = s.product_code
left join lateral (
  select
    v.supplier_id,
    sd.supplier_name,
    v.price
  from public.api_procurement_effective_product_vendors v
  join public.procurement_supplier_directory sd
    on sd.odoo_supplier_id = v.supplier_id
  where v.company_id = s.company_id
    and v.product_code = s.product_code
    and v.active = true
    and v.is_primary = true
  order by v.sequence asc, v.supplier_id asc
  limit 1
) ov on true;

create or replace view public.api_company_purchase_review
with (security_invoker = true)
as
select
  base.company_id,
  base.company_name,
  base.product_code,
  base.product_name,
  base.priority,
  base.free_qty,
  base.effective_daily_demand,
  base.coverage_days,
  base.target_coverage_days,
  base.suggested_qty,
  base.approved_qty,
  base.supplier_id,
  base.supplier_name,
  base.supplier_readiness,
  base.latest_receipt_at,
  base.latest_unit_cost,
  base.estimated_value,
  base.decision_status,
  base.buyer_note,
  base.version,
  base.source_updated_at,
  base.ready_for_po,
  brand.brand_id,
  brand.brand_name
from public.api_company_purchase_review_supplier_base base
left join public.api_procurement_effective_product_brands brand
  on brand.product_code = base.product_code;

create or replace function public.procurement_purchase_minimum_order_qty(
  p_company_id bigint,
  p_product_code text,
  p_supplier_id bigint
)
returns numeric
language sql
stable
set search_path = public, pg_temp
as $$
  select min(nullif(v.minimum_qty, 0))
  from public.api_procurement_effective_product_vendors v
  where v.company_id = p_company_id
    and v.product_code = btrim(p_product_code)
    and v.supplier_id = p_supplier_id
    and v.active = true;
$$;

create or replace function public.procurement_purchase_price_choice(
  p_company_id bigint,
  p_product_code text,
  p_supplier_id bigint,
  p_quantity numeric
)
returns table(
  unit_price numeric,
  price_source text,
  currency text,
  minimum_order_qty numeric
)
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  return query
  select
    v.price,
    case
      when v.effective_source = 'ODOO_SYNC' then 'ODOO_VENDOR_PRICE'::text
      else 'REFERENCE_OVERRIDE'::text
    end,
    v.currency_code,
    nullif(v.minimum_qty, 0)
  from public.api_procurement_effective_product_vendors v
  where v.company_id = p_company_id
    and v.product_code = btrim(p_product_code)
    and v.supplier_id = p_supplier_id
    and v.active = true
    and v.price is not null
  order by
    case when v.minimum_qty <= p_quantity then 0 else 1 end,
    case when v.minimum_qty <= p_quantity then v.minimum_qty end desc,
    v.minimum_qty asc,
    v.sequence asc,
    v.supplier_id asc
  limit 1;
  if found then return; end if;

  return query
  select r.unit_cost, 'SAME_SUPPLIER_RECEIPT'::text, null::text, null::numeric
  from public.procurement_supplier_receipts r
  where r.company_id = p_company_id
    and r.product_code = btrim(p_product_code)
    and r.supplier_id = p_supplier_id
    and r.received_qty > 0
    and r.unit_cost is not null
  order by r.received_at desc, r.id desc
  limit 1;
  if found then return; end if;

  return query
  select r.unit_cost, 'OTHER_SUPPLIER_REFERENCE'::text, null::text, null::numeric
  from public.procurement_supplier_receipts r
  where r.company_id = p_company_id
    and r.product_code = btrim(p_product_code)
    and r.supplier_id <> p_supplier_id
    and r.received_qty > 0
    and r.unit_cost is not null
  order by r.received_at desc, r.id desc
  limit 1;
  if found then return; end if;

  return query select null::numeric, 'MISSING'::text, null::text, null::numeric;
end;
$$;

revoke all on table public.procurement_product_vendor_overrides from anon, authenticated;
revoke all on table public.procurement_product_brand_overrides from anon, authenticated;
revoke all on table public.procurement_reference_import_batches from anon, authenticated;
revoke all on table public.procurement_reference_import_errors from anon, authenticated;
grant select, insert, update, delete on table public.procurement_product_vendor_overrides to service_role;
grant select, insert, update, delete on table public.procurement_product_brand_overrides to service_role;
grant select, insert, update, delete on table public.procurement_reference_import_batches to service_role;
grant select, insert, update, delete on table public.procurement_reference_import_errors to service_role;
grant select on table public.api_procurement_effective_product_vendors to service_role;
grant select on table public.api_procurement_effective_product_brands to service_role;
grant select on table public.api_procurement_product_reference_bulk_export to service_role;
