begin;

create or replace function public.procurement_calculate_recommendation(
  p_daily_demand numeric,
  p_free_qty numeric,
  p_coverage_days integer,
  p_lead_time_days integer,
  p_safety_stock_days integer,
  p_order_multiple numeric,
  p_data_status text
)
returns table (
  forecast_qty numeric,
  lead_time_qty numeric,
  safety_stock_qty numeric,
  actual_coverage_days numeric,
  suggested_qty numeric,
  priority text
)
language sql
immutable
set search_path = public, pg_temp
as $$
  with normalized as (
    select
      greatest(coalesce(p_daily_demand, 0), 0) as daily_demand,
      coalesce(p_free_qty, 0) as free_qty,
      greatest(coalesce(p_coverage_days, 0), 0) as coverage_days,
      greatest(coalesce(p_lead_time_days, 0), 0) as lead_time_days,
      greatest(coalesce(p_safety_stock_days, 0), 0) as safety_stock_days,
      greatest(coalesce(p_order_multiple, 1), 0.000001) as order_multiple,
      case when p_data_status = 'SUFFICIENT' then 'SUFFICIENT' else 'INSUFFICIENT' end as data_status
  ), calculated as (
    select
      n.*,
      case
        when n.data_status = 'INSUFFICIENT' or n.daily_demand <= 0 then null
        else n.free_qty / nullif(n.daily_demand, 0)
      end as coverage
    from normalized n
  )
  select
    case
      when c.data_status = 'INSUFFICIENT' then null
      else c.daily_demand * c.coverage_days
    end as forecast_qty,
    case
      when c.data_status = 'INSUFFICIENT' then null
      else c.daily_demand * c.lead_time_days
    end as lead_time_qty,
    case
      when c.data_status = 'INSUFFICIENT' then null
      else c.daily_demand * c.safety_stock_days
    end as safety_stock_qty,
    c.coverage as actual_coverage_days,
    case
      when c.data_status = 'INSUFFICIENT' then null
      when c.daily_demand <= 0 then 0
      else ceil(
        greatest(
          c.daily_demand * (
            c.coverage_days + c.lead_time_days + c.safety_stock_days
          ) - c.free_qty,
          0
        ) / c.order_multiple
      ) * c.order_multiple
    end as suggested_qty,
    case
      when c.data_status = 'INSUFFICIENT' or c.daily_demand <= 0 then 'LOW'
      when c.coverage <= c.lead_time_days then 'CRITICAL'
      when c.coverage <= c.lead_time_days + c.safety_stock_days then 'HIGH'
      when c.coverage <= c.lead_time_days + c.safety_stock_days + c.coverage_days then 'MEDIUM'
      else 'LOW'
    end as priority
  from calculated c;
$$;

comment on function public.procurement_calculate_recommendation(
  numeric, numeric, integer, integer, integer, numeric, text
) is
  'Approved Procurement V1 formula. Insufficient data returns a null recommendation.';

create or replace function public.procurement_install_api_views()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if to_regclass('public.v_procurement_recommendation_configurable') is null then
    raise exception 'MISSING_PROCUREMENT_SOURCE_VIEW';
  end if;
  if to_regclass('public.v_procurement_sync_status_latest') is null then
    raise exception 'MISSING_SYNC_STATUS_SOURCE_VIEW';
  end if;
  if to_regclass('public.sync_logs') is null then
    raise exception 'MISSING_SYNC_LOGS_TABLE';
  end if;

  execute $view$
    create or replace view public.api_procurement_company_source
    with (security_invoker = true)
    as
    select
      r.company_id::bigint as company_id,
      r.company_name::text as company_name,
      r.product_id::bigint as product_id,
      btrim(r.product_code)::text as product_code,
      coalesce(
        nullif(btrim(r.effective_product_name), ''),
        nullif(btrim(r.product_name), ''),
        btrim(r.product_code)
      )::text as product_name,
      coalesce(r.available_quantity, 0)::numeric as free_qty,
      greatest(coalesce(r.effective_daily_demand, 0), 0)::numeric as effective_daily_demand,
      r.last_sale_date::date as last_sale_date,
      r.snapshot_at::timestamptz as snapshot_at,
      coalesce(pr.lead_time_days, 4)::integer as lead_time_days,
      coalesce(pr.safety_stock_days, 7)::integer as safety_stock_days,
      coalesce(pr.order_multiple, 1)::numeric as order_multiple,
      case
        when r.demand_method = 'MANUAL' and r.manual_daily_demand is not null then 'SUFFICIENT'
        when coalesce(r.sales_qty_90d, 0) > 0 and r.last_sale_date is not null then 'SUFFICIENT'
        else 'INSUFFICIENT'
      end::text as data_status
    from public.v_procurement_recommendation_configurable r
    left join public.procurement_product_rules pr
      on pr.product_code = r.product_code
    where r.product_code is not null
      and btrim(r.product_code) <> ''
  $view$;

  execute $view$
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
      r.supplier_id asc
  $view$;

  execute $view$
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
    where receipt_rank = 1
  $view$;

  execute $view$
    create or replace view public.api_sync_status
    with (security_invoker = true)
    as
    with source_status as (
      select
        s.sync_type,
        s.status,
        s.rows_count,
        s.message,
        s.started_at,
        s.finished_at
      from public.v_procurement_sync_status_latest s
    ), receipt_status as (
      select distinct on (l.sync_type)
        l.sync_type,
        l.status,
        l.rows_count,
        l.message,
        l.started_at,
        l.finished_at
      from public.sync_logs l
      where l.sync_type = 'supplier_receipts_by_company'
      order by l.sync_type, l.started_at desc
    ), combined as (
      select * from source_status
      union all
      select * from receipt_status
    )
    select
      c.sync_type,
      c.status,
      c.rows_count,
      c.message,
      c.started_at,
      c.finished_at,
      case
        when c.finished_at is null then 'RUNNING_OR_INCOMPLETE'
        when c.status <> 'success' then 'SYNC_ERROR'
        when c.finished_at >= now() - interval '8 hours' then 'UPDATED'
        when c.finished_at >= now() - interval '24 hours' then 'DELAYED'
        else 'CRITICAL'
      end::text as freshness_status
    from combined c
  $view$;

  execute 'revoke all on public.api_procurement_company_source from public, anon, authenticated';
  execute 'revoke all on public.api_latest_supplier_receipt from public, anon, authenticated';
  execute 'revoke all on public.api_supplier_history from public, anon, authenticated';
  execute 'revoke all on public.api_sync_status from public, anon, authenticated';

  execute 'grant select on public.api_procurement_company_source to service_role';
  execute 'grant select on public.api_latest_supplier_receipt to service_role';
  execute 'grant select on public.api_supplier_history to service_role';
  execute 'grant select on public.api_sync_status to service_role';
end;
$function$;

comment on function public.procurement_install_api_views() is
  'Creates stable Procurement V1 views after their existing production source views are available.';

create or replace function public.rpc_get_procurement_overview(
  p_company_id bigint default null,
  p_coverage_days integer default 14,
  p_search text default null,
  p_priorities text[] default array[]::text[],
  p_supplier_statuses text[] default array[]::text[],
  p_needs_purchase boolean default null,
  p_no_supplier boolean default null,
  p_insufficient_data boolean default null,
  p_sort text default 'priority',
  p_direction text default 'desc',
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
  v_result jsonb;
begin
  if to_regclass('public.api_procurement_company_source') is null then
    raise exception 'PROCUREMENT_API_VIEWS_NOT_INSTALLED';
  end if;
  if p_company_id is not null and p_company_id not in (1, 2) then
    raise exception 'INVALID_COMPANY_ID';
  end if;
  if p_coverage_days not in (7, 14, 21, 30) then
    raise exception 'INVALID_COVERAGE_DAYS';
  end if;
  if p_sort not in ('priority', 'suggestedQty', 'coverageDays', 'productName', 'latestReceipt') then
    raise exception 'INVALID_SORT';
  end if;
  if p_direction not in ('asc', 'desc') then
    raise exception 'INVALID_SORT_DIRECTION';
  end if;
  if p_page < 1 or p_page_size < 1 or p_page_size > 200 then
    raise exception 'INVALID_PAGINATION';
  end if;

  with company_rows as (
    select s.*
    from public.api_procurement_company_source s
    where p_company_id is null or s.company_id = p_company_id
  ), aggregated as (
    select
      s.product_code,
      max(s.product_name) as product_name,
      sum(s.free_qty)::numeric as free_qty,
      sum(s.effective_daily_demand)::numeric as effective_daily_demand,
      max(s.lead_time_days)::integer as lead_time_days,
      max(s.safety_stock_days)::integer as safety_stock_days,
      max(s.order_multiple)::numeric as order_multiple,
      max(s.last_sale_date) as last_sale_date,
      max(s.snapshot_at) as snapshot_at,
      case
        when bool_or(s.data_status = 'SUFFICIENT') then 'SUFFICIENT'
        else 'INSUFFICIENT'
      end::text as data_status
    from company_rows s
    group by s.product_code
  ), calculated as (
    select
      a.*,
      c.forecast_qty,
      c.lead_time_qty,
      c.safety_stock_qty,
      c.actual_coverage_days,
      c.suggested_qty,
      c.priority,
      lr.supplier_id as proposed_supplier_id,
      lr.supplier_name as proposed_supplier_name,
      lr.received_at as latest_receipt_at,
      sr.approved_supplier_id,
      sr.approved_supplier_name,
      case
        when sr.status is not null then sr.status
        when lr.supplier_id is null then 'NEEDS_SUPPLIER'
        else 'PENDING_REVIEW'
      end::text as supplier_status,
      coalesce(sr.version, 0)::bigint as version,
      case c.priority
        when 'CRITICAL' then 4
        when 'HIGH' then 3
        when 'MEDIUM' then 2
        else 1
      end as priority_rank
    from aggregated a
    cross join lateral public.procurement_calculate_recommendation(
      a.effective_daily_demand,
      a.free_qty,
      p_coverage_days,
      a.lead_time_days,
      a.safety_stock_days,
      a.order_multiple,
      a.data_status
    ) c
    left join public.api_latest_supplier_receipt lr
      on lr.product_code = a.product_code
    left join public.procurement_supplier_reviews sr
      on sr.product_code = a.product_code
  ), filtered as (
    select c.*
    from calculated c
    where
      (p_search is null or btrim(p_search) = '' or
        c.product_code ilike '%' || btrim(p_search) || '%' or
        c.product_name ilike '%' || btrim(p_search) || '%')
      and (coalesce(array_length(p_priorities, 1), 0) = 0 or c.priority = any(p_priorities))
      and (coalesce(array_length(p_supplier_statuses, 1), 0) = 0 or c.supplier_status = any(p_supplier_statuses))
      and (
        p_needs_purchase is null or
        (p_needs_purchase and c.suggested_qty > 0) or
        (not p_needs_purchase and c.suggested_qty = 0)
      )
      and (
        p_no_supplier is null or
        (p_no_supplier and c.proposed_supplier_id is null and c.approved_supplier_id is null) or
        (not p_no_supplier and (c.proposed_supplier_id is not null or c.approved_supplier_id is not null))
      )
      and (
        p_insufficient_data is null or
        (p_insufficient_data and c.data_status = 'INSUFFICIENT') or
        (not p_insufficient_data and c.data_status = 'SUFFICIENT')
      )
  ), summary as (
    select
      count(*)::integer as total_rows,
      count(*) filter (where suggested_qty > 0)::integer as needs_purchase,
      count(*) filter (where priority = 'CRITICAL')::integer as critical,
      coalesce(sum(suggested_qty) filter (where suggested_qty > 0), 0)::numeric as total_suggested_qty,
      count(*) filter (
        where proposed_supplier_id is null and approved_supplier_id is null
      )::integer as no_supplier,
      count(*) filter (where data_status = 'INSUFFICIENT')::integer as insufficient_data
    from filtered
  )
  select jsonb_build_object(
    'data', jsonb_build_object(
      'rows', coalesce((
        select jsonb_agg(q.row_json)
        from (
          select jsonb_build_object(
            'productCode', f.product_code,
            'productName', f.product_name,
            'freeQty', f.free_qty,
            'effectiveDailyDemand', f.effective_daily_demand,
            'forecastQty', f.forecast_qty,
            'leadTimeQty', f.lead_time_qty,
            'safetyStockQty', f.safety_stock_qty,
            'actualCoverageDays', f.actual_coverage_days,
            'leadTimeDays', f.lead_time_days,
            'safetyStockDays', f.safety_stock_days,
            'suggestedQty', f.suggested_qty,
            'priority', f.priority,
            'dataStatus', f.data_status,
            'proposedSupplierId', f.proposed_supplier_id,
            'proposedSupplierName', f.proposed_supplier_name,
            'approvedSupplierId', f.approved_supplier_id,
            'approvedSupplierName', f.approved_supplier_name,
            'supplierStatus', f.supplier_status,
            'latestReceiptAt', f.latest_receipt_at,
            'version', f.version
          ) as row_json
          from filtered f
          order by
            case when p_sort = 'priority' and p_direction = 'asc' then f.priority_rank end asc nulls last,
            case when p_sort = 'priority' and p_direction = 'desc' then f.priority_rank end desc nulls last,
            case when p_sort = 'suggestedQty' and p_direction = 'asc' then f.suggested_qty end asc nulls last,
            case when p_sort = 'suggestedQty' and p_direction = 'desc' then f.suggested_qty end desc nulls last,
            case when p_sort = 'coverageDays' and p_direction = 'asc' then f.actual_coverage_days end asc nulls last,
            case when p_sort = 'coverageDays' and p_direction = 'desc' then f.actual_coverage_days end desc nulls last,
            case when p_sort = 'productName' and p_direction = 'asc' then lower(f.product_name) end asc nulls last,
            case when p_sort = 'productName' and p_direction = 'desc' then lower(f.product_name) end desc nulls last,
            case when p_sort = 'latestReceipt' and p_direction = 'asc' then f.latest_receipt_at end asc nulls last,
            case when p_sort = 'latestReceipt' and p_direction = 'desc' then f.latest_receipt_at end desc nulls last,
            f.product_code asc
          limit p_page_size
          offset (p_page - 1) * p_page_size
        ) q
      ), '[]'::jsonb),
      'summary', jsonb_build_object(
        'needsPurchase', s.needs_purchase,
        'critical', s.critical,
        'totalSuggestedQty', s.total_suggested_qty,
        'noSupplier', s.no_supplier,
        'insufficientData', s.insufficient_data
      ),
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

create or replace function public.rpc_get_procurement_product_details(
  p_product_code text,
  p_company_id bigint default null,
  p_coverage_days integer default 14
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_overview jsonb;
  v_row jsonb;
  v_company_breakdown jsonb;
  v_supplier_history jsonb;
begin
  if p_product_code is null or btrim(p_product_code) = '' then
    raise exception 'PRODUCT_CODE_REQUIRED';
  end if;

  v_overview := public.rpc_get_procurement_overview(
    p_company_id,
    p_coverage_days,
    p_product_code,
    array[]::text[],
    array[]::text[],
    null,
    null,
    null,
    'priority',
    'desc',
    1,
    200
  );

  select item
  into v_row
  from jsonb_array_elements(v_overview #> '{data,rows}') item
  where item ->> 'productCode' = btrim(p_product_code)
  limit 1;

  if v_row is null then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'companyId', s.company_id,
    'companyName', s.company_name,
    'freeQty', s.free_qty,
    'effectiveDailyDemand', s.effective_daily_demand,
    'forecastQty', c.forecast_qty,
    'leadTimeQty', c.lead_time_qty,
    'safetyStockQty', c.safety_stock_qty,
    'actualCoverageDays', c.actual_coverage_days,
    'suggestedQty', c.suggested_qty,
    'priority', c.priority,
    'dataStatus', s.data_status,
    'lastSaleDate', s.last_sale_date,
    'snapshotAt', s.snapshot_at
  ) order by s.company_id), '[]'::jsonb)
  into v_company_breakdown
  from public.api_procurement_company_source s
  cross join lateral public.procurement_calculate_recommendation(
    s.effective_daily_demand,
    s.free_qty,
    p_coverage_days,
    s.lead_time_days,
    s.safety_stock_days,
    s.order_multiple,
    s.data_status
  ) c
  where s.product_code = btrim(p_product_code)
    and (p_company_id is null or s.company_id = p_company_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'supplierId', h.supplier_id,
    'supplierName', h.supplier_name,
    'companyId', h.company_id,
    'latestReceiptAt', h.latest_receipt_at,
    'receiptsCount', h.receipts_count,
    'latestReceivedQty', h.latest_received_qty,
    'latestUnitCost', h.latest_unit_cost
  ) order by h.latest_receipt_at desc, h.supplier_id asc), '[]'::jsonb)
  into v_supplier_history
  from public.api_supplier_history h
  where h.product_code = btrim(p_product_code)
    and (p_company_id is null or h.company_id = p_company_id);

  return jsonb_build_object(
    'data', v_row || jsonb_build_object(
      'companyBreakdown', v_company_breakdown,
      'supplierHistory', v_supplier_history
    ),
    'error', null
  );
end;
$function$;

create or replace function public.rpc_get_supplier_review_queue(
  p_company_id bigint default null,
  p_coverage_days integer default 14,
  p_statuses text[] default array['PENDING_REVIEW', 'NEEDS_SUPPLIER']::text[],
  p_needs_purchase boolean default true,
  p_page integer default 1,
  p_page_size integer default 50
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.rpc_get_procurement_overview(
    p_company_id,
    p_coverage_days,
    null,
    array[]::text[],
    p_statuses,
    p_needs_purchase,
    null,
    null,
    'priority',
    'desc',
    p_page,
    p_page_size
  );
$$;

revoke all on function public.procurement_calculate_recommendation(
  numeric, numeric, integer, integer, integer, numeric, text
) from public, anon, authenticated;
revoke all on function public.procurement_install_api_views()
  from public, anon, authenticated, service_role;
revoke all on function public.rpc_get_procurement_overview(
  bigint, integer, text, text[], text[], boolean, boolean, boolean, text, text, integer, integer
) from public, anon, authenticated;
revoke all on function public.rpc_get_procurement_product_details(text, bigint, integer)
  from public, anon, authenticated;
revoke all on function public.rpc_get_supplier_review_queue(
  bigint, integer, text[], boolean, integer, integer
) from public, anon, authenticated;

grant execute on function public.procurement_calculate_recommendation(
  numeric, numeric, integer, integer, integer, numeric, text
) to service_role;
grant execute on function public.rpc_get_procurement_overview(
  bigint, integer, text, text[], text[], boolean, boolean, boolean, text, text, integer, integer
) to service_role;
grant execute on function public.rpc_get_procurement_product_details(text, bigint, integer)
  to service_role;
grant execute on function public.rpc_get_supplier_review_queue(
  bigint, integer, text[], boolean, integer, integer
) to service_role;

do $$
begin
  if to_regclass('public.v_procurement_recommendation_configurable') is not null
     and to_regclass('public.v_procurement_sync_status_latest') is not null
     and to_regclass('public.sync_logs') is not null then
    perform public.procurement_install_api_views();
  end if;
end;
$$;

commit;
