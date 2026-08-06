begin;

create extension if not exists pgcrypto with schema extensions;

create or replace function public.rpc_verify_bcrypt(
  p_password text,
  p_hash text
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select
    p_password is not null
    and p_hash is not null
    and p_hash ~ '^\$2[aby]\$[0-9]{2}\$'
    and extensions.crypt(p_password, p_hash) = p_hash;
$$;

revoke all on function public.rpc_verify_bcrypt(text, text)
  from public, anon, authenticated;
grant execute on function public.rpc_verify_bcrypt(text, text)
  to service_role;

commit;
