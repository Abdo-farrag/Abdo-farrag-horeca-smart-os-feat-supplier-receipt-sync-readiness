begin;

select plan(6);

select has_function('public', 'rpc_verify_bcrypt', array['text', 'text'], 'bcrypt verification RPC exists');
select is(
  public.rpc_verify_bcrypt('correct-password', extensions.crypt('correct-password', extensions.gen_salt('bf', 4))),
  true,
  'correct password verifies'
);
select is(
  public.rpc_verify_bcrypt('wrong-password', extensions.crypt('correct-password', extensions.gen_salt('bf', 4))),
  false,
  'incorrect password is rejected'
);
select ok(not has_function_privilege('anon', 'public.rpc_verify_bcrypt(text,text)', 'execute'), 'anon cannot execute bcrypt RPC');
select ok(not has_function_privilege('authenticated', 'public.rpc_verify_bcrypt(text,text)', 'execute'), 'authenticated cannot execute bcrypt RPC');
select ok(has_function_privilege('service_role', 'public.rpc_verify_bcrypt(text,text)', 'execute'), 'service role can execute bcrypt RPC');

select * from finish();
rollback;
