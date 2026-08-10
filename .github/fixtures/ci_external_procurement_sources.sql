-- CI-only bootstrap for database objects supplied by the Odoo ingestion project
-- in production. The workflow copies this file into supabase/migrations at run
-- time, before `supabase db start`; it is never part of the deployable migration
-- history and never runs against the live Supabase project.

create table public.sync_logs (
  id bigint generated always as identity primary key,
  sync_type text not null,
  status text not null,
  rows_count bigint not null default 0,
  message text null,
  started_at timestamptz not null default now(),
  finished_at timestamptz null
);

create view public.v_procurement_sync_status_latest
with (security_invoker = true)
as
select
  null::text as sync_type,
  null::text as status,
  null::bigint as rows_count,
  null::text as message,
  null::timestamptz as started_at,
  null::timestamptz as finished_at
where false;

create view public.v_procurement_recommendation_configurable
with (security_invoker = true)
as
select
  null::bigint as company_id,
  null::text as company_name,
  null::bigint as product_id,
  null::text as product_code,
  null::text as product_name,
  null::text as effective_product_name,
  null::numeric as available_quantity,
  null::numeric as effective_daily_demand,
  null::date as last_sale_date,
  null::timestamptz as snapshot_at,
  null::text as demand_method,
  null::numeric as manual_daily_demand,
  null::numeric as sales_qty_90d,
  null::numeric as free_qty,
  null::numeric as forecast_qty,
  null::numeric as lead_time_qty,
  null::numeric as safety_stock_qty,
  null::numeric as actual_coverage_days,
  null::integer as lead_time_days,
  null::integer as safety_stock_days,
  null::numeric as suggested_qty,
  null::text as priority,
  null::text as data_status,
  null::text as supplier_status,
  null::bigint as proposed_supplier_id,
  null::text as proposed_supplier_name,
  null::bigint as approved_supplier_id,
  null::text as approved_supplier_name,
  null::timestamptz as latest_receipt_at,
  null::bigint as version
where false;

alter table public.sync_logs enable row level security;

revoke all on table public.sync_logs from public, anon, authenticated;
revoke all on table public.v_procurement_sync_status_latest from public, anon, authenticated;
revoke all on table public.v_procurement_recommendation_configurable from public, anon, authenticated;

grant select, insert on table public.sync_logs to service_role;
grant select on table public.v_procurement_sync_status_latest to service_role;
grant select on table public.v_procurement_recommendation_configurable to service_role;
