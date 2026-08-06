begin;

-- ── Recommendation approval decisions ──
-- Each product recommendation gets one row, created lazily on first review action.

create table public.procurement_recommendation_approvals (
  product_code text primary key check (length(btrim(product_code)) between 1 and 120),
  approved_qty numeric null check (approved_qty is null or approved_qty >= 0),
  approved_supplier_id bigint null check (approved_supplier_id is null or approved_supplier_id > 0),
  approved_supplier_name text null,
  decision_status text not null default 'NEW'
    check (decision_status in ('NEW', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'DEFERRED')),
  buyer_note text null check (buyer_note is null or length(buyer_note) <= 1000),
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete set null,
  constraint procurement_approvals_approved_pair_check check (
    (decision_status = 'APPROVED' and approved_qty is not null)
    or (decision_status <> 'APPROVED')
  )
);

comment on table public.procurement_recommendation_approvals is
  'Procurement recommendation approval decisions, one per product. Optimistic concurrency via version.';

create or replace function public.rpc_approve_recommendation(
  p_product_code text,
  p_decision_status text,
  p_approved_qty numeric,
  p_approved_supplier_id bigint,
  p_approved_supplier_name text,
  p_buyer_note text,
  p_expected_version bigint,
  p_actor_user_id uuid,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_old public.procurement_recommendation_approvals;
  v_new public.procurement_recommendation_approvals;
  v_had_old boolean := false;
  v_actor public.app_user_roles;
begin
  v_actor := public.procurement_require_actor(p_actor_user_id, 'reviewer');

  if p_product_code is null or btrim(p_product_code) = '' then
    raise exception 'PRODUCT_CODE_REQUIRED';
  end if;
  if p_decision_status is null or p_decision_status not in ('NEW', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'DEFERRED') then
    raise exception 'INVALID_DECISION_STATUS';
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'INVALID_EXPECTED_VERSION';
  end if;
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'REQUEST_ID_REQUIRED';
  end if;
  if p_buyer_note is not null and length(p_buyer_note) > 1000 then
    raise exception 'BUYER_NOTE_TOO_LONG';
  end if;

  if p_decision_status = 'APPROVED' and (p_approved_qty is null or p_approved_qty < 0) then
    raise exception 'APPROVED_QTY_REQUIRED';
  end if;

  select *
  into v_old
  from public.procurement_recommendation_approvals r
  where r.product_code = btrim(p_product_code)
  for update;
  v_had_old := found;

  if v_had_old and v_old.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;
  if not v_had_old and p_expected_version <> 0 then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;

  insert into public.procurement_recommendation_approvals (
    product_code,
    approved_qty,
    approved_supplier_id,
    approved_supplier_name,
    decision_status,
    buyer_note,
    version,
    updated_at,
    updated_by
  ) values (
    btrim(p_product_code),
    p_approved_qty,
    p_approved_supplier_id,
    p_approved_supplier_name,
    p_decision_status,
    p_buyer_note,
    coalesce(v_old.version, 0) + 1,
    now(),
    p_actor_user_id
  )
  on conflict (product_code) do update set
    approved_qty = excluded.approved_qty,
    approved_supplier_id = excluded.approved_supplier_id,
    approved_supplier_name = excluded.approved_supplier_name,
    decision_status = excluded.decision_status,
    buyer_note = excluded.buyer_note,
    version = excluded.version,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by
  returning * into v_new;

  insert into public.procurement_audit_events (
    event_type,
    module,
    entity_type,
    entity_key,
    actor_user_id,
    actor_display_name,
    actor_role,
    old_data,
    new_data,
    note,
    request_id
  ) values (
    'RECOMMENDATION_' || v_new.decision_status,
    'RECOMMENDATION_REVIEW',
    'PRODUCT',
    v_new.product_code,
    v_actor.user_id,
    v_actor.display_name,
    v_actor.role,
    case when v_had_old then to_jsonb(v_old) else null end,
    to_jsonb(v_new),
    p_buyer_note,
    btrim(p_request_id)
  );

  return jsonb_build_object(
    'productCode', v_new.product_code,
    'approvedQty', v_new.approved_qty,
    'approvedSupplierId', v_new.approved_supplier_id,
    'approvedSupplierName', v_new.approved_supplier_name,
    'decisionStatus', v_new.decision_status,
    'buyerNote', v_new.buyer_note,
    'version', v_new.version,
    'updatedAt', v_new.updated_at
  );
end;
$function$;

-- ── Bulk update recommendations ──

create or replace function public.rpc_bulk_update_recommendations(
  p_items jsonb,
  p_decision_status text,
  p_buyer_note text,
  p_actor_user_id uuid,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor public.app_user_roles;
  v_item jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_batch_id uuid := gen_random_uuid();
begin
  v_actor := public.procurement_require_actor(p_actor_user_id, 'reviewer');

  if p_decision_status is null or p_decision_status not in ('NEW', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'DEFERRED') then
    raise exception 'INVALID_DECISION_STATUS';
  end if;
  if p_buyer_note is not null and length(p_buyer_note) > 1000 then
    raise exception 'BUYER_NOTE_TOO_LONG';
  end if;
  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 200 then
    raise exception 'INVALID_BULK_ITEMS';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    group by item ->> 'productCode'
    having count(*) > 1
  ) then
    raise exception 'DUPLICATE_PRODUCT_CODE';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_result := public.rpc_approve_recommendation(
      v_item ->> 'productCode',
      p_decision_status,
      (v_item ->> 'approvedQty')::numeric,
      nullif((v_item ->> 'approvedSupplierId')::bigint, 0)::bigint,
      v_item ->> 'approvedSupplierName',
      p_buyer_note,
      (v_item ->> 'expectedVersion')::bigint,
      p_actor_user_id,
      p_request_id
    );
    v_results := v_results || jsonb_build_array(v_result);
  end loop;

  return jsonb_build_object(
    'batchId', v_batch_id,
    'items', v_results
  );
end;
$function$;

-- Create a view that joins recommendations with approval decisions
create or replace view public.v_recommendation_approvals as
select
  o.product_code,
  o.product_name,
  o.free_qty,
  o.effective_daily_demand,
  o.forecast_qty,
  o.lead_time_qty,
  o.safety_stock_qty,
  o.actual_coverage_days,
  o.lead_time_days,
  o.safety_stock_days,
  o.suggested_qty,
  o.priority,
  o.data_status,
  o.supplier_status,
  o.proposed_supplier_id,
  o.proposed_supplier_name,
  o.approved_supplier_id as existing_approved_supplier_id,
  o.approved_supplier_name as existing_approved_supplier_name,
  o.latest_receipt_at,
  o.version as product_version,
  a.approved_qty,
  a.approved_supplier_id as review_approved_supplier_id,
  a.approved_supplier_name as review_approved_supplier_name,
  a.decision_status,
  a.buyer_note,
  a.updated_at as review_updated_at,
  a.updated_by as review_updated_by,
  coalesce(a.version, 0) as approval_version
from public.v_procurement_recommendation_configurable o
left join public.procurement_recommendation_approvals a
  on a.product_code = o.product_code;

-- ── RLS: revoke all from public/anonymous, grant only to service_role ──

alter table public.procurement_recommendation_approvals enable row level security;

revoke all on table public.procurement_recommendation_approvals
  from public, anon, authenticated;
revoke all on function public.rpc_approve_recommendation(
  text, text, numeric, bigint, text, text, bigint, uuid, text
) from public, anon, authenticated;
revoke all on function public.rpc_bulk_update_recommendations(
  jsonb, text, text, uuid, text
) from public, anon, authenticated;
revoke all on view public.v_recommendation_approvals
  from public, anon, authenticated;

grant select, insert, update, delete on table public.procurement_recommendation_approvals
  to service_role;
grant execute on function public.rpc_approve_recommendation(
  text, text, numeric, bigint, text, text, bigint, uuid, text
) to service_role;
grant execute on function public.rpc_bulk_update_recommendations(
  jsonb, text, text, uuid, text
) to service_role;
grant select on view public.v_recommendation_approvals
  to service_role;

commit;
