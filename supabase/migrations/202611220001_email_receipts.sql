-- A receipt proves a confirmed email on the request after Set-Cookie. It cannot sign anyone in.
create table booth.email_receipts (
  account uuid primary key references auth.users on delete cascade,
  ticket uuid unique not null default gen_random_uuid(),
  intent text not null check (intent in ('dashboard','create','invite')),
  expires timestamptz not null default now()+interval '5 minutes'
);
alter table booth.email_receipts enable row level security;
create index on booth.email_receipts(expires);

create function public.issue_email_receipt(destination text) returns uuid
language plpgsql security definer set search_path='' as $$
declare issued uuid;
begin
  if not exists(select from auth.users where id=auth.uid() and email_confirmed_at is not null)
  then raise exception 'Email confirmation required'; end if;
  delete from booth.email_receipts where expires<=now();
  insert into booth.email_receipts(account,intent) values(auth.uid(),destination)
    on conflict(account) do update set intent=excluded.intent,ticket=excluded.ticket,expires=excluded.expires
    returning ticket into issued;
  return issued;
end $$;
create function public.consume_email_receipt(receipt uuid) returns jsonb
language sql security definer set search_path='' as $$
  delete from booth.email_receipts where ticket=receipt and expires>now()
  returning jsonb_build_object('signed_in',account is not distinct from auth.uid(),'intent',intent)
$$;
revoke all on function public.issue_email_receipt(text),public.consume_email_receipt(uuid) from public,anon,authenticated;
grant execute on function public.issue_email_receipt(text) to authenticated;
grant execute on function public.consume_email_receipt(uuid) to anon,authenticated;

