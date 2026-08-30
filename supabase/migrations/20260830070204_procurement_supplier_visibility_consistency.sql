-- Keep supplier visibility consistent between the overview and company review.
-- Active imported/Odoo vendor links are valid fallbacks even when they are not primary.

do $migration$
declare
  v_original text;
  v_definition text;
begin
  v_definition := pg_get_viewdef(
    'public.api_company_purchase_review_supplier_base'::regclass,
    true
  );

  if position('AND v.is_primary = true' in v_definition) > 0 then
    v_definition := replace(
      v_definition,
      'AND v.is_primary = true',
      'AND (upper(btrim(sd.supplier_name)) <> ALL (ARRAY[''MAS''::text, ''HORECA SMART''::text, ''HORECA''::text, ''HORECA SMART OS''::text]))'
    );
    v_definition := replace(
      v_definition,
      'ORDER BY v.sequence, v.supplier_id',
      'ORDER BY v.is_primary DESC, v.sequence, v.supplier_id'
    );

    execute
      'create or replace view public.api_company_purchase_review_supplier_base ' ||
      'with (security_invoker = true) as ' || v_definition;
  elsif position('ORDER BY v.is_primary DESC' in v_definition) = 0
     or position('HORECA SMART OS' in v_definition) = 0 then
    raise exception 'COMPANY_REVIEW_VENDOR_FALLBACK_CONTRACT_MISMATCH';
  end if;

  select pg_get_functiondef(
    'public.rpc_get_procurement_overview(bigint,integer,text,text[],text[],boolean,boolean,boolean,text,text,integer,integer)'::regprocedure
  )
  into v_definition;

  if position('coalesce(ov.supplier_id, lr.supplier_id)' in v_definition) = 0 then
    v_original := v_definition;

    v_definition := replace(
      v_definition,
      '      lr.supplier_id as proposed_supplier_id,
      lr.supplier_name as proposed_supplier_name,',
      '      coalesce(ov.supplier_id, lr.supplier_id) as proposed_supplier_id,
      coalesce(ov.supplier_name, lr.supplier_name) as proposed_supplier_name,'
    );
    v_definition := replace(
      v_definition,
      '        when lr.supplier_id is null then ''NEEDS_SUPPLIER''',
      '        when coalesce(ov.supplier_id, lr.supplier_id) is null then ''NEEDS_SUPPLIER'''
    );
    v_definition := replace(
      v_definition,
      '    left join public.api_latest_supplier_receipt lr
      on lr.product_code = a.product_code
    left join public.procurement_supplier_reviews sr',
      '    left join public.api_latest_supplier_receipt lr
      on lr.product_code = a.product_code
    left join lateral (
      select
        v.supplier_id,
        sd.supplier_name
      from public.api_procurement_effective_product_vendors v
      join public.procurement_supplier_directory sd
        on sd.odoo_supplier_id = v.supplier_id
      where v.product_code = a.product_code
        and v.active = true
        and (p_company_id is null or v.company_id = p_company_id)
        and upper(btrim(sd.supplier_name)) not in (
          ''MAS'', ''HORECA SMART'', ''HORECA'', ''HORECA SMART OS''
        )
      order by v.is_primary desc, v.sequence asc, v.company_id asc, v.supplier_id asc
      limit 1
    ) ov on true
    left join public.procurement_supplier_reviews sr'
    );

    if v_definition = v_original
       or position('coalesce(ov.supplier_id, lr.supplier_id)' in v_definition) = 0
       or position('left join lateral (' in v_definition) = 0 then
      raise exception 'OVERVIEW_VENDOR_FALLBACK_PATCH_NOT_APPLIED';
    end if;

    execute v_definition;
  elsif position('HORECA SMART OS' in v_definition) = 0
     or position('v.is_primary desc' in lower(v_definition)) = 0 then
    raise exception 'OVERVIEW_VENDOR_FALLBACK_CONTRACT_MISMATCH';
  end if;
end
$migration$;
