begin;

-- Read-only purchasing reference data synchronized from Odoo. These tables are
-- not canonical buyer decisions and are never writable from a browser role.

create table public.procurement_supplier_directory (
  odoo_supplier_id bigint primary key check (odoo_supplier_id > 0),
  supplier_name text not null check (length(btrim(supplier_name)) between 1 and 300),
  supplier_code text null check (
    supplier_code is null or length(btrim(supplier_code)) between 1 and 120
  ),
  active boolean not null,
  supplier_rank integer not null check (supplier_rank >= 0),
  source_updated_at timestamptz null,
  synced_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.procurement_supplier_directory is
  'Odoo res.partner purchasing directory. UI options are active rows with supplier_rank > 0.';

create index procurement_supplier_directory_name_idx
  on public.procurement_supplier_directory (lower(supplier_name));
create index procurement_supplier_directory_code_idx
  on public.procurement_supplier_directory (lower(supplier_code))
  where supplier_code is not null;

create table public.procurement_product_purchase_metadata (
  product_code text primary key check (length(btrim(product_code)) between 1 and 120),
  odoo_product_id bigint null check (odoo_product_id is null or odoo_product_id > 0),
  odoo_product_tmpl_id bigint null check (
    odoo_product_tmpl_id is null or odoo_product_tmpl_id > 0
  ),
  brand_id bigint null check (brand_id is null or brand_id > 0),
  brand_name text null check (
    brand_name is null or length(btrim(brand_name)) between 1 and 200
  ),
  purchase_uom_id bigint null check (purchase_uom_id is null or purchase_uom_id > 0),
  purchase_uom_name text null check (
    purchase_uom_name is null or length(btrim(purchase_uom_name)) between 1 and 120
  ),
  order_multiple numeric null check (order_multiple is null or order_multiple > 0),
  source_updated_at timestamptz null,
  synced_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.procurement_product_purchase_metadata is
  'Trusted Odoo product/vendor purchasing metadata used to snapshot purchase draft lines.';

create index procurement_product_purchase_metadata_brand_idx
  on public.procurement_product_purchase_metadata (lower(brand_name))
  where brand_name is not null;
create table public.procurement_product_vendor_prices (
  product_code text not null references public.procurement_product_purchase_metadata(product_code)
    on update cascade on delete cascade,
  supplier_id bigint not null check (supplier_id > 0),
  minimum_qty numeric not null default 0 check (minimum_qty >= 0),
  price numeric not null check (price >= 0),
  currency text null check (
    currency is null or length(btrim(currency)) between 1 and 12
  ),
  delay_days integer null check (delay_days is null or delay_days >= 0),
  sequence integer not null default 10 check (sequence >= 0),
  source_updated_at timestamptz null,
  synced_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (product_code, supplier_id, minimum_qty)
);

comment on table public.procurement_product_vendor_prices is
  'Odoo product supplierinfo tiers; preserves supplier-specific MOQ and price choices.';

create index procurement_product_vendor_prices_supplier_idx
  on public.procurement_product_vendor_prices (supplier_id, product_code);

create view public.api_procurement_supplier_directory
with (security_invoker = true)
as
select
  odoo_supplier_id as supplier_id,
  supplier_name,
  supplier_code,
  supplier_rank,
  active,
  source_updated_at
from public.procurement_supplier_directory
where active = true
  and supplier_rank > 0;

create view public.api_procurement_brand_options
with (security_invoker = true)
as
select
  brand_id,
  brand_name,
  count(*)::bigint as product_count
from public.procurement_product_purchase_metadata
where brand_name is not null
group by brand_id, brand_name;

alter table public.procurement_supplier_directory enable row level security;
alter table public.procurement_product_purchase_metadata enable row level security;
alter table public.procurement_product_vendor_prices enable row level security;

revoke all on table public.procurement_supplier_directory
  from public, anon, authenticated;
revoke all on table public.procurement_product_purchase_metadata
  from public, anon, authenticated;
revoke all on table public.procurement_product_vendor_prices
  from public, anon, authenticated;
revoke all on table public.api_procurement_supplier_directory
  from public, anon, authenticated;
revoke all on table public.api_procurement_brand_options
  from public, anon, authenticated;

grant select, insert, update, delete on table public.procurement_supplier_directory
  to service_role;
grant select, insert, update, delete on table public.procurement_product_purchase_metadata
  to service_role;
grant select, insert, update, delete on table public.procurement_product_vendor_prices
  to service_role;
grant select on table public.api_procurement_supplier_directory
  to service_role;
grant select on table public.api_procurement_brand_options
  to service_role;

commit;
