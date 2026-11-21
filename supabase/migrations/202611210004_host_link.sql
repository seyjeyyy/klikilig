create function public.booth_host_link_valid(rid uuid, secret_digest text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select from booth.rooms r join booth.invites i on i.room=r.id
    where r.id=rid and r.host=auth.uid() and not r.ended and r.expires>now()
      and not i.revoked and not i.consumed and i.digest=secret_digest
  )
$$;
revoke all on function public.booth_host_link_valid(uuid,text) from public,anon;
grant execute on function public.booth_host_link_valid(uuid,text) to authenticated;
