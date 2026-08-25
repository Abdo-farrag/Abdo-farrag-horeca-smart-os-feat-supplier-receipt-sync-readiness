-- Baseline for the Supabase-owned procurement reference override layer.
-- This migration intentionally never updates Odoo-synchronized source tables.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.procurement_reference_import_batches (
  id uuid primary key default gen_random_uuid(),
  original_filename text not null check (length(btrim(original_filename)) between 1 and 255),
  file_checksum text not null unique check (length(btrim(file_checksum)) between 16 and 128),
  template_version text not null default '1.0' check (length(btrim(template_version)) between 1 and 40),
  status text not null default 'PREVIEWED' check (status in ('PREVIEWED','APPLYING','APPLIED','FAILED')),
  total_rows integer not null default 0 check (total_rows >= 0),
  valid_rows integer not null default 0 check (valid_rows >= 0),
  invalid_rows integer not null default 0 check (invalid_rows >= 0),
  inserted_rows integer not null default 0 check (inserted_rows >= 0),
  updated_rows integer not null default 0 check (updated_rows >= 0),
  unchanged_rows integer not null default 0 check (unchanged_rows >= 0),
  skipped_rows integer not null default 0 check (skipped_rows >= 0),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_display_name text check (actor_display_name is null or length(actor_display_name) <= 160),
  failure_reason text check (failure_reason is null or length(failure_reason) <= 1000),
  normalized_rows jsonb not null default '[]'::jsonb check (jsonb_typeof(normalized_rows) = 'array'),
  previewed_at timestamptz not null default now(),
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_rows + invalid_rows <= total_rows)
);

create table if not exists public.procurement_reference_import_errors (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.procurement_reference_import_batches(id) on delete cascade,
  row_number integer not null check (row_number > 0),
  severity text not null default 'ERROR' check (severity in ('ERROR','WARNING')),
  error_code text not null check (length(btrim(error_code)) between 1 and 80),
  error_message text not null check (length(btrim(error_message)) between 1 and 1000),
  original_row jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.procurement_product_vendor_overrides (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null check (company_id > 0),
  product_code text not null references public.procurement_product_purchase_metadata(product_code)
    on update cascade on delete restrict check (btrim(product_code) <> ''),
  supplier_id bigint not null references public.procurement_supplier_directory(odoo_supplier_id)
    on update cascade on delete restrict,
  supplier_product_code text check (supplier_product_code is null or length(btrim(supplier_product_code)) between 1 and 120),
  purchase_uom_code text check (purchase_uom_code is null or length(btrim(purchase_uom_code)) between 1 and 80),
  purchase_uom_name text check (purchase_uom_name is null or length(btrim(purchase_uom_name)) between 1 and 120),
  pack_size numeric check (pack_size is null or pack_size >= 0),
  minimum_qty numeric check (minimum_qty is null or minimum_qty >= 0),
  price numeric check (price is null or price >= 0),
  currency_code text not null default 'EGP' check (currency_code ~ '^[A-Z]{3}$'),
  delay_days integer check (delay_days is null or delay_days >= 0),
  sequence integer not null default 10 check (sequence >= 0),
  is_primary boolean not null default false,
  active boolean not null default true,
  source text not null default 'BULK_IMPORT' check (length(btrim(source)) between 1 and 40),
  import_batch_id uuid references public.procurement_reference_import_batches(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,product_code,supplier_id)
);

create table if not exists public.procurement_product_brand_overrides (
  product_code text primary key references public.procurement_product_purchase_metadata(product_code)
    on update cascade on delete restrict,
  brand_id bigint check (brand_id is null or brand_id > 0),
  brand_name text not null check (length(btrim(brand_name)) between 1 and 160),
  active boolean not null default true,
  source text not null default 'BULK_IMPORT' check (length(btrim(source)) between 1 and 40),
  import_batch_id uuid references public.procurement_reference_import_batches(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.procurement_reference_import_batches enable row level security;
alter table public.procurement_reference_import_errors enable row level security;
alter table public.procurement_product_vendor_overrides enable row level security;
alter table public.procurement_product_brand_overrides enable row level security;

create index if not exists procurement_reference_import_errors_batch_idx
  on public.procurement_reference_import_errors(batch_id,row_number);
create index if not exists procurement_reference_import_batches_actor_idx
  on public.procurement_reference_import_batches(actor_user_id) where actor_user_id is not null;
create index if not exists procurement_product_vendor_overrides_lookup_idx
  on public.procurement_product_vendor_overrides(company_id,product_code,active,sequence,supplier_id);
create index if not exists procurement_product_vendor_overrides_product_idx
  on public.procurement_product_vendor_overrides(product_code);
create index if not exists procurement_product_vendor_overrides_supplier_idx
  on public.procurement_product_vendor_overrides(supplier_id);
create unique index if not exists procurement_product_vendor_overrides_one_primary_idx
  on public.procurement_product_vendor_overrides(company_id,product_code)
  where active=true and is_primary=true;
create index if not exists procurement_product_vendor_overrides_batch_idx
  on public.procurement_product_vendor_overrides(import_batch_id) where import_batch_id is not null;
create index if not exists procurement_product_brand_overrides_batch_idx
  on public.procurement_product_brand_overrides(import_batch_id) where import_batch_id is not null;

CREATE OR REPLACE FUNCTION private.apply_procurement_reference_import_rows_internal(p_batch_id uuid, p_actor_user_id uuid, p_actor_display_name text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_batch public.procurement_reference_import_batches%rowtype;
  v_row jsonb;
  v_product_code text;
  v_company_id bigint;
  v_supplier_id bigint;
  v_supplier_code text;
  v_brand_name text;
  v_active boolean;
  v_is_primary boolean;
  v_existing public.procurement_product_vendor_overrides%rowtype;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_skipped integer := 0;
begin
  if jsonb_typeof(coalesce(p_rows,'[]'::jsonb)) <> 'array' then
    raise exception 'ROWS_MUST_BE_ARRAY';
  end if;

  select * into v_batch
  from public.procurement_reference_import_batches
  where id=p_batch_id
  for update;

  if not found then raise exception 'IMPORT_BATCH_NOT_FOUND'; end if;
  if v_batch.status='APPLIED' then raise exception 'IMPORT_BATCH_ALREADY_APPLIED'; end if;
  if v_batch.invalid_rows > 0 then raise exception 'IMPORT_HAS_BLOCKING_ERRORS'; end if;
  if jsonb_array_length(p_rows) <> v_batch.valid_rows then
    raise exception 'IMPORT_ROW_COUNT_MISMATCH';
  end if;

  update public.procurement_reference_import_batches
  set status='APPLYING',updated_at=now(),failure_reason=null
  where id=p_batch_id;

  create temporary table tmp_procurement_import_keys(
    company_id bigint,
    product_code text,
    supplier_id bigint,
    is_primary boolean
  ) on commit drop;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_product_code := nullif(btrim(v_row->>'product_code'),'');
    if v_product_code is null then raise exception 'PRODUCT_CODE_REQUIRED'; end if;

    if not exists (
      select 1 from public.procurement_product_purchase_metadata
      where product_code=v_product_code
    ) then raise exception 'UNKNOWN_PRODUCT_CODE: %',v_product_code; end if;

    v_brand_name := nullif(btrim(v_row->>'brand_name'),'');
    if v_row ? 'brand_name' then
      if v_brand_name is null then raise exception 'BRAND_NAME_CANNOT_BE_BLANK: %',v_product_code; end if;
      insert into public.procurement_product_brand_overrides(
        product_code,brand_id,brand_name,active,source,import_batch_id,
        created_by,updated_by,created_at,updated_at
      ) values (
        v_product_code,
        nullif(v_row->>'brand_id','')::bigint,
        v_brand_name,
        coalesce((v_row->>'brand_active')::boolean,true),
        'BULK_IMPORT',p_batch_id,p_actor_user_id,p_actor_user_id,now(),now()
      )
      on conflict (product_code) do update set
        brand_id=case when v_row ? 'brand_id' then excluded.brand_id else public.procurement_product_brand_overrides.brand_id end,
        brand_name=excluded.brand_name,
        active=excluded.active,
        source='BULK_IMPORT',
        import_batch_id=p_batch_id,
        updated_by=p_actor_user_id,
        updated_at=now();
    end if;

    if not (v_row ? 'supplier_id' or v_row ? 'supplier_code') then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_company_id := nullif(v_row->>'company_id','')::bigint;
    if v_company_id is null then raise exception 'COMPANY_ID_REQUIRED: %',v_product_code; end if;
    if not exists (
      select 1 from public.api_company_purchase_review
      where company_id=v_company_id and product_code=v_product_code
    ) then raise exception 'UNSUPPORTED_COMPANY_PRODUCT: %/%',v_company_id,v_product_code; end if;

    v_supplier_id := nullif(v_row->>'supplier_id','')::bigint;
    v_supplier_code := nullif(btrim(v_row->>'supplier_code'),'');

    if v_supplier_id is null and v_supplier_code is not null then
      select min(odoo_supplier_id)
      into v_supplier_id
      from public.procurement_supplier_directory
      where active=true and supplier_rank>0 and supplier_code=v_supplier_code
      having count(*)=1;
      if v_supplier_id is null then raise exception 'UNKNOWN_OR_AMBIGUOUS_SUPPLIER_CODE: %',v_supplier_code; end if;
    end if;

    if not exists (
      select 1 from public.procurement_supplier_directory
      where odoo_supplier_id=v_supplier_id and active=true and supplier_rank>0
    ) then raise exception 'SUPPLIER_NOT_SELECTABLE: %',v_supplier_id; end if;

    v_active := coalesce((v_row->>'active')::boolean,true);
    v_is_primary := coalesce((v_row->>'is_primary')::boolean,false);

    if nullif(v_row->>'pack_size','')::numeric < 0
       or nullif(v_row->>'minimum_qty','')::numeric < 0
       or nullif(v_row->>'price','')::numeric < 0
       or nullif(v_row->>'delay_days','')::integer < 0
       or nullif(v_row->>'sequence','')::integer < 0 then
      raise exception 'NEGATIVE_VALUE_NOT_ALLOWED: %/%/%',v_company_id,v_product_code,v_supplier_id;
    end if;

    if v_row ? 'currency_code'
       and upper(btrim(v_row->>'currency_code')) !~ '^[A-Z]{3}$' then
      raise exception 'INVALID_CURRENCY_CODE: %',v_row->>'currency_code';
    end if;

    insert into tmp_procurement_import_keys values(v_company_id,v_product_code,v_supplier_id,v_is_primary and v_active);

    select * into v_existing
    from public.procurement_product_vendor_overrides
    where company_id=v_company_id and product_code=v_product_code and supplier_id=v_supplier_id;

    if v_is_primary and v_active then
      update public.procurement_product_vendor_overrides
      set is_primary=false,updated_by=p_actor_user_id,updated_at=now(),import_batch_id=p_batch_id
      where company_id=v_company_id and product_code=v_product_code
        and supplier_id<>v_supplier_id and active=true and is_primary=true;
    end if;

    insert into public.procurement_product_vendor_overrides(
      company_id,product_code,supplier_id,supplier_product_code,
      purchase_uom_code,purchase_uom_name,pack_size,minimum_qty,price,
      currency_code,delay_days,sequence,is_primary,active,source,
      import_batch_id,created_by,updated_by,created_at,updated_at
    ) values (
      v_company_id,v_product_code,v_supplier_id,
      nullif(btrim(v_row->>'supplier_product_code'),''),
      nullif(btrim(v_row->>'purchase_uom_code'),''),
      nullif(btrim(v_row->>'purchase_uom_name'),''),
      nullif(v_row->>'pack_size','')::numeric,
      nullif(v_row->>'minimum_qty','')::numeric,
      nullif(v_row->>'price','')::numeric,
      coalesce(nullif(upper(btrim(v_row->>'currency_code')),''),'EGP'),
      nullif(v_row->>'delay_days','')::integer,
      coalesce(nullif(v_row->>'sequence','')::integer,10),
      v_is_primary,v_active,'BULK_IMPORT',p_batch_id,
      p_actor_user_id,p_actor_user_id,now(),now()
    )
    on conflict (company_id,product_code,supplier_id) do update set
      supplier_product_code=case when v_row ? 'supplier_product_code' then excluded.supplier_product_code else public.procurement_product_vendor_overrides.supplier_product_code end,
      purchase_uom_code=case when v_row ? 'purchase_uom_code' then excluded.purchase_uom_code else public.procurement_product_vendor_overrides.purchase_uom_code end,
      purchase_uom_name=case when v_row ? 'purchase_uom_name' then excluded.purchase_uom_name else public.procurement_product_vendor_overrides.purchase_uom_name end,
      pack_size=case when v_row ? 'pack_size' then excluded.pack_size else public.procurement_product_vendor_overrides.pack_size end,
      minimum_qty=case when v_row ? 'minimum_qty' then excluded.minimum_qty else public.procurement_product_vendor_overrides.minimum_qty end,
      price=case when v_row ? 'price' then excluded.price else public.procurement_product_vendor_overrides.price end,
      currency_code=case when v_row ? 'currency_code' then excluded.currency_code else public.procurement_product_vendor_overrides.currency_code end,
      delay_days=case when v_row ? 'delay_days' then excluded.delay_days else public.procurement_product_vendor_overrides.delay_days end,
      sequence=case when v_row ? 'sequence' then excluded.sequence else public.procurement_product_vendor_overrides.sequence end,
      is_primary=excluded.is_primary,
      active=excluded.active,
      source='BULK_IMPORT',
      import_batch_id=p_batch_id,
      updated_by=p_actor_user_id,
      updated_at=now();

    if v_existing.id is null then v_inserted := v_inserted+1;
    else v_updated := v_updated+1;
    end if;
  end loop;

  if exists (
    select 1 from tmp_procurement_import_keys
    group by company_id,product_code
    having count(*) filter(where is_primary)>1
  ) then raise exception 'MULTIPLE_PRIMARY_SUPPLIERS_IN_IMPORT'; end if;

  update public.procurement_reference_import_batches
  set status='APPLIED',inserted_rows=v_inserted,updated_rows=v_updated,
      unchanged_rows=v_unchanged,skipped_rows=v_skipped,
      actor_user_id=p_actor_user_id,
      actor_display_name=nullif(btrim(p_actor_display_name),''),
      applied_at=now(),updated_at=now()
  where id=p_batch_id;

  return jsonb_build_object(
    'batch_id',p_batch_id,'status','APPLIED','inserted',v_inserted,
    'updated',v_updated,'unchanged',v_unchanged,'skipped',v_skipped
  );
end;
$function$

CREATE OR REPLACE FUNCTION private.record_procurement_reference_import_preview_internal(p_original_filename text, p_file_checksum text, p_template_version text, p_actor_user_id uuid, p_actor_display_name text, p_total_rows integer, p_valid_rows integer, p_invalid_rows integer, p_errors jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_batch_id uuid;
  v_error jsonb;
  v_status text;
begin
  if p_total_rows < 0 or p_valid_rows < 0 or p_invalid_rows < 0
     or p_valid_rows + p_invalid_rows > p_total_rows then
    raise exception 'INVALID_IMPORT_COUNTS';
  end if;
  if jsonb_typeof(coalesce(p_errors, '[]'::jsonb)) <> 'array' then
    raise exception 'ERRORS_MUST_BE_ARRAY';
  end if;

  insert into public.procurement_reference_import_batches(
    original_filename, file_checksum, template_version, status,
    total_rows, valid_rows, invalid_rows, actor_user_id, actor_display_name
  ) values (
    btrim(p_original_filename), lower(btrim(p_file_checksum)),
    coalesce(nullif(btrim(p_template_version), ''), '1.0'), 'PREVIEWED',
    p_total_rows, p_valid_rows, p_invalid_rows, p_actor_user_id,
    nullif(btrim(p_actor_display_name), '')
  )
  on conflict (file_checksum) do update set
    original_filename=excluded.original_filename,
    template_version=excluded.template_version,
    total_rows=excluded.total_rows,
    valid_rows=excluded.valid_rows,
    invalid_rows=excluded.invalid_rows,
    actor_user_id=excluded.actor_user_id,
    actor_display_name=excluded.actor_display_name,
    previewed_at=now(),
    updated_at=now(),
    failure_reason=null,
    status=case
      when public.procurement_reference_import_batches.status='APPLIED'
        then public.procurement_reference_import_batches.status
      else 'PREVIEWED'
    end
  returning id,status into v_batch_id,v_status;

  if v_status='APPLIED' then
    raise exception 'IMPORT_FILE_ALREADY_APPLIED';
  end if;

  delete from public.procurement_reference_import_errors where batch_id=v_batch_id;
  for v_error in select value from jsonb_array_elements(coalesce(p_errors, '[]'::jsonb))
  loop
    insert into public.procurement_reference_import_errors(
      batch_id,row_number,severity,error_code,error_message,original_row
    ) values (
      v_batch_id,
      greatest(coalesce((v_error->>'row_number')::integer,1),1),
      case when upper(coalesce(v_error->>'severity','ERROR'))='WARNING' then 'WARNING' else 'ERROR' end,
      left(coalesce(nullif(btrim(v_error->>'error_code'),''),'VALIDATION_ERROR'),80),
      left(coalesce(nullif(btrim(v_error->>'error_message'),''),'Invalid row'),1000),
      coalesce(v_error->'original_row','{}'::jsonb)
    );
  end loop;
  return v_batch_id;
end;
$function$

CREATE OR REPLACE FUNCTION public.apply_procurement_reference_import(p_batch_id uuid, p_actor_user_id uuid, p_actor_display_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_rows jsonb;
  v_invalid_rows integer;
  v_status text;
begin
  select normalized_rows, invalid_rows, status
  into v_rows, v_invalid_rows, v_status
  from public.procurement_reference_import_batches
  where id = p_batch_id
  for update;

  if not found then raise exception 'IMPORT_BATCH_NOT_FOUND'; end if;
  if v_status = 'APPLIED' then raise exception 'IMPORT_BATCH_ALREADY_APPLIED'; end if;
  if v_invalid_rows > 0 then raise exception 'IMPORT_HAS_BLOCKING_ERRORS'; end if;

  return private.apply_procurement_reference_import_rows_internal(
    p_batch_id,
    p_actor_user_id,
    p_actor_display_name,
    v_rows
  );
end;
$function$

CREATE OR REPLACE FUNCTION public.record_procurement_reference_import_preview(p_original_filename text, p_file_checksum text, p_template_version text, p_actor_user_id uuid, p_actor_display_name text, p_total_rows integer, p_valid_rows integer, p_invalid_rows integer, p_rows jsonb, p_errors jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_batch_id uuid;
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'ROWS_MUST_BE_ARRAY';
  end if;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) <> p_valid_rows then
    raise exception 'IMPORT_ROW_COUNT_MISMATCH';
  end if;

  v_batch_id := private.record_procurement_reference_import_preview_internal(
    p_original_filename,
    p_file_checksum,
    p_template_version,
    p_actor_user_id,
    p_actor_display_name,
    p_total_rows,
    p_valid_rows,
    p_invalid_rows,
    p_errors
  );

  update public.procurement_reference_import_batches
  set normalized_rows = coalesce(p_rows, '[]'::jsonb),
      updated_at = now()
  where id = v_batch_id;

  return v_batch_id;
end;
$function$

create or replace view public.api_procurement_effective_product_brands with (security_invoker = true) as WITH products AS (
         SELECT source.product_code,
            min(source.product_name) AS product_name
           FROM api_procurement_company_source source
          WHERE source.product_code IS NOT NULL
          GROUP BY source.product_code
        )
 SELECT p.product_code,
    p.product_name,
        CASE
            WHEN bo.product_code IS NOT NULL AND bo.active THEN bo.brand_id
            WHEN bo.product_code IS NOT NULL AND NOT bo.active THEN NULL::bigint
            ELSE pm.brand_id
        END AS brand_id,
        CASE
            WHEN bo.product_code IS NOT NULL AND bo.active THEN bo.brand_name
            WHEN bo.product_code IS NOT NULL AND NOT bo.active THEN NULL::text
            ELSE pm.brand_name
        END AS brand_name,
        CASE
            WHEN bo.product_code IS NOT NULL AND bo.active THEN bo.source
            WHEN bo.product_code IS NOT NULL AND NOT bo.active THEN 'OVERRIDE_DISABLED'::text
            ELSE 'ODOO_SYNC'::text
        END AS effective_source,
    bo.import_batch_id,
    COALESCE(bo.updated_at, pm.updated_at) AS updated_at
   FROM products p
     LEFT JOIN procurement_product_brand_overrides bo ON bo.product_code = p.product_code
     LEFT JOIN procurement_product_purchase_metadata pm ON pm.product_code = p.product_code;

create or replace view public.api_procurement_effective_product_vendors with (security_invoker = true) as WITH companies(company_id) AS (
         VALUES (1::bigint), (2::bigint)
        ), odoo_expanded AS (
         SELECT c.company_id,
            vp.product_code,
            vp.supplier_id,
            NULL::text AS supplier_product_code,
            NULL::text AS purchase_uom_code,
            pm.purchase_uom_name,
            pm.order_multiple AS pack_size,
            vp.minimum_qty,
            vp.price,
            COALESCE(NULLIF(upper(btrim(vp.currency)), ''::text), 'EGP'::text) AS currency_code,
            vp.delay_days,
            vp.sequence,
            false AS is_primary,
            true AS active,
            'ODOO_SYNC'::text AS effective_source,
            NULL::uuid AS import_batch_id,
            vp.updated_at
           FROM procurement_product_vendor_prices vp
             JOIN companies c ON vp.company_id = c.company_id OR vp.company_id IS NULL
             LEFT JOIN procurement_product_purchase_metadata pm ON pm.product_code = vp.product_code
        )
 SELECT o.company_id,
    o.product_code,
    o.supplier_id,
    o.supplier_product_code,
    o.purchase_uom_code,
    o.purchase_uom_name,
    o.pack_size,
    o.minimum_qty,
    o.price,
    o.currency_code,
    o.delay_days,
    o.sequence,
    o.is_primary,
    o.active,
    o.source AS effective_source,
    o.import_batch_id,
    o.updated_at
   FROM procurement_product_vendor_overrides o
  WHERE o.active = true
UNION ALL
 SELECT s.company_id,
    s.product_code,
    s.supplier_id,
    s.supplier_product_code,
    s.purchase_uom_code,
    s.purchase_uom_name,
    s.pack_size,
    s.minimum_qty,
    s.price,
    s.currency_code,
    s.delay_days,
    s.sequence,
    s.is_primary,
    s.active,
    s.effective_source,
    s.import_batch_id,
    s.updated_at
   FROM odoo_expanded s
  WHERE NOT (EXISTS ( SELECT 1
           FROM procurement_product_vendor_overrides o
          WHERE o.company_id = s.company_id AND o.product_code = s.product_code AND o.supplier_id = s.supplier_id));

create or replace view public.api_procurement_product_reference_bulk_export with (security_invoker = true) as WITH products AS (
         SELECT api_company_purchase_review.company_id,
            min(api_company_purchase_review.company_name) AS company_name,
            api_company_purchase_review.product_code,
            min(api_company_purchase_review.product_name) AS product_name
           FROM api_company_purchase_review
          WHERE api_company_purchase_review.company_id IS NOT NULL AND api_company_purchase_review.product_code IS NOT NULL
          GROUP BY api_company_purchase_review.company_id, api_company_purchase_review.product_code
        )
 SELECT p.company_id,
    p.company_name,
    p.product_code,
    p.product_name,
    b.brand_id,
    b.brand_name,
    v.supplier_id,
    sd.supplier_code,
    sd.supplier_name,
    v.supplier_product_code,
    v.purchase_uom_code,
    COALESCE(v.purchase_uom_name, pm.purchase_uom_name) AS purchase_uom_name,
    COALESCE(v.pack_size, pm.order_multiple) AS pack_size,
    v.minimum_qty,
    v.price,
    v.currency_code,
    v.delay_days,
    v.sequence,
    v.is_primary,
    COALESCE(v.active, false) AS active,
    v.effective_source,
    b.effective_source AS brand_effective_source
   FROM products p
     LEFT JOIN api_procurement_effective_product_brands b ON b.product_code = p.product_code
     LEFT JOIN api_procurement_effective_product_vendors v ON v.company_id = p.company_id AND v.product_code = p.product_code
     LEFT JOIN procurement_supplier_directory sd ON sd.odoo_supplier_id = v.supplier_id
     LEFT JOIN procurement_product_purchase_metadata pm ON pm.product_code = p.product_code;

revoke all on all functions in schema private from public, anon, authenticated;
revoke all on table public.procurement_reference_import_batches from anon, authenticated;
revoke all on table public.procurement_reference_import_errors from anon, authenticated;
revoke all on table public.procurement_product_vendor_overrides from anon, authenticated;
revoke all on table public.procurement_product_brand_overrides from anon, authenticated;
grant select,insert,update,delete on public.procurement_reference_import_batches to service_role;
grant select,insert,update,delete on public.procurement_reference_import_errors to service_role;
grant select,insert,update,delete on public.procurement_product_vendor_overrides to service_role;
grant select,insert,update,delete on public.procurement_product_brand_overrides to service_role;
revoke all on sequence public.procurement_reference_import_errors_id_seq from public, anon, authenticated;
grant usage,select on sequence public.procurement_reference_import_errors_id_seq to service_role;
grant usage on schema private to service_role;
grant execute on all functions in schema private to service_role;
grant execute on function public.record_procurement_reference_import_preview(text,text,text,uuid,text,integer,integer,integer,jsonb,jsonb) to service_role;
grant execute on function public.apply_procurement_reference_import(uuid,uuid,text) to service_role;
grant select on public.api_procurement_effective_product_vendors to service_role;
grant select on public.api_procurement_effective_product_brands to service_role;
grant select on public.api_procurement_product_reference_bulk_export to service_role;
