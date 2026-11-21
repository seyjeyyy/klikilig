alter table booth.config add column provider_checked_at timestamptz;
alter table booth.config add column provider_available boolean not null default false;

create or replace function booth.eligible(u uuid) returns boolean
language sql stable set search_path='' as $$
  select exists(select from booth.eligibility where uid=u and expires>now())
     and exists(select from booth.config where adult_enabled and provider_available
                and provider_checked_at > now()-interval '2 minutes')
$$;

create function public.booth_provider_health(observed_at timestamptz, available boolean)
returns void language sql security definer set search_path='' as $$
  update booth.config set provider_checked_at=least(now(),observed_at),provider_available=available
  where provider_checked_at is null or observed_at>=provider_checked_at
$$;
revoke all on function public.booth_provider_health(timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.booth_provider_health(timestamptz,boolean) to service_role;
