revoke all on sequence public.procurement_reference_import_errors_id_seq
  from public, anon, authenticated;
grant usage, select on sequence public.procurement_reference_import_errors_id_seq
  to service_role;
