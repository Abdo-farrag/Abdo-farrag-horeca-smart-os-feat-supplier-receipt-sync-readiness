begin;

alter table public.procurement_product_vendor_prices
  add column id bigint generated always as identity,
  add column odoo_supplierinfo_id bigint null,
  add column company_id bigint null,
  add column valid_from date null,
  add column valid_to date null;

alter table public.procurement_product_vendor_prices
  drop constraint procurement_product_vendor_prices_pkey,
  add constraint procurement_product_vendor_prices_pkey primary key (id),
  add constraint procurement_product_vendor_prices_odoo_supplierinfo_id_key
    unique (odoo_supplierinfo_id),
  add constraint procurement_product_vendor_prices_odoo_id_check
    check (odoo_supplierinfo_id is null or odoo_supplierinfo_id > 0),
  add constraint procurement_product_vendor_prices_company_check
    check (company_id is null or company_id > 0),
  add constraint procurement_product_vendor_prices_validity_check
    check (valid_from is null or valid_to is null or valid_to >= valid_from);

comment on column public.procurement_product_vendor_prices.odoo_supplierinfo_id is
  'Immutable product.supplierinfo id. Null only for legacy rows written before v2.';
comment on column public.procurement_product_vendor_prices.company_id is
  'Odoo company scope; null means the vendor price is global.';
comment on column public.procurement_product_vendor_prices.valid_from is
  'Inclusive Odoo supplierinfo start date.';
comment on column public.procurement_product_vendor_prices.valid_to is
  'Inclusive Odoo supplierinfo end date.';

create index procurement_product_vendor_prices_selection_idx
  on public.procurement_product_vendor_prices (
    product_code, supplier_id, company_id, minimum_qty, sequence, id
  );

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
  select coalesce(
    (
      select min(nullif(vp.minimum_qty, 0))
      from public.procurement_product_vendor_prices vp
      where vp.product_code = btrim(p_product_code)
        and vp.supplier_id = p_supplier_id
        and vp.company_id = p_company_id
        and (vp.valid_from is null or vp.valid_from <= current_date)
        and (vp.valid_to is null or vp.valid_to >= current_date)
        and (
          vp.odoo_supplierinfo_id is not null
          or not exists (
            select 1
            from public.procurement_product_vendor_prices authoritative
            where authoritative.product_code = btrim(p_product_code)
              and authoritative.supplier_id = p_supplier_id
              and authoritative.company_id = p_company_id
              and authoritative.odoo_supplierinfo_id is not null
              and (authoritative.valid_from is null or authoritative.valid_from <= current_date)
              and (authoritative.valid_to is null or authoritative.valid_to >= current_date)
          )
        )
    ),
    (
      select min(nullif(vp.minimum_qty, 0))
      from public.procurement_product_vendor_prices vp
      where vp.product_code = btrim(p_product_code)
        and vp.supplier_id = p_supplier_id
        and vp.company_id is null
        and (vp.valid_from is null or vp.valid_from <= current_date)
        and (vp.valid_to is null or vp.valid_to >= current_date)
        and (
          vp.odoo_supplierinfo_id is not null
          or not exists (
            select 1
            from public.procurement_product_vendor_prices authoritative
            where authoritative.product_code = btrim(p_product_code)
              and authoritative.supplier_id = p_supplier_id
              and authoritative.company_id is null
              and authoritative.odoo_supplierinfo_id is not null
              and (authoritative.valid_from is null or authoritative.valid_from <= current_date)
              and (authoritative.valid_to is null or authoritative.valid_to >= current_date)
          )
        )
    )
  );
$$;

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
    and (vp.company_id = p_company_id or vp.company_id is null)
    and (vp.valid_from is null or vp.valid_from <= current_date)
    and (vp.valid_to is null or vp.valid_to >= current_date)
  order by
    case when vp.company_id = p_company_id then 0 else 1 end,
    case when vp.odoo_supplierinfo_id is not null then 0 else 1 end,
    case when vp.minimum_qty <= p_quantity then 0 else 1 end,
    case when vp.minimum_qty <= p_quantity then vp.minimum_qty end desc,
    vp.minimum_qty asc,
    vp.sequence asc,
    vp.id asc
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
    v_supplier.odoo_supplier_id, v_supplier.supplier_name,
    v_supplier.supplier_code, p_expected_receipt_date, p_buyer_note,
    v_actor.user_id, v_actor.display_name, v_actor.role, v_actor.user_id
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

    v_minimum_order_qty := public.procurement_purchase_minimum_order_qty(
      p_company_id, v_recommendation.product_code, p_supplier_id
    );
    v_quantity := public.procurement_round_purchase_quantity(
      v_recommendation.suggested_qty, v_minimum_order_qty, v_metadata.order_multiple
    );
    select * into v_price
    from public.procurement_purchase_price_choice(
      p_company_id, v_recommendation.product_code, p_supplier_id, v_quantity
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
      v_draft.id, v_recommendation.product_code, v_recommendation.product_name,
      v_metadata.brand_id, v_metadata.brand_name, v_recommendation.suggested_qty,
      v_quantity, v_metadata.purchase_uom_id, v_metadata.purchase_uom_name,
      coalesce(v_price.minimum_order_qty, v_minimum_order_qty),
      v_metadata.order_multiple, v_price.unit_price, v_price.price_source,
      v_price.currency, v_warnings, v_recommendation.version,
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
    v_minimum_order_qty := public.procurement_purchase_minimum_order_qty(
      v_old.company_id, v_line.product_code, p_supplier_id
    );
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

revoke all on sequence public.procurement_product_vendor_prices_id_seq
  from public, anon, authenticated;
grant usage, select on sequence public.procurement_product_vendor_prices_id_seq
  to service_role;

revoke all on function public.procurement_purchase_minimum_order_qty(bigint, text, bigint)
  from public, anon, authenticated;
grant execute on function public.procurement_purchase_minimum_order_qty(bigint, text, bigint)
  to service_role;

commit;
