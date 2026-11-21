create schema if not exists booth;
revoke all on schema booth from public, anon, authenticated;
create table booth.rooms (
 id uuid primary key default gen_random_uuid(), host uuid not null references auth.users on delete cascade,
 request_id uuid not null, title text not null check(length(title) between 1 and 80),
 layout text not null check(layout in ('3-shot strip','4-shot strip','Polaroid','Square collage')),
 adult boolean not null default false, expires timestamptz not null default now()+interval '24 hours',
 ended boolean not null default false, revision int not null default 0, editor jsonb not null default '{}',
 matched boolean not null default false, unique(host,request_id)
);
create table booth.members (
 room uuid references booth.rooms on delete cascade, uid uuid references auth.users on delete cascade,
 seat text not null check(seat in ('host','guest')), ready boolean not null default false,
 style int not null default 0 check(style between 0 and 30), strength int not null default 100 check(strength between 0 and 100),
 live boolean not null default false, approved int, primary key(room,uid), unique(room,seat)
);
create index on booth.members(uid);
create table booth.invites(room uuid references booth.rooms on delete cascade, digest text primary key check(length(digest)=64), revoked boolean not null default false, consumed boolean not null default false);
create unique index active_link on booth.invites(room) where not revoked;
create table booth.continuations(id uuid primary key default gen_random_uuid(),digest text references booth.invites on delete cascade,expires timestamptz default now()+interval '1 hour');
create table booth.rounds(id uuid primary key default gen_random_uuid(), sequence_no bigint generated always as identity,room uuid references booth.rooms on delete cascade,shot int check(shot between 0 and 3),attempt int not null,at timestamptz not null,visual jsonb not null,status text default 'pending' check(status in ('pending','done','cancelled')),acks uuid[] not null default '{}',unique(room,shot,attempt));
create index round_order on booth.rounds(room,sequence_no desc);
create unique index pending_round on booth.rounds(room) where status='pending';
create table booth.eligibility(uid uuid primary key references auth.users on delete cascade,expires timestamptz not null);
create table booth.config(singleton boolean primary key default true check(singleton),adult_enabled boolean not null default false);
insert into booth.config default values;
create table booth.blocks(owner uuid references auth.users on delete cascade,other uuid references auth.users on delete cascade,primary key(owner,other));
create table booth.reports(id uuid primary key default gen_random_uuid(),reporter uuid references auth.users on delete set null,subject uuid references auth.users on delete set null,reason text not null check(length(reason) between 1 and 1000),created timestamptz default now());
do $$ declare t record;begin for t in select tablename from pg_tables where schemaname='booth' loop execute format('alter table booth.%I enable row level security',t.tablename);end loop;end $$;
create function booth.eligible(u uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select from booth.eligibility where uid=u and expires>now()) and (select adult_enabled from booth.config)
$$;
create function public.booth_continue(secret_digest text) returns uuid language plpgsql security definer set search_path='' as $$
declare continuation uuid;begin
 insert into booth.continuations(digest) select i.digest from booth.invites i join booth.rooms r on r.id=i.room where digest=secret_digest and not revoked and not ended and expires>now() returning id into continuation;
 if continuation is null then raise exception 'This link has expired or been replaced. Ask your person for a new invitation.';end if;return continuation;end $$;
create function public.booth_account() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('eligible',booth.eligible(auth.uid()),'rooms',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'title',r.title,'expires',r.expires,'seat',m.seat,'claimed',exists(select from booth.members g where g.room=r.id and g.seat='guest')) order by r.expires desc) from booth.members m join booth.rooms r on r.id=m.room where m.uid=auth.uid() and not r.ended and r.expires>now()),'[]'))
$$;
create function public.booth_create(req uuid,title_input text,layout_input text,secret_digest text,is_adult boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid;begin
 if is_adult and not booth.eligible(auth.uid()) then raise exception 'Adult private is unavailable.';end if;
 insert into booth.rooms(host,request_id,title,layout,adult) values(auth.uid(),req,coalesce(nullif(trim(title_input),''),'Our photo date'),layout_input,is_adult) on conflict(host,request_id) do nothing returning id into rid;
 if rid is null then select id into rid from booth.rooms where host=auth.uid() and request_id=req;return rid;end if;
 insert into booth.members(room,uid,seat) values(rid,auth.uid(),'host');
 insert into booth.invites(room,digest) values(rid,secret_digest);return rid;end $$;
create function public.booth_invitation(handle uuid,accept_invite boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare r booth.rooms; i booth.invites; mine text;begin
 select rooms.* into r from booth.continuations c join booth.invites inv on inv.digest=c.digest join booth.rooms rooms on rooms.id=inv.room where c.id=handle and c.expires>now() for update of rooms;
 select inv.* into i from booth.invites inv join booth.continuations c using(digest) where c.id=handle;
 if r.id is null or r.ended or r.expires<=now() or i.revoked then raise exception 'Invitation expired, replaced, or ended. Ask for a new link.';end if;
 if exists(select from booth.blocks where (owner=r.host and other=auth.uid()) or (other=r.host and owner=auth.uid())) then raise exception 'This room is unavailable.';end if;
 select seat into mine from booth.members where room=r.id and uid=auth.uid();
 if i.consumed and mine is null then raise exception 'Both seats are taken.';end if;
 if accept_invite then
 if r.adult and not booth.eligible(auth.uid()) then raise exception 'Adult eligibility is required.';end if;
 if mine is null then insert into booth.members(room,uid,seat) values(r.id,auth.uid(),'guest');update booth.invites set consumed=true where digest=i.digest;end if;
 end if;
 return jsonb_build_object('id',r.id,'title',r.title,'adult',r.adult,'seat',mine);
end $$;
create function public.booth_action(rid uuid,op text,p jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare r booth.rooms;m booth.members;q booth.rounds;u uuid:=auth.uid();other_uid uuid;both_live boolean;begin
 select * into r from booth.rooms where id=rid for update;
 select * into m from booth.members where room=rid and uid=u;
 if m.uid is null or r.ended or r.expires<=clock_timestamp() then raise exception 'Room ended or unavailable.';end if;
 select uid into other_uid from booth.members where room=rid and uid<>u;
 if op='block' or op='report' then
 if other_uid is null then raise exception 'Partner has not joined.';end if;
 if op='block' then insert into booth.blocks values(u,other_uid) on conflict do nothing;update booth.rooms set ended=true where id=rid;
 else insert into booth.reports(reporter,subject,reason) values(u,other_uid,p->>'reason');end if;return '{}';end if;
 if op='end' and m.seat='host' then update booth.rooms set ended=true where id=rid;return '{}';end if;
 if r.adult and exists(select from booth.members where room=rid and not booth.eligible(uid)) then raise exception 'Eligibility expired.';end if;
 select count(*)=2 and bool_and(live) into both_live from booth.members where room=rid;
 select * into q from booth.rounds where room=rid and status='pending';
 if q.at<now()-interval '30 seconds' then update booth.rounds set status='cancelled' where id=q.id;q.id:=null;end if;
 case op
 when 'snapshot' then null;
 when 'rotate' then
 if m.seat<>'host' or other_uid is not null then raise exception 'An unused host invitation is required.';end if;
 update booth.invites set revoked=true where room=rid;insert into booth.invites(room,digest) values(rid,p->>'digest');
 when 'live' then update booth.members set live=true where uid=u and room=rid;
 when 'stop','cancel' then
 update booth.rounds set status='cancelled' where id=q.id;update booth.members set ready=false,approved=null,live=case when op='stop' then false else live end where room=rid;
 when 'ready' then
 if q.id is not null or (r.adult and not both_live) then raise exception 'Both partners must agree to live sharing.';end if;
 update booth.members set ready=(p->>'value')::boolean where room=rid and uid=u;
 when 'schedule' then
 if q.id is null then
 if (select count(*) from booth.members where room=rid and ready)<>2 or (r.adult and not both_live) then raise exception 'Both people must be ready.';end if;
 if (p->>'seconds')::int not in (3,5,10) then raise exception 'Invalid timer.';end if;
 insert into booth.rounds(room,shot,attempt,at,visual) select rid,(p->>'shot')::int,coalesce(max(attempt),0)+1,clock_timestamp()+make_interval(secs=>(p->>'seconds')::int),jsonb_build_object('editor',r.editor,'revision',r.revision,'members',(select jsonb_agg(to_jsonb(mm)) from booth.members mm where room=rid)) from booth.rounds where room=rid and shot=(p->>'shot')::int;
 update booth.members set ready=false,approved=null where room=rid;
 end if;
 when 'ack' then
 if q.id=(p->>'id')::uuid and q.at<=clock_timestamp() and not u=any(q.acks) then
 update booth.rounds set acks=array_append(acks,u),status=case when cardinality(acks)=1 then 'done' else 'pending' end where id=q.id;
 if cardinality(q.acks)=1 then update booth.rooms set revision=revision+1 where id=rid;end if;end if;
 when 'filter' then
 if q.id is not null then raise exception 'Finish the current shot first.';end if;
 update booth.rooms set matched=(p->>'match')::boolean where id=rid;
 update booth.members set style=(p->>'style')::int,strength=(p->>'strength')::int where room=rid and (uid=u or (p->>'match')::boolean);
 when 'edit' then
 if q.id is not null or (p->>'revision')::int<>r.revision or pg_column_size(p)>32000 then raise exception 'The editor changed. Try again.';end if;
 update booth.rooms set editor=editor || (p->'patch'),revision=revision+1 where id=rid;
 when 'approve' then
 if q.id is not null or (p->>'revision')::int<>r.revision or (r.adult and not both_live) then raise exception 'This revision needs fresh approval.';end if;
 update booth.members set approved=r.revision where room=rid and uid=u;
 else raise exception 'Unavailable action.';end case;
 select * into r from booth.rooms where id=rid;
 return jsonb_build_object('room',to_jsonb(r)-'request_id','me',u,'now',clock_timestamp(),'members',(select jsonb_agg((to_jsonb(mm)-'room')||jsonb_build_object('name',coalesce(nullif(a.raw_user_meta_data->>'display_name',''),'Partner')) order by mm.seat desc) from booth.members mm join auth.users a on a.id=mm.uid where mm.room=rid),'round',(select to_jsonb(rr) from booth.rounds rr where rr.room=rid order by rr.sequence_no desc limit 1));end $$;
create function public.booth_channel(topic text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select from booth.members m join booth.rooms r on r.id=m.room where m.uid=auth.uid() and topic='booth:'||r.id::text and not r.ended and r.expires>now() and (not r.adult or booth.eligible(m.uid)))
$$;
create policy booth_receive on realtime.messages for select to authenticated using(extension='broadcast' and public.booth_channel((select realtime.topic())));
create policy booth_send on realtime.messages for insert to authenticated with check(extension='broadcast' and public.booth_channel((select realtime.topic())));
do $$ declare f record;begin for f in select oid::regprocedure as sig from pg_proc where pronamespace='public'::regnamespace and proname like 'booth_%' loop execute format('revoke all on function %s from public, anon, authenticated',f.sig);execute format('grant execute on function %s to authenticated',f.sig);end loop;end $$;
grant execute on function public.booth_continue(text) to anon;

