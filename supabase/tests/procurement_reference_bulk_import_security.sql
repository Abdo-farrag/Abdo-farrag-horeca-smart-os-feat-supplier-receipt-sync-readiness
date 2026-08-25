begin;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'procurement_reference_import_batches'
      and column_name = 'normalized_rows'
      and data_type = 'jsonb'
  ) then
    raise exception 'normalized preview rows are not persisted';
  end if;

  if to_regprocedure(
    'public.apply_procurement_reference_import(uuid,uuid,text)'
  ) is null then
    raise exception 'safe batch-only apply RPC is missing';
  end if;

  if to_regprocedure(
    'public.apply_procurement_reference_import(uuid,uuid,text,jsonb)'
  ) is not null then
    raise exception 'unsafe caller-supplied rows apply RPC still exists';
  end if;
end
$$;

select plan(4);

select has_column(
  'public',
  'procurement_reference_import_batches',
  'normalized_rows',
  'preview batches persist normalized rows'
);

select function_returns(
  'public',
  'apply_procurement_reference_import',
  array['uuid', 'uuid', 'text'],
  'jsonb',
  'apply uses immutable stored preview rows'
);

select results_eq(
  $$
    select count(*)::bigint
    from information_schema.routine_privileges
    where specific_schema = 'public'
      and routine_name in (
        'record_procurement_reference_import_preview',
        'apply_procurement_reference_import'
      )
      and grantee in ('anon', 'authenticated', 'PUBLIC')
      and privilege_type = 'EXECUTE'
  $$,
  array[0::bigint],
  'bulk import RPCs are service-role only'
);

select results_eq(
  $$
    select count(*)::bigint
    from information_schema.usage_privileges
    where object_schema = 'public'
      and object_name = 'procurement_reference_import_errors_id_seq'
      and grantee in ('anon', 'authenticated', 'PUBLIC')
      and privilege_type = 'USAGE'
  $$,
  array[0::bigint],
  'import error identity sequence is service-role only'
);

select * from finish();

rollback;
