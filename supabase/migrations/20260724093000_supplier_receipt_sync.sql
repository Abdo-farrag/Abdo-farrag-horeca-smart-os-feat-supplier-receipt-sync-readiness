begin;

create or replace function public.procurement_supplier_receipt_cursor()
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(max(r.odoo_receipt_line_id), 0)::bigint
  from public.procurement_supplier_receipts r;
$$;

comment on function public.procurement_supplier_receipt_cursor() is
  'Returns the highest synchronized completed Odoo receipt line ID for idempotent incremental receipt sync.';

revoke all on function public.procurement_supplier_receipt_cursor()
  from public, anon, authenticated;
grant execute on function public.procurement_supplier_receipt_cursor()
  to service_role;

commit;
