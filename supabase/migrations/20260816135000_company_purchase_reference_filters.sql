begin;

-- Preserve the canonical supplier projection as a private service-role base,
-- then enrich the public API projection with official Odoo brand metadata.
alter view public.api_company_purchase_review
  rename to api_company_purchase_review_supplier_base;

revoke all on table public.api_company_purchase_review_supplier_base
  from public, anon, authenticated;
grant select on table public.api_company_purchase_review_supplier_base
  to service_role;

create view public.api_company_purchase_review
with (security_invoker = true)
as
select
  base.*,
  metadata.brand_id,
  metadata.brand_name
from public.api_company_purchase_review_supplier_base base
left join public.procurement_product_purchase_metadata metadata
  on metadata.product_code = base.product_code;

revoke all on table public.api_company_purchase_review
  from public, anon, authenticated;
grant select on table public.api_company_purchase_review to service_role;

commit;
