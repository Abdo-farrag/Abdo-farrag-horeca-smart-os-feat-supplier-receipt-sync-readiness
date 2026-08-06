begin;

create or replace function public.procurement_require_actor(
  p_user_id uuid,
  p_required_role text default 'reviewer'
)
returns public.app_user_roles
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor public.app_user_roles;
begin
  select *
  into v_actor
  from public.app_user_roles r
  where r.user_id = p_user_id
    and r.is_active;

  if not found then
    raise exception 'APP_USER_INACTIVE' using errcode = '42501';
  end if;

  if p_required_role = 'admin' and v_actor.role <> 'admin' then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  if p_required_role = 'reviewer' and v_actor.role not in ('reviewer', 'admin') then
    raise exception 'REVIEWER_REQUIRED' using errcode = '42501';
  end if;

  return v_actor;
end;
$function$;

create or replace function public.procurement_review_supplier_internal(
  p_product_code text,
  p_action text,
  p_supplier_id bigint,
  p_supplier_name text,
  p_expected_version bigint,
  p_note text,
  p_actor_user_id uuid,
  p_request_id text,
  p_batch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor public.app_user_roles;
  v_old public.procurement_supplier_reviews;
  v_new public.procurement_supplier_reviews;
  v_had_old boolean := false;
  v_supplier_name text;
  v_status text;
  v_event_type text;
begin
  v_actor := public.procurement_require_actor(p_actor_user_id, 'reviewer');

  if p_product_code is null or btrim(p_product_code) = '' then
    raise exception 'PRODUCT_CODE_REQUIRED';
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'INVALID_EXPECTED_VERSION';
  end if;
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'REQUEST_ID_REQUIRED';
  end if;
  if p_note is not null and length(p_note) > 500 then
    raise exception 'NOTE_TOO_LONG';
  end if;

  select *
  into v_old
  from public.procurement_supplier_reviews r
  where r.product_code = btrim(p_product_code)
  for update;
  v_had_old := found;

  if v_had_old and v_old.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;
  if not v_had_old and p_expected_version <> 0 then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;

  case p_action
    when 'approve' then
      v_status := 'APPROVED';
      v_event_type := 'SUPPLIER_APPROVED';
    when 'change-supplier' then
      v_status := 'APPROVED';
      v_event_type := 'SUPPLIER_CHANGED';
    when 'reject' then
      v_status := 'REJECTED';
      v_event_type := 'SUPPLIER_REJECTED';
    when 'needs-supplier' then
      v_status := 'NEEDS_SUPPLIER';
      v_event_type := 'NEEDS_SUPPLIER';
    else
      raise exception 'INVALID_SUPPLIER_ACTION';
  end case;

  if v_status = 'APPROVED' then
    if p_supplier_id is null or p_supplier_id <= 0 then
      raise exception 'SUPPLIER_REQUIRED';
    end if;

    select r.supplier_name
    into v_supplier_name
    from public.procurement_supplier_receipts r
    where r.product_code = btrim(p_product_code)
      and r.supplier_id = p_supplier_id
    order by r.received_at desc, r.received_qty desc, r.odoo_receipt_line_id desc
    limit 1;

    if not found then
      raise exception 'SUPPLIER_NOT_IN_PRODUCT_HISTORY';
    end if;

    if p_supplier_name is not null
       and btrim(p_supplier_name) <> ''
       and btrim(p_supplier_name) <> v_supplier_name then
      raise exception 'SUPPLIER_NAME_MISMATCH';
    end if;
  else
    v_supplier_name := null;
    p_supplier_id := null;
  end if;

  insert into public.procurement_supplier_reviews (
    product_code,
    approved_supplier_id,
    approved_supplier_name,
    status,
    note,
    version,
    updated_at,
    updated_by
  ) values (
    btrim(p_product_code),
    p_supplier_id,
    v_supplier_name,
    v_status,
    p_note,
    coalesce(v_old.version, 0) + 1,
    now(),
    p_actor_user_id
  )
  on conflict (product_code) do update set
    approved_supplier_id = excluded.approved_supplier_id,
    approved_supplier_name = excluded.approved_supplier_name,
    status = excluded.status,
    note = excluded.note,
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
    batch_id,
    request_id
  ) values (
    v_event_type,
    'SUPPLIER_REVIEW',
    'PRODUCT',
    v_new.product_code,
    v_actor.user_id,
    v_actor.display_name,
    v_actor.role,
    case when v_had_old then to_jsonb(v_old) else null end,
    to_jsonb(v_new),
    p_note,
    p_batch_id,
    btrim(p_request_id)
  );

  return jsonb_build_object(
    'productCode', v_new.product_code,
    'approvedSupplierId', v_new.approved_supplier_id,
    'approvedSupplierName', v_new.approved_supplier_name,
    'status', v_new.status,
    'version', v_new.version
  );
end;
$function$;

create or replace function public.rpc_review_supplier(
  p_product_code text,
  p_action text,
  p_supplier_id bigint,
  p_supplier_name text,
  p_expected_version bigint,
  p_note text,
  p_actor_user_id uuid,
  p_actor_role text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor public.app_user_roles;
begin
  v_actor := public.procurement_require_actor(p_actor_user_id, 'reviewer');
  if p_actor_role is not null and p_actor_role <> v_actor.role then
    raise exception 'ACTOR_ROLE_MISMATCH' using errcode = '42501';
  end if;

  return public.procurement_review_supplier_internal(
    p_product_code,
    p_action,
    p_supplier_id,
    p_supplier_name,
    p_expected_version,
    p_note,
    p_actor_user_id,
    p_request_id,
    null
  );
end;
$function$;

create or replace function public.rpc_bulk_approve_suppliers(
  p_items jsonb,
  p_actor_user_id uuid,
  p_actor_role text,
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
  if p_actor_role is not null and p_actor_role <> v_actor.role then
    raise exception 'ACTOR_ROLE_MISMATCH' using errcode = '42501';
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
    v_result := public.procurement_review_supplier_internal(
      v_item ->> 'productCode',
      'approve',
      (v_item ->> 'supplierId')::bigint,
      v_item ->> 'supplierName',
      (v_item ->> 'expectedVersion')::bigint,
      null,
      p_actor_user_id,
      p_request_id,
      v_batch_id
    );
    v_results := v_results || jsonb_build_array(v_result);
  end loop;

  return jsonb_build_object(
    'batchId', v_batch_id,
    'items', v_results
  );
end;
$function$;

create or replace function public.procurement_update_product_rule_internal(
  p_product_code text,
  p_lead_time_days integer,
  p_safety_stock_days integer,
  p_expected_version bigint,
  p_note text,
  p_actor_user_id uuid,
  p_request_id text,
  p_batch_id uuid default null,
  p_event_type text default 'PRODUCT_RULE_UPDATED'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor public.app_user_roles;
  v_old public.procurement_product_rules;
  v_new public.procurement_product_rules;
  v_had_old boolean := false;
  v_lead integer;
  v_safety integer;
begin
  v_actor := public.procurement_require_actor(p_actor_user_id, 'admin');

  if p_product_code is null or btrim(p_product_code) = '' then
    raise exception 'PRODUCT_CODE_REQUIRED';
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'INVALID_EXPECTED_VERSION';
  end if;
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'REQUEST_ID_REQUIRED';
  end if;
  if p_note is not null and length(p_note) > 500 then
    raise exception 'NOTE_TOO_LONG';
  end if;
  if p_event_type not in ('PRODUCT_RULE_UPDATED', 'PRODUCT_RULES_BULK_UPDATED') then
    raise exception 'INVALID_RULE_EVENT_TYPE';
  end if;

  select *
  into v_old
  from public.procurement_product_rules r
  where r.product_code = btrim(p_product_code)
  for update;
  v_had_old := found;

  if v_had_old and v_old.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;
  if not v_had_old and p_expected_version <> 0 then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;

  v_lead := coalesce(p_lead_time_days, v_old.lead_time_days, 4);
  v_safety := coalesce(p_safety_stock_days, v_old.safety_stock_days, 7);

  if v_lead < 0 or v_lead > 90 then
    raise exception 'INVALID_LEAD_TIME_DAYS';
  end if;
  if v_safety < 0 or v_safety > 60 then
    raise exception 'INVALID_SAFETY_STOCK_DAYS';
  end if;

  insert into public.procurement_product_rules (
    product_code,
    lead_time_days,
    safety_stock_days,
    order_multiple,
    version,
    updated_at,
    updated_by
  ) values (
    btrim(p_product_code),
    v_lead,
    v_safety,
    coalesce(v_old.order_multiple, 1),
    coalesce(v_old.version, 0) + 1,
    now(),
    p_actor_user_id
  )
  on conflict (product_code) do update set
    lead_time_days = excluded.lead_time_days,
    safety_stock_days = excluded.safety_stock_days,
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
    batch_id,
    request_id
  ) values (
    p_event_type,
    'PRODUCT_SETTINGS',
    'PRODUCT',
    v_new.product_code,
    v_actor.user_id,
    v_actor.display_name,
    v_actor.role,
    case when v_had_old then to_jsonb(v_old) else null end,
    to_jsonb(v_new),
    p_note,
    p_batch_id,
    btrim(p_request_id)
  );

  return jsonb_build_object(
    'productCode', v_new.product_code,
    'leadTimeDays', v_new.lead_time_days,
    'safetyStockDays', v_new.safety_stock_days,
    'orderMultiple', v_new.order_multiple,
    'version', v_new.version,
    'updatedAt', v_new.updated_at
  );
end;
$function$;

create or replace function public.rpc_update_product_rule(
  p_product_code text,
  p_lead_time_days integer,
  p_safety_stock_days integer,
  p_expected_version bigint,
  p_note text,
  p_actor_user_id uuid,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if p_lead_time_days is null or p_safety_stock_days is null then
    raise exception 'PRODUCT_RULE_VALUES_REQUIRED';
  end if;

  return public.procurement_update_product_rule_internal(
    p_product_code,
    p_lead_time_days,
    p_safety_stock_days,
    p_expected_version,
    p_note,
    p_actor_user_id,
    p_request_id,
    null,
    'PRODUCT_RULE_UPDATED'
  );
end;
$function$;

create or replace function public.rpc_bulk_update_product_rules(
  p_items jsonb,
  p_changes jsonb,
  p_note text,
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
  v_lead integer;
  v_safety integer;
begin
  v_actor := public.procurement_require_actor(p_actor_user_id, 'admin');

  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 200 then
    raise exception 'INVALID_BULK_ITEMS';
  end if;
  if jsonb_typeof(p_changes) <> 'object'
     or not (p_changes ? 'leadTimeDays' or p_changes ? 'safetyStockDays') then
    raise exception 'BULK_RULE_CHANGES_REQUIRED';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    group by item ->> 'productCode'
    having count(*) > 1
  ) then
    raise exception 'DUPLICATE_PRODUCT_CODE';
  end if;

  v_lead := case when p_changes ? 'leadTimeDays'
    then (p_changes ->> 'leadTimeDays')::integer else null end;
  v_safety := case when p_changes ? 'safetyStockDays'
    then (p_changes ->> 'safetyStockDays')::integer else null end;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_result := public.procurement_update_product_rule_internal(
      v_item ->> 'productCode',
      v_lead,
      v_safety,
      (v_item ->> 'expectedVersion')::bigint,
      p_note,
      p_actor_user_id,
      p_request_id,
      v_batch_id,
      'PRODUCT_RULES_BULK_UPDATED'
    );
    v_results := v_results || jsonb_build_array(v_result);
  end loop;

  return jsonb_build_object(
    'batchId', v_batch_id,
    'items', v_results
  );
end;
$function$;

create or replace function public.rpc_get_audit_log(
  p_actor_user_id uuid,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_user_id uuid default null,
  p_actions text[] default array[]::text[],
  p_modules text[] default array[]::text[],
  p_product_code text default null,
  p_supplier text default null,
  p_bulk_only boolean default null,
  p_undone_only boolean default null,
  p_search text default null,
  p_page integer default 1,
  p_page_size integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor public.app_user_roles;
  v_result jsonb;
begin
  v_actor := public.procurement_require_actor(p_actor_user_id, 'reviewer');
  if p_page < 1 or p_page_size < 1 or p_page_size > 200 then
    raise exception 'INVALID_PAGINATION';
  end if;

  with audit_rows as (
    select
      e.*,
      u.id as undone_event_id,
      coalesce(
        e.new_data ->> 'approved_supplier_name',
        e.old_data ->> 'approved_supplier_name'
      ) as supplier_name,
      coalesce(
        nullif(e.new_data ->> 'approved_supplier_id', '')::bigint,
        nullif(e.old_data ->> 'approved_supplier_id', '')::bigint
      ) as supplier_id
    from public.procurement_audit_events e
    left join public.procurement_audit_events u
      on u.undo_of = e.id
    where
      (v_actor.role = 'admin' or e.module = 'SUPPLIER_REVIEW')
      and (p_date_from is null or e.created_at >= p_date_from)
      and (p_date_to is null or e.created_at < p_date_to)
      and (p_user_id is null or e.actor_user_id = p_user_id)
      and (coalesce(array_length(p_actions, 1), 0) = 0 or e.event_type = any(p_actions))
      and (coalesce(array_length(p_modules, 1), 0) = 0 or e.module = any(p_modules))
      and (p_product_code is null or btrim(p_product_code) = '' or e.entity_key = btrim(p_product_code))
      and (p_supplier is null or btrim(p_supplier) = '' or coalesce(
        e.new_data ->> 'approved_supplier_name',
        e.old_data ->> 'approved_supplier_name',
        ''
      ) ilike '%' || btrim(p_supplier) || '%')
      and (p_bulk_only is null or (p_bulk_only and e.batch_id is not null) or (not p_bulk_only and e.batch_id is null))
      and (p_undone_only is null or (p_undone_only and u.id is not null) or (not p_undone_only and u.id is null))
      and (p_search is null or btrim(p_search) = '' or
        e.entity_key ilike '%' || btrim(p_search) || '%' or
        coalesce(e.actor_display_name, '') ilike '%' || btrim(p_search) || '%' or
        coalesce(e.note, '') ilike '%' || btrim(p_search) || '%')
  ), summary as (
    select count(*)::integer as total_rows from audit_rows
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'rows', coalesce((
        select jsonb_agg(q.row_json)
        from (
          select jsonb_build_object(
            'id', a.id,
            'occurredAt', a.created_at,
            'actorUserId', a.actor_user_id,
            'actorDisplayName', a.actor_display_name,
            'actorRole', a.actor_role,
            'action', a.event_type,
            'module', a.module,
            'productCode', case when a.entity_type = 'PRODUCT' then a.entity_key else null end,
            'supplierId', a.supplier_id,
            'supplierName', a.supplier_name,
            'oldValue', a.old_data,
            'newValue', a.new_data,
            'note', a.note,
            'isBulk', a.batch_id is not null,
            'undoneEventId', a.undone_event_id,
            'requestId', a.request_id
          ) as row_json
          from audit_rows a
          order by a.created_at desc, a.id desc
          limit p_page_size
          offset (p_page - 1) * p_page_size
        ) q
      ), '[]'::jsonb),
      'pagination', jsonb_build_object(
        'page', p_page,
        'pageSize', p_page_size,
        'total', s.total_rows,
        'totalPages', case
          when s.total_rows = 0 then 0
          else ((s.total_rows + p_page_size - 1) / p_page_size)::integer
        end
      )
    ),
    'error', null
  )
  into v_result
  from summary s;

  return v_result;
end;
$function$;

create or replace function public.rpc_undo_audit_event(
  p_audit_event_id bigint,
  p_actor_user_id uuid,
  p_note text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor public.app_user_roles;
  v_original public.procurement_audit_events;
  v_supplier_current public.procurement_supplier_reviews;
  v_supplier_restored public.procurement_supplier_reviews;
  v_rule_current public.procurement_product_rules;
  v_rule_restored public.procurement_product_rules;
  v_current_json jsonb;
  v_restored_json jsonb;
  v_undo_id bigint;
begin
  v_actor := public.procurement_require_actor(p_actor_user_id, 'admin');
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'REQUEST_ID_REQUIRED';
  end if;
  if p_note is not null and length(p_note) > 500 then
    raise exception 'NOTE_TOO_LONG';
  end if;

  select *
  into v_original
  from public.procurement_audit_events e
  where e.id = p_audit_event_id;

  if not found then
    raise exception 'AUDIT_EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.procurement_audit_events e where e.undo_of = v_original.id
  ) then
    raise exception 'AUDIT_EVENT_ALREADY_UNDONE' using errcode = '40001';
  end if;

  if v_original.module = 'SUPPLIER_REVIEW'
     and v_original.event_type in (
       'SUPPLIER_APPROVED', 'SUPPLIER_REJECTED', 'SUPPLIER_CHANGED', 'NEEDS_SUPPLIER'
     ) then
    select *
    into v_supplier_current
    from public.procurement_supplier_reviews r
    where r.product_code = v_original.entity_key
    for update;

    if not found
       or v_original.new_data is null
       or v_supplier_current.version <> (v_original.new_data ->> 'version')::bigint then
      raise exception 'UNDO_STATE_CONFLICT' using errcode = '40001';
    end if;

    v_current_json := to_jsonb(v_supplier_current);
    if v_original.old_data is null or v_original.old_data = 'null'::jsonb then
      delete from public.procurement_supplier_reviews
      where product_code = v_original.entity_key;
      v_restored_json := null;
    else
      update public.procurement_supplier_reviews set
        approved_supplier_id = nullif(v_original.old_data ->> 'approved_supplier_id', '')::bigint,
        approved_supplier_name = v_original.old_data ->> 'approved_supplier_name',
        status = v_original.old_data ->> 'status',
        note = v_original.old_data ->> 'note',
        version = v_supplier_current.version + 1,
        updated_at = now(),
        updated_by = p_actor_user_id
      where product_code = v_original.entity_key
      returning * into v_supplier_restored;
      v_restored_json := to_jsonb(v_supplier_restored);
    end if;

  elsif v_original.module = 'PRODUCT_SETTINGS'
        and v_original.event_type in (
          'PRODUCT_RULE_UPDATED', 'PRODUCT_RULES_BULK_UPDATED'
        ) then
    select *
    into v_rule_current
    from public.procurement_product_rules r
    where r.product_code = v_original.entity_key
    for update;

    if not found
       or v_original.new_data is null
       or v_rule_current.version <> (v_original.new_data ->> 'version')::bigint then
      raise exception 'UNDO_STATE_CONFLICT' using errcode = '40001';
    end if;

    v_current_json := to_jsonb(v_rule_current);
    if v_original.old_data is null or v_original.old_data = 'null'::jsonb then
      delete from public.procurement_product_rules
      where product_code = v_original.entity_key;
      v_restored_json := null;
    else
      update public.procurement_product_rules set
        lead_time_days = (v_original.old_data ->> 'lead_time_days')::integer,
        safety_stock_days = (v_original.old_data ->> 'safety_stock_days')::integer,
        order_multiple = (v_original.old_data ->> 'order_multiple')::numeric,
        version = v_rule_current.version + 1,
        updated_at = now(),
        updated_by = p_actor_user_id
      where product_code = v_original.entity_key
      returning * into v_rule_restored;
      v_restored_json := to_jsonb(v_rule_restored);
    end if;
  else
    raise exception 'UNDO_NOT_SUPPORTED';
  end if;

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
    undo_of,
    request_id
  ) values (
    'UNDO',
    v_original.module,
    v_original.entity_type,
    v_original.entity_key,
    v_actor.user_id,
    v_actor.display_name,
    v_actor.role,
    v_current_json,
    v_restored_json,
    p_note,
    v_original.id,
    btrim(p_request_id)
  )
  returning id into v_undo_id;

  return jsonb_build_object(
    'auditEventId', v_undo_id,
    'undoneEventId', v_original.id,
    'entityKey', v_original.entity_key,
    'state', v_restored_json
  );
end;
$function$;

revoke all on function public.procurement_require_actor(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.procurement_review_supplier_internal(
  text, text, bigint, text, bigint, text, uuid, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.procurement_update_product_rule_internal(
  text, integer, integer, bigint, text, uuid, text, uuid, text
) from public, anon, authenticated, service_role;

revoke all on function public.rpc_review_supplier(
  text, text, bigint, text, bigint, text, uuid, text, text
) from public, anon, authenticated;
revoke all on function public.rpc_bulk_approve_suppliers(jsonb, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.rpc_update_product_rule(
  text, integer, integer, bigint, text, uuid, text
) from public, anon, authenticated;
revoke all on function public.rpc_bulk_update_product_rules(
  jsonb, jsonb, text, uuid, text
) from public, anon, authenticated;
revoke all on function public.rpc_get_audit_log(
  uuid, timestamptz, timestamptz, uuid, text[], text[], text, text, boolean, boolean, text, integer, integer
) from public, anon, authenticated;
revoke all on function public.rpc_undo_audit_event(bigint, uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.rpc_review_supplier(
  text, text, bigint, text, bigint, text, uuid, text, text
) to service_role;
grant execute on function public.rpc_bulk_approve_suppliers(jsonb, uuid, text, text)
  to service_role;
grant execute on function public.rpc_update_product_rule(
  text, integer, integer, bigint, text, uuid, text
) to service_role;
grant execute on function public.rpc_bulk_update_product_rules(
  jsonb, jsonb, text, uuid, text
) to service_role;
grant execute on function public.rpc_get_audit_log(
  uuid, timestamptz, timestamptz, uuid, text[], text[], text, text, boolean, boolean, text, integer, integer
) to service_role;
grant execute on function public.rpc_undo_audit_event(bigint, uuid, text, text)
  to service_role;

commit;
