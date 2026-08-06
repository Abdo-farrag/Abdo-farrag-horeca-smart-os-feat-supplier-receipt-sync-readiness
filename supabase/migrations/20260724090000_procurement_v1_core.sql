begin;

create table public.app_user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 2 and 120),
  role text not null check (role in ('reviewer', 'admin')),
  is_active boolean not null default true,
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete set null
);

comment on table public.app_user_roles is
  'Application authorization for Horeca Smart OS. An auth.users row alone grants no application access.';

create index app_user_roles_role_active_idx
  on public.app_user_roles (role, is_active)
  where is_active;

create table public.procurement_product_rules (
  product_code text primary key check (length(btrim(product_code)) between 1 and 120),
  lead_time_days integer not null default 4 check (lead_time_days between 0 and 90),
  safety_stock_days integer not null default 7 check (safety_stock_days between 0 and 60),
  order_multiple numeric not null default 1 check (order_multiple > 0),
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete set null
);

comment on table public.procurement_product_rules is
  'Global Procurement V1 rules by product code, shared across MAS and Horeca Smart.';

create table public.procurement_supplier_receipts (
  id bigint generated always as identity primary key,
  odoo_receipt_line_id bigint not null unique check (odoo_receipt_line_id > 0),
  receipt_id bigint not null check (receipt_id > 0),
  receipt_name text not null check (length(btrim(receipt_name)) between 1 and 160),
  company_id bigint not null check (company_id in (1, 2)),
  product_id bigint null check (product_id is null or product_id > 0),
  product_code text not null check (length(btrim(product_code)) between 1 and 120),
  product_name text not null check (length(btrim(product_name)) between 1 and 300),
  supplier_id bigint not null check (supplier_id > 0),
  supplier_name text not null check (length(btrim(supplier_name)) between 1 and 300),
  received_qty numeric not null check (received_qty > 0),
  unit_cost numeric null check (unit_cost is null or unit_cost >= 0),
  received_at timestamptz not null,
  source_updated_at timestamptz null,
  synced_at timestamptz not null default now()
);

comment on table public.procurement_supplier_receipts is
  'Completed incoming Odoo 18 receipt lines only; draft purchase orders are never written here.';

create index procurement_supplier_receipts_product_latest_idx
  on public.procurement_supplier_receipts
  (product_code, received_at desc, received_qty desc, supplier_id asc);

create index procurement_supplier_receipts_supplier_latest_idx
  on public.procurement_supplier_receipts
  (supplier_id, received_at desc);

create table public.procurement_supplier_reviews (
  product_code text primary key check (length(btrim(product_code)) between 1 and 120),
  approved_supplier_id bigint null check (approved_supplier_id is null or approved_supplier_id > 0),
  approved_supplier_name text null,
  status text not null default 'PENDING_REVIEW'
    check (status in ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'NEEDS_SUPPLIER')),
  note text null check (note is null or length(note) <= 500),
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete set null,
  constraint procurement_supplier_reviews_approved_pair_check check (
    (
      status = 'APPROVED'
      and approved_supplier_id is not null
      and approved_supplier_name is not null
      and length(btrim(approved_supplier_name)) > 0
    )
    or
    (
      status <> 'APPROVED'
      and approved_supplier_id is null
      and approved_supplier_name is null
    )
  )
);

comment on table public.procurement_supplier_reviews is
  'One supplier review state per product code, shared across both operating companies.';

create index procurement_supplier_reviews_status_idx
  on public.procurement_supplier_reviews (status, updated_at desc);

create table public.procurement_audit_events (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in (
    'SUPPLIER_APPROVED',
    'SUPPLIER_REJECTED',
    'SUPPLIER_CHANGED',
    'NEEDS_SUPPLIER',
    'UNDO',
    'PRODUCT_RULE_UPDATED',
    'PRODUCT_RULES_BULK_UPDATED',
    'USER_INVITED',
    'USER_ROLE_CHANGED',
    'USER_STATUS_CHANGED',
    'PASSWORD_RESET_REQUESTED',
    'OVERVIEW_LOGIN_SUCCEEDED',
    'OVERVIEW_LOGIN_FAILED',
    'EXPORT_CREATED',
    'RECALCULATION_FAILED'
  )),
  module text not null check (module in (
    'SUPPLIER_REVIEW',
    'PRODUCT_SETTINGS',
    'USERS',
    'AUTH',
    'EXPORT',
    'SYSTEM'
  )),
  entity_type text not null check (length(btrim(entity_type)) between 1 and 80),
  entity_key text not null check (length(btrim(entity_key)) between 1 and 160),
  actor_user_id uuid null references auth.users(id) on delete set null,
  actor_display_name text null,
  actor_role text null check (actor_role is null or actor_role in ('reviewer', 'admin', 'system')),
  old_data jsonb null,
  new_data jsonb null,
  note text null check (note is null or length(note) <= 500),
  batch_id uuid null,
  undo_of bigint null references public.procurement_audit_events(id) on delete restrict,
  request_id text not null check (length(btrim(request_id)) between 1 and 160),
  created_at timestamptz not null default now()
);

comment on table public.procurement_audit_events is
  'Immutable audit events for Procurement V1 mutations, access actions, exports, and undo operations.';

create index procurement_audit_events_entity_idx
  on public.procurement_audit_events
  (entity_type, entity_key, created_at desc);

create index procurement_audit_events_actor_idx
  on public.procurement_audit_events
  (actor_user_id, created_at desc);

create index procurement_audit_events_module_idx
  on public.procurement_audit_events
  (module, event_type, created_at desc);

create index procurement_audit_events_batch_idx
  on public.procurement_audit_events (batch_id)
  where batch_id is not null;

create unique index procurement_audit_events_single_undo_idx
  on public.procurement_audit_events (undo_of)
  where undo_of is not null;

create or replace function public.procurement_actor_role(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.role
  from public.app_user_roles r
  where r.user_id = p_user_id
    and r.is_active
  limit 1;
$$;

comment on function public.procurement_actor_role(uuid) is
  'Returns reviewer/admin only for active application users; otherwise returns null.';

alter table public.app_user_roles enable row level security;
alter table public.procurement_product_rules enable row level security;
alter table public.procurement_supplier_receipts enable row level security;
alter table public.procurement_supplier_reviews enable row level security;
alter table public.procurement_audit_events enable row level security;

revoke all on table public.app_user_roles from public, anon, authenticated;
revoke all on table public.procurement_product_rules from public, anon, authenticated;
revoke all on table public.procurement_supplier_receipts from public, anon, authenticated;
revoke all on table public.procurement_supplier_reviews from public, anon, authenticated;
revoke all on table public.procurement_audit_events from public, anon, authenticated, service_role;

revoke all on sequence public.procurement_supplier_receipts_id_seq from public, anon, authenticated;
revoke all on sequence public.procurement_audit_events_id_seq from public, anon, authenticated, service_role;

revoke all on function public.procurement_actor_role(uuid) from public, anon, authenticated;

grant select, insert, update, delete on table public.app_user_roles to service_role;
grant select, insert, update, delete on table public.procurement_product_rules to service_role;
grant select, insert, update, delete on table public.procurement_supplier_receipts to service_role;
grant select, insert, update, delete on table public.procurement_supplier_reviews to service_role;
grant select, insert on table public.procurement_audit_events to service_role;

grant usage, select on sequence public.procurement_supplier_receipts_id_seq to service_role;
grant usage, select on sequence public.procurement_audit_events_id_seq to service_role;
grant execute on function public.procurement_actor_role(uuid) to service_role;

commit;
