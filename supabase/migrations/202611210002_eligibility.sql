-- Called only by the authenticated server-to-server eligibility integration.
create function public.booth_eligibility_result(subject uuid, valid_until timestamptz)
returns void language sql security definer set search_path='' as $$
 insert into booth.eligibility(uid,expires) values(subject,least(valid_until,now()+interval '30 days'))
 on conflict(uid) do update set expires=excluded.expires
$$;
revoke all on function public.booth_eligibility_result(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.booth_eligibility_result(uuid,timestamptz) to service_role;

-- Remove expired metadata from a privileged scheduled maintenance job.
create function booth.cleanup() returns void language plpgsql set search_path='' as $$
begin
 delete from booth.rooms where expires<now() or ended;
 delete from booth.continuations where expires<=now();
 delete from booth.eligibility where expires<=now();
 delete from booth.reports where created<now()-interval '90 days';
end $$;
revoke all on function booth.cleanup() from public, anon, authenticated;

