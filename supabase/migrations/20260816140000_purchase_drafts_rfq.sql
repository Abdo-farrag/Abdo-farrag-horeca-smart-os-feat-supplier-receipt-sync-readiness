begin;

alter table public.procurement_audit_events
  drop constraint procurement_audit_events_event_type_check;
alter table public.procurement_audit_events
  add constraint procurement_audit_events_event_type_check check (event_type in (
    'SUPPLIER_APPROVED', 'SUPPLIER_REJECTED', 'SUPPLIER_CHANGED',
    'NEEDS_SUPPLIER', 'UNDO', 'PRODUCT_RULE_UPDATED',
    'PRODUCT_RULES_BULK_UPDATED', 'USER_INVITED', 'USER_ROLE_CHANGED',
    'USER_STATUS_CHANGED', 'PASSWORD_RESET_REQUESTED',
    'OVERVIEW_LOGIN_SUCCEEDED', 'OVERVIEW_LOGIN_FAILED', 'EXPORT_CREATED',
    'RECALCULATION_FAILED', 'COMPANY_PURCHASE_NEW',
    'COMPANY_PURCHASE_UNDER_REVIEW', 'COMPANY_PURCHASE_APPROVED',
    'COMPANY_PURCHASE_REJECTED', 'COMPANY_PURCHASE_DEFERRED',
    'PURCHASE_DRAFT_CREATED', 'PURCHASE_DRAFT_LINE_UPDATED',
    'PURCHASE_DRAFT_SUPPLIER_CHANGED', 'PURCHASE_DRAFT_STATUS_CHANGED',
    'PURCHASE_DRAFT_RFQ_REFERENCE_SET'
  ));

alter table public.procurement_audit_events
  drop constraint procurement_audit_events_module_check;
alter table public.procurement_audit_events
  add constraint procurement_audit_events_module_check check (module in (
    'SUPPLIER_REVIEW', 'PRODUCT_SETTINGS', 'USERS', 'AUTH', 'EXPORT',
    'SYSTEM', 'RECOMMENDATION_REVIEW', 'PURCHASE_DRAFT'
  ));

create table public.procurement_purchase_drafts (
  id uuid primary key default gen_random_uuid(),
  draft_number bigint generated always as identity unique,
  status text not null default 'DRAFT' check (
    status in ('DRAFT', 'READY_FOR_EXPORT', 'EXPORTED', 'CLOSED', 'CANCELLED')
  ),
  company_id bigint not null check (company_id in (1, 2)),
  company_name text not null check (length(btrim(company_name)) between 1 and 200),
  supplier_id bigint not null check (supplier_id > 0),
  supplier_name text not null check (length(btrim(supplier_name)) between 1 and 300),
  supplier_code text null check (
    supplier_code is null or length(btrim(supplier_code)) between 1 and 120
  ),
  expected_receipt_date date null,
  buyer_note text null check (buyer_note is null or length(buyer_note) <= 1000),
  odoo_rfq_id bigint null check (odoo_rfq_id is null or odoo_rfq_id > 0),
  odoo_rfq_name text null check (
    odoo_rfq_name is null or length(btrim(odoo_rfq_name)) between 1 and 120
  ),
  version bigint not null default 1 check (version >= 1),
  created_by uuid null references auth.users(id) on delete set null,
  created_by_display_name text not null check (
    length(btrim(created_by_display_name)) between 1 and 200
  ),
  created_by_role text not null check (created_by_role in ('reviewer', 'admin')),
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index procurement_purchase_drafts_status_idx
  on public.procurement_purchase_drafts (status, updated_at desc);
create index procurement_purchase_drafts_supplier_idx
  on public.procurement_purchase_drafts (company_id, supplier_id, updated_at desc);

create table public.procurement_purchase_draft_lines (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.procurement_purchase_drafts(id)
    on delete cascade,
  product_code text not null check (length(btrim(product_code)) between 1 and 120),
  product_name text not null check (length(btrim(product_name)) between 1 and 300),
  brand_id bigint null check (brand_id is null or brand_id > 0),
  brand_name text null check (
    brand_name is null or length(btrim(brand_name)) between 1 and 200
  ),
  suggested_qty numeric not null check (suggested_qty > 0),
  approved_qty numeric not null check (approved_qty > 0),
  purchase_uom_id bigint null check (purchase_uom_id is null or purchase_uom_id > 0),
  purchase_uom_name text null check (
    purchase_uom_name is null or length(btrim(purchase_uom_name)) between 1 and 120
  ),
  minimum_order_qty numeric null check (
    minimum_order_qty is null or minimum_order_qty > 0
  ),
  order_multiple numeric null check (order_multiple is null or order_multiple > 0),
  unit_price numeric null check (unit_price is null or unit_price >= 0),
  price_source text not null check (price_source in (
    'ODOO_VENDOR_PRICE', 'SAME_SUPPLIER_RECEIPT',
    'OTHER_SUPPLIER_REFERENCE', 'MISSING', 'MANUAL_CONFIRMED'
  )),
  currency text null check (
    currency is null or length(btrim(currency)) between 1 and 12
  ),
  warnings text[] not null default '{}'::text[] check (
    warnings <@ array[
      'PACKAGING_REVIEW_REQUIRED', 'MISSING_PRICE',
      'OTHER_SUPPLIER_PRICE', 'BRAND_UNDEFINED'
    ]::text[]
  ),
  source_recommendation_version bigint not null check (
    source_recommendation_version >= 0
  ),
  source_updated_at timestamptz null,
  version bigint not null default 1 check (version >= 1),
  buyer_note text null check (buyer_note is null or length(buyer_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (draft_id, product_code)
);

create index procurement_purchase_draft_lines_draft_idx
  on public.procurement_purchase_draft_lines (draft_id, product_code);

create or replace function public.procurement_round_purchase_quantity(
  p_quantity numeric,
  p_minimum_order_qty numeric,
  p_order_multiple numeric
)
returns numeric
language plpgsql
immutable
set search_path = public, pg_temp
as $function$
declare
  v_quantity numeric;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'INVALID_APPROVED_QUANTITY';
  end if;
  if p_minimum_order_qty is not null and p_minimum_order_qty <= 0 then
    raise exception 'INVALID_MINIMUM_ORDER_QUANTITY';
  end if;
  if p_order_multiple is not null and p_order_multiple <= 0 then
    raise exception 'INVALID_ORDER_MULTIPLE';
  end if;

  v_quantity := greatest(p_quantity, coalesce(p_minimum_order_qty, 0));
  if p_order_multiple is not null then
    v_quantity := ceil(v_quantity / p_order_multiple) * p_order_multiple;
  end if;
  return v_quantity;
end;
$function$;

create or replace function public.procurement_purchase_price_choice(
  p_company_id bigint,
  p_product_code text,
  p_supplier_id bigint,
  p_quantity numeric
)
returns table (
  unit_price numeric,
  price_source text,
  currency text,
  minimum_order_qty numeric
)
language plpgsql
stable
set search_path = public, pg_temp
as $function$
begin
  return query
  select
    vp.price,
    'ODOO_VENDOR_PRICE'::text,
    vp.currency,
    nullif(vp.minimum_qty, 0)
  from public.procurement_product_vendor_prices vp
  where vp.product_code = btrim(p_product_code)
    and vp.supplier_id = p_supplier_id
  order by
    case when vp.minimum_qty <= p_quantity then 0 else 1 end,
    case when vp.minimum_qty <= p_quantity then vp.minimum_qty end desc,
    vp.minimum_qty asc,
    vp.sequence asc
  limit 1;
  if found then return; end if;

  return query
  select
    r.unit_cost,
    'SAME_SUPPLIER_RECEIPT'::text,
    null::text,
    null::numeric
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
  select
    r.unit_cost,
    'OTHER_SUPPLIER_REFERENCE'::text,
    null::text,
    null::numeric
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
$function$;

create or replace function public.procurement_purchase_transition_allowed(
  p_current text,
  p_next text
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_current
    when 'DRAFT' then p_next in ('READY_FOR_EXPORT', 'CANCELLED')
    when 'READY_FOR_EXPORT' then p_next in ('EXPORTED', 'CANCELLED')
    when 'EXPORTED' then p_next = 'CLOSED'
    else false
  end;
$$;

create or replace function public.procurement_purchase_actor(p_user_id uuid)
returns table (user_id uuid, display_name text, role text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor public.app_user_roles;
begin
  if p_user_id is null
     or p_user_id = '00000000-0000-0000-0000-000000000000'::uuid then
    return query select null::uuid, 'Overview Buyer'::text, 'reviewer'::text;
    return;
  end if;

  v_actor := public.procurement_require_actor(p_user_id, 'reviewer');
  return query select v_actor.user_id, v_actor.display_name, v_actor.role;
end;
$function$;

create or replace function public.rpc_create_purchase_draft(
  p_company_id bigint,
  p_supplier_id bigint,
  p_expected_receipt_date date,
  p_buyer_note text,
  p_items jsonb,
  p_actor_user_id uuid,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor record;
  v_supplier public.procurement_supplier_directory;
  v_draft public.procurement_purchase_drafts;
  v_item jsonb;
  v_recommendation record;
  v_metadata public.procurement_product_purchase_metadata;
  v_price record;
  v_quantity numeric;
  v_minimum_order_qty numeric;
  v_warnings text[];
  v_seen text[] := '{}'::text[];
begin
  select * into v_actor from public.procurement_purchase_actor(p_actor_user_id);
  if p_company_id is null or p_company_id not in (1, 2) then
    raise exception 'INVALID_COMPANY_ID';
  end if;
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'REQUEST_ID_REQUIRED';
  end if;
  if p_buyer_note is not null and length(p_buyer_note) > 1000 then
    raise exception 'BUYER_NOTE_TOO_LONG';
  end if;
  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 200 then
    raise exception 'INVALID_DRAFT_ITEMS';
  end if;

  select * into v_supplier
  from public.procurement_supplier_directory s
  where s.odoo_supplier_id = p_supplier_id
    and s.active
    and s.supplier_rank > 0;
  if not found then raise exception 'SUPPLIER_NOT_FOUND'; end if;

  insert into public.procurement_purchase_drafts (
    company_id, company_name, supplier_id, supplier_name, supplier_code,
    expected_receipt_date, buyer_note, created_by, created_by_display_name,
    created_by_role, updated_by
  ) values (
    p_company_id,
    case p_company_id when 1 then 'MAS' else 'Horeca Smart' end,
    v_supplier.odoo_supplier_id,
    v_supplier.supplier_name,
    v_supplier.supplier_code,
    p_expected_receipt_date,
    p_buyer_note,
    v_actor.user_id,
    v_actor.display_name,
    v_actor.role,
    v_actor.user_id
  ) returning * into v_draft;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if nullif(btrim(v_item ->> 'productCode'), '') is null then
      raise exception 'PRODUCT_CODE_REQUIRED';
    end if;
    if (v_item ->> 'productCode') = any(v_seen) then
      raise exception 'DUPLICATE_PRODUCT_CODE';
    end if;
    v_seen := array_append(v_seen, v_item ->> 'productCode');

    select * into v_recommendation
    from public.api_company_purchase_review r
    where r.company_id = p_company_id
      and r.product_code = btrim(v_item ->> 'productCode');
    if not found then raise exception 'RECOMMENDATION_NOT_FOUND'; end if;
    if v_recommendation.version <> (v_item ->> 'expectedRecommendationVersion')::bigint then
      raise exception 'VERSION_CONFLICT' using errcode = '40001';
    end if;
    if v_recommendation.suggested_qty is null or v_recommendation.suggested_qty <= 0 then
      raise exception 'NON_POSITIVE_SUGGESTED_QUANTITY';
    end if;

    select * into v_metadata
    from public.procurement_product_purchase_metadata m
    where m.product_code = v_recommendation.product_code;

    select min(nullif(vp.minimum_qty, 0)) into v_minimum_order_qty
    from public.procurement_product_vendor_prices vp
    where vp.product_code = v_recommendation.product_code
      and vp.supplier_id = p_supplier_id;
    v_quantity := public.procurement_round_purchase_quantity(
      v_recommendation.suggested_qty,
      v_minimum_order_qty,
      v_metadata.order_multiple
    );
    select * into v_price
    from public.procurement_purchase_price_choice(
      p_company_id,
      v_recommendation.product_code,
      p_supplier_id,
      v_quantity
    );

    v_warnings := '{}'::text[];
    if v_price.minimum_order_qty is null and v_metadata.order_multiple is null then
      v_warnings := array_append(v_warnings, 'PACKAGING_REVIEW_REQUIRED');
    end if;
    if v_metadata.brand_name is null then
      v_warnings := array_append(v_warnings, 'BRAND_UNDEFINED');
    end if;
    if v_price.price_source = 'MISSING' then
      v_warnings := array_append(v_warnings, 'MISSING_PRICE');
    elsif v_price.price_source = 'OTHER_SUPPLIER_REFERENCE' then
      v_warnings := array_append(v_warnings, 'OTHER_SUPPLIER_PRICE');
    end if;

    insert into public.procurement_purchase_draft_lines (
      draft_id, product_code, product_name, brand_id, brand_name,
      suggested_qty, approved_qty, purchase_uom_id, purchase_uom_name,
      minimum_order_qty, order_multiple, unit_price, price_source, currency,
      warnings, source_recommendation_version, source_updated_at
    ) values (
      v_draft.id,
      v_recommendation.product_code,
      v_recommendation.product_name,
      v_metadata.brand_id,
      v_metadata.brand_name,
      v_recommendation.suggested_qty,
      v_quantity,
      v_metadata.purchase_uom_id,
      v_metadata.purchase_uom_name,
      coalesce(v_price.minimum_order_qty, v_minimum_order_qty),
      v_metadata.order_multiple,
      v_price.unit_price,
      v_price.price_source,
      v_price.currency,
      v_warnings,
      v_recommendation.version,
      nullif(v_recommendation.source_updated_at, '')::timestamptz
    );
  end loop;

  insert into public.procurement_audit_events (
    event_type, module, entity_type, entity_key, actor_user_id,
    actor_display_name, actor_role, new_data, note, request_id
  ) values (
    'PURCHASE_DRAFT_CREATED', 'PURCHASE_DRAFT', 'PURCHASE_DRAFT',
    v_draft.id::text, v_actor.user_id, v_actor.display_name, v_actor.role,
    to_jsonb(v_draft), left(p_buyer_note, 500), btrim(p_request_id)
  );

  return jsonb_build_object('id', v_draft.id, 'version', v_draft.version);
end;
$function$;

create or replace function public.rpc_update_purchase_draft_line(
  p_draft_id uuid,
  p_line_id uuid,
  p_approved_qty numeric,
  p_unit_price numeric,
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
  v_actor record;
  v_old public.procurement_purchase_draft_lines;
  v_new public.procurement_purchase_draft_lines;
  v_status text;
  v_warnings text[];
begin
  select * into v_actor from public.procurement_purchase_actor(p_actor_user_id);
  select l.* into v_old
  from public.procurement_purchase_draft_lines l
  where l.id = p_line_id
    and l.draft_id = p_draft_id
  for update;
  if not found then raise exception 'DRAFT_LINE_NOT_FOUND'; end if;
  select d.status into v_status
  from public.procurement_purchase_drafts d
  where d.id = v_old.draft_id;
  if v_status <> 'DRAFT' then raise exception 'DRAFT_NOT_EDITABLE'; end if;
  if v_old.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;
  if p_buyer_note is not null and length(p_buyer_note) > 1000 then
    raise exception 'BUYER_NOTE_TOO_LONG';
  end if;

  v_warnings := array_remove(array_remove(v_old.warnings, 'MISSING_PRICE'),
    'OTHER_SUPPLIER_PRICE');
  if p_unit_price is null then
    v_warnings := array_append(v_warnings, 'MISSING_PRICE');
  end if;

  update public.procurement_purchase_draft_lines
  set approved_qty = public.procurement_round_purchase_quantity(
        p_approved_qty, minimum_order_qty, order_multiple
      ),
      unit_price = p_unit_price,
      price_source = case when p_unit_price is null then 'MISSING'
        else 'MANUAL_CONFIRMED' end,
      warnings = v_warnings,
      buyer_note = p_buyer_note,
      version = version + 1,
      updated_at = now()
  where id = p_line_id
  returning * into v_new;

  insert into public.procurement_audit_events (
    event_type, module, entity_type, entity_key, actor_user_id,
    actor_display_name, actor_role, old_data, new_data, note, request_id
  ) values (
    'PURCHASE_DRAFT_LINE_UPDATED', 'PURCHASE_DRAFT', 'PURCHASE_DRAFT_LINE',
    v_new.id::text, v_actor.user_id, v_actor.display_name, v_actor.role,
    to_jsonb(v_old), to_jsonb(v_new), left(p_buyer_note, 500), btrim(p_request_id)
  );

  return to_jsonb(v_new);
end;
$function$;

create or replace function public.rpc_change_purchase_draft_supplier(
  p_draft_id uuid,
  p_supplier_id bigint,
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
  v_actor record;
  v_old public.procurement_purchase_drafts;
  v_new public.procurement_purchase_drafts;
  v_supplier public.procurement_supplier_directory;
  v_line public.procurement_purchase_draft_lines;
  v_price record;
  v_warnings text[];
  v_minimum_order_qty numeric;
  v_quantity numeric;
begin
  select * into v_actor from public.procurement_purchase_actor(p_actor_user_id);
  select * into v_old from public.procurement_purchase_drafts
  where id = p_draft_id for update;
  if not found then raise exception 'DRAFT_NOT_FOUND'; end if;
  if v_old.status <> 'DRAFT' then raise exception 'DRAFT_NOT_EDITABLE'; end if;
  if v_old.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;
  select * into v_supplier from public.procurement_supplier_directory s
  where s.odoo_supplier_id = p_supplier_id and s.active and s.supplier_rank > 0;
  if not found then raise exception 'SUPPLIER_NOT_FOUND'; end if;

  update public.procurement_purchase_drafts
  set supplier_id = v_supplier.odoo_supplier_id,
      supplier_name = v_supplier.supplier_name,
      supplier_code = v_supplier.supplier_code,
      version = version + 1,
      updated_by = v_actor.user_id,
      updated_at = now()
  where id = p_draft_id
  returning * into v_new;

  for v_line in select * from public.procurement_purchase_draft_lines
    where draft_id = p_draft_id for update
  loop
    select min(nullif(vp.minimum_qty, 0)) into v_minimum_order_qty
    from public.procurement_product_vendor_prices vp
    where vp.product_code = v_line.product_code
      and vp.supplier_id = p_supplier_id;
    v_quantity := public.procurement_round_purchase_quantity(
      v_line.approved_qty, v_minimum_order_qty, v_line.order_multiple
    );
    select * into v_price from public.procurement_purchase_price_choice(
      v_old.company_id, v_line.product_code, p_supplier_id, v_quantity
    );
    v_warnings := array_remove(array_remove(v_line.warnings, 'MISSING_PRICE'),
      'OTHER_SUPPLIER_PRICE');
    if v_price.price_source = 'MISSING' then
      v_warnings := array_append(v_warnings, 'MISSING_PRICE');
    elsif v_price.price_source = 'OTHER_SUPPLIER_REFERENCE' then
      v_warnings := array_append(v_warnings, 'OTHER_SUPPLIER_PRICE');
    end if;

    update public.procurement_purchase_draft_lines
    set approved_qty = v_quantity,
        minimum_order_qty = coalesce(v_price.minimum_order_qty, v_minimum_order_qty),
        unit_price = v_price.unit_price,
        price_source = v_price.price_source,
        currency = v_price.currency,
        warnings = v_warnings,
        version = version + 1,
        updated_at = now()
    where id = v_line.id;
  end loop;

  insert into public.procurement_audit_events (
    event_type, module, entity_type, entity_key, actor_user_id,
    actor_display_name, actor_role, old_data, new_data, request_id
  ) values (
    'PURCHASE_DRAFT_SUPPLIER_CHANGED', 'PURCHASE_DRAFT', 'PURCHASE_DRAFT',
    v_new.id::text, v_actor.user_id, v_actor.display_name, v_actor.role,
    to_jsonb(v_old), to_jsonb(v_new), btrim(p_request_id)
  );
  return to_jsonb(v_new);
end;
$function$;

create or replace function public.rpc_transition_purchase_draft(
  p_draft_id uuid,
  p_status text,
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
  v_actor record;
  v_old public.procurement_purchase_drafts;
  v_new public.procurement_purchase_drafts;
begin
  select * into v_actor from public.procurement_purchase_actor(p_actor_user_id);
  select * into v_old from public.procurement_purchase_drafts
  where id = p_draft_id for update;
  if not found then raise exception 'DRAFT_NOT_FOUND'; end if;
  if v_old.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;
  if not public.procurement_purchase_transition_allowed(v_old.status, p_status) then
    raise exception 'INVALID_STATUS_TRANSITION';
  end if;

  update public.procurement_purchase_drafts
  set status = p_status,
      version = version + 1,
      updated_by = v_actor.user_id,
      updated_at = now()
  where id = p_draft_id
  returning * into v_new;

  insert into public.procurement_audit_events (
    event_type, module, entity_type, entity_key, actor_user_id,
    actor_display_name, actor_role, old_data, new_data, request_id
  ) values (
    'PURCHASE_DRAFT_STATUS_CHANGED', 'PURCHASE_DRAFT', 'PURCHASE_DRAFT',
    v_new.id::text, v_actor.user_id, v_actor.display_name, v_actor.role,
    to_jsonb(v_old), to_jsonb(v_new), btrim(p_request_id)
  );
  return to_jsonb(v_new);
end;
$function$;

create or replace function public.rpc_set_purchase_draft_rfq_reference(
  p_draft_id uuid,
  p_odoo_rfq_id bigint,
  p_odoo_rfq_name text,
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
  v_actor record;
  v_old public.procurement_purchase_drafts;
  v_new public.procurement_purchase_drafts;
begin
  select * into v_actor from public.procurement_purchase_actor(p_actor_user_id);
  select * into v_old from public.procurement_purchase_drafts
  where id = p_draft_id for update;
  if not found then raise exception 'DRAFT_NOT_FOUND'; end if;
  if v_old.status not in ('EXPORTED', 'CLOSED') then
    raise exception 'RFQ_REFERENCE_NOT_ALLOWED';
  end if;
  if v_old.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;
  if p_odoo_rfq_id is not null and p_odoo_rfq_id <= 0 then
    raise exception 'INVALID_ODOO_RFQ_ID';
  end if;
  if nullif(btrim(p_odoo_rfq_name), '') is null then
    raise exception 'ODOO_RFQ_NAME_REQUIRED';
  end if;

  update public.procurement_purchase_drafts
  set odoo_rfq_id = p_odoo_rfq_id,
      odoo_rfq_name = btrim(p_odoo_rfq_name),
      version = version + 1,
      updated_by = v_actor.user_id,
      updated_at = now()
  where id = p_draft_id
  returning * into v_new;

  insert into public.procurement_audit_events (
    event_type, module, entity_type, entity_key, actor_user_id,
    actor_display_name, actor_role, old_data, new_data, request_id
  ) values (
    'PURCHASE_DRAFT_RFQ_REFERENCE_SET', 'PURCHASE_DRAFT', 'PURCHASE_DRAFT',
    v_new.id::text, v_actor.user_id, v_actor.display_name, v_actor.role,
    to_jsonb(v_old), to_jsonb(v_new), btrim(p_request_id)
  );
  return to_jsonb(v_new);
end;
$function$;

create view public.api_purchase_drafts
with (security_invoker = true)
as
select
  d.*,
  (select count(*) from public.procurement_purchase_draft_lines l
    where l.draft_id = d.id)::bigint as line_count,
  (select coalesce(sum(l.approved_qty * l.unit_price), 0)
    from public.procurement_purchase_draft_lines l
    where l.draft_id = d.id and l.unit_price is not null) as estimated_value,
  exists (
    select 1 from public.procurement_purchase_draft_lines l
    where l.draft_id = d.id and cardinality(l.warnings) > 0
  ) as has_warnings
from public.procurement_purchase_drafts d;

create view public.api_purchase_draft_lines
with (security_invoker = true)
as
select * from public.procurement_purchase_draft_lines;

alter table public.procurement_purchase_drafts enable row level security;
alter table public.procurement_purchase_draft_lines enable row level security;

revoke all on table public.procurement_purchase_drafts
  from public, anon, authenticated;
revoke all on table public.procurement_purchase_draft_lines
  from public, anon, authenticated;
revoke all on table public.api_purchase_drafts
  from public, anon, authenticated;
revoke all on table public.api_purchase_draft_lines
  from public, anon, authenticated;

revoke all on function public.procurement_round_purchase_quantity(numeric, numeric, numeric)
  from public, anon, authenticated;
revoke all on function public.procurement_purchase_price_choice(bigint, text, bigint, numeric)
  from public, anon, authenticated;
revoke all on function public.procurement_purchase_transition_allowed(text, text)
  from public, anon, authenticated;
revoke all on function public.procurement_purchase_actor(uuid)
  from public, anon, authenticated;
revoke all on function public.rpc_create_purchase_draft(
  bigint, bigint, date, text, jsonb, uuid, text
) from public, anon, authenticated;
revoke all on function public.rpc_update_purchase_draft_line(
  uuid, uuid, numeric, numeric, text, bigint, uuid, text
) from public, anon, authenticated;
revoke all on function public.rpc_change_purchase_draft_supplier(
  uuid, bigint, bigint, uuid, text
) from public, anon, authenticated;
revoke all on function public.rpc_transition_purchase_draft(
  uuid, text, bigint, uuid, text
) from public, anon, authenticated;
revoke all on function public.rpc_set_purchase_draft_rfq_reference(
  uuid, bigint, text, bigint, uuid, text
) from public, anon, authenticated;

grant select, insert, update, delete on table public.procurement_purchase_drafts
  to service_role;
grant select, insert, update, delete on table public.procurement_purchase_draft_lines
  to service_role;
grant usage, select on sequence public.procurement_purchase_drafts_draft_number_seq
  to service_role;
grant select on table public.api_purchase_drafts to service_role;
grant select on table public.api_purchase_draft_lines to service_role;
grant execute on function public.rpc_create_purchase_draft(
  bigint, bigint, date, text, jsonb, uuid, text
) to service_role;
grant execute on function public.rpc_update_purchase_draft_line(
  uuid, uuid, numeric, numeric, text, bigint, uuid, text
) to service_role;
grant execute on function public.rpc_change_purchase_draft_supplier(
  uuid, bigint, bigint, uuid, text
) to service_role;
grant execute on function public.rpc_transition_purchase_draft(
  uuid, text, bigint, uuid, text
) to service_role;
grant execute on function public.rpc_set_purchase_draft_rfq_reference(
  uuid, bigint, text, bigint, uuid, text
) to service_role;

commit;
