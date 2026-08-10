begin;

-- ── Company purchase review decisions ──
-- Independent purchase reviews for MAS (company_id=1) and Horeca Smart (company_id=2).

create table public.procurement_company_purchase_reviews (
  company_id bigint not null check (company_id in (1, 2)),
  product_code text not null check (length(btrim(product_code)) between 1 and 120),
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
  primary key (company_id, product_code),
  constraint procurement_company_purchase_reviews_approved_check check (
    (decision_status = 'APPROVED' and approved_qty is not null and approved_qty > 0)
    or (decision_status <> 'APPROVED')
  )
);

comment on table public.procurement_company_purchase_reviews is
  'Independent company procurement purchase reviews for MAS (company_id=1) and Horeca Smart (company_id=2).';

-- ── Atomic single-item review RPC ──

create or replace function public.rpc_review_company_purchase(
  p_company_id bigint,
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
  v_old public.procurement_company_purchase_reviews;
  v_new public.procurement_company_purchase_reviews;
  v_had_old boolean := false;
  v_actor public.app_user_roles;
begin
  v_actor := public.procurement_require_actor(p_actor_user_id, 'reviewer');

  if p_company_id is null or p_company_id not in (1, 2) then
    raise exception 'INVALID_COMPANY_ID';
  end if;
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

  if p_decision_status = 'APPROVED' and (p_approved_qty is null or p_approved_qty <= 0) then
    raise exception 'APPROVED_QTY_REQUIRED';
  end if;

  select *
  into v_old
  from public.procurement_company_purchase_reviews r
  where r.company_id = p_company_id and r.product_code = btrim(p_product_code)
  for update;
  v_had_old := found;

  if v_had_old and v_old.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;
  if not v_had_old and p_expected_version <> 0 then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;

  insert into public.procurement_company_purchase_reviews (
    company_id,
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
    p_company_id,
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
  on conflict (company_id, product_code) do update set
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
    'COMPANY_PURCHASE_' || v_new.decision_status,
    'RECOMMENDATION_REVIEW',
    'COMPANY_PURCHASE',
    v_new.company_id || ':' || v_new.product_code,
    v_actor.user_id,
    v_actor.display_name,
    v_actor.role,
    case when v_had_old then to_jsonb(v_old) else null end,
    to_jsonb(v_new),
    p_buyer_note,
    btrim(p_request_id)
  );

  return jsonb_build_object(
    'companyId', v_new.company_id,
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

-- ── Atomic bulk review RPC ──

create or replace function public.rpc_bulk_review_company_purchases(
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

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_result := public.rpc_review_company_purchase(
      (v_item ->> 'companyId')::bigint,
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

-- ── Company purchase review projection view ──

create or replace view public.api_company_purchase_review
with (security_invoker = true)
as
with latest_external_receipts as (
  select distinct on (r.company_id, r.product_code)
    r.company_id,
    r.product_code,
    r.supplier_id,
    r.supplier_name,
    r.received_at,
    r.unit_cost
  from public.procurement_supplier_receipts r
  where r.received_qty > 0
    and r.supplier_id not in (1, 2)
    and upper(btrim(r.supplier_name)) not in ('MAS', 'HORECA SMART', 'HORECA', 'HORECA SMART OS')
  order by
    r.company_id,
    r.product_code,
    r.received_at desc,
    r.received_qty desc,
    r.id desc
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
  coalesce(r.approved_supplier_id, er.supplier_id, sr.approved_supplier_id) as supplier_id,
  coalesce(r.approved_supplier_name, er.supplier_name, sr.approved_supplier_name) as supplier_name,
  case
    when er.supplier_id is not null then 'VERIFIED_RECEIPT'
    when r.approved_supplier_id is not null or sr.approved_supplier_id is not null then 'FALLBACK_NEEDS_REVIEW'
    else 'NEEDS_SUPPLIER'
  end as supplier_readiness,
  er.received_at as latest_receipt_at,
  er.unit_cost as latest_unit_cost,
  case
    when er.unit_cost is not null then round(coalesce(r.approved_qty, c.suggested_qty, 0) * er.unit_cost, 2)
    else null
  end as estimated_value,
  coalesce(r.decision_status, 'NEW') as decision_status,
  r.buyer_note,
  coalesce(r.version, 0) as version,
  r.updated_at::text as source_updated_at,
  (
    coalesce(r.decision_status, 'NEW') = 'APPROVED'
    and coalesce(r.approved_qty, 0) > 0
    and coalesce(r.approved_supplier_id, er.supplier_id, sr.approved_supplier_id) is not null
  ) as ready_for_po
from public.api_procurement_company_source s
cross join lateral public.procurement_calculate_recommendation(
  s.effective_daily_demand,
  s.free_qty,
  14,
  s.lead_time_days,
  s.safety_stock_days,
  s.order_multiple,
  s.data_status
) c
left join public.procurement_company_purchase_reviews r
  on r.company_id = s.company_id
 and r.product_code = s.product_code
left join latest_external_receipts er
  on er.company_id = s.company_id
 and er.product_code = s.product_code
left join public.procurement_supplier_reviews sr
  on sr.product_code = s.product_code;

-- ── Security & RLS ──

alter table public.procurement_company_purchase_reviews enable row level security;

revoke all on table public.procurement_company_purchase_reviews
  from public, anon, authenticated;
revoke all on function public.rpc_review_company_purchase(
  bigint, text, text, numeric, bigint, text, text, bigint, uuid, text
) from public, anon, authenticated;
revoke all on function public.rpc_bulk_review_company_purchases(
  jsonb, text, text, uuid, text
) from public, anon, authenticated;
revoke all on table public.api_company_purchase_review
  from public, anon, authenticated;

grant select, insert, update, delete on table public.procurement_company_purchase_reviews
  to service_role;
grant execute on function public.rpc_review_company_purchase(
  bigint, text, text, numeric, bigint, text, text, bigint, uuid, text
) to service_role;
grant execute on function public.rpc_bulk_review_company_purchases(
  jsonb, text, text, uuid, text
) to service_role;
grant select on table public.api_company_purchase_review
  to service_role;

commit;
