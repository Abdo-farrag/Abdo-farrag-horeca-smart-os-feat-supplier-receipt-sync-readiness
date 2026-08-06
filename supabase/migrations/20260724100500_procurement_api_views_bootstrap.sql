begin;

create or replace view public.api_latest_supplier_receipt
with (security_invoker = true)
as
select distinct on (r.product_code)
  r.product_code,
  r.supplier_id,
  r.supplier_name,
  r.received_at,
  r.received_qty,
  r.unit_cost,
  r.company_id
from public.procurement_supplier_receipts r
order by
  r.product_code,
  r.received_at desc,
  r.received_qty desc,
  r.supplier_id asc;

create or replace view public.api_supplier_history
with (security_invoker = true)
as
with ranked as (
  select
    r.*,
    row_number() over (
      partition by r.product_code, r.supplier_id, r.company_id
      order by r.received_at desc, r.received_qty desc, r.odoo_receipt_line_id desc
    ) as receipt_rank,
    count(*) over (
      partition by r.product_code, r.supplier_id, r.company_id
    ) as receipts_count
  from public.procurement_supplier_receipts r
)
select
  product_code,
  supplier_id,
  supplier_name,
  company_id,
  received_at as latest_receipt_at,
  receipts_count,
  received_qty as latest_received_qty,
  unit_cost as latest_unit_cost
from ranked
where receipt_rank = 1;

create or replace view public.api_sync_status
with (security_invoker = true)
as
select
  null::text as sync_type,
  null::text as status,
  null::integer as rows_count,
  null::text as message,
  null::timestamptz as started_at,
  null::timestamptz as finished_at,
  null::text as freshness_status
where false;

comment on view public.api_sync_status is
  'Bootstrap contract view. procurement_install_api_views() replaces it with live legacy sync sources during deployment.';

revoke all on public.api_latest_supplier_receipt from public, anon, authenticated;
revoke all on public.api_supplier_history from public, anon, authenticated;
revoke all on public.api_sync_status from public, anon, authenticated;

grant select on public.api_latest_supplier_receipt to service_role;
grant select on public.api_supplier_history to service_role;
grant select on public.api_sync_status to service_role;

commit;
