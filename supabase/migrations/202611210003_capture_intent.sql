alter table booth.members add column intended_shot int check(intended_shot between 0 and 3);
alter table booth.members add column intended_attempt int;
alter function public.booth_action(uuid,text,jsonb) set schema booth;
revoke all on function booth.booth_action(uuid,text,jsonb) from public,anon,authenticated;
create function public.booth_action(rid uuid,op text,p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare r booth.rooms; m booth.members; next_attempt int; shot_no int; patch jsonb; v jsonb; point jsonb; max_shots int;
begin
 select * into r from booth.rooms where id=rid for update;
 select * into m from booth.members where room=rid and uid=auth.uid();
 if m.uid is null or r.ended or r.expires<=clock_timestamp() then raise exception 'Room ended or unavailable.';end if;
 if op in ('ready','schedule') then
 shot_no=coalesce((p->>'shot')::int,0);
 max_shots=case coalesce(r.editor->>'layout',r.layout) when 'Polaroid' then 1 when '3-shot strip' then 3 else 4 end;
 if shot_no<0 or shot_no>=max_shots then raise exception 'Choose an available shot.';end if;
 select coalesce(max(attempt),0)+1 into next_attempt from booth.rounds where room=rid and shot=shot_no;
 if op='ready' then update booth.members set intended_shot=shot_no,intended_attempt=next_attempt where room=rid and uid=auth.uid();
 elsif not exists(select from booth.rounds where room=rid and status='pending') and exists(select from booth.members where room=rid and (intended_shot is distinct from shot_no or intended_attempt is distinct from next_attempt)) then raise exception 'Both people must be ready for this shot.';end if;
 end if;
 if op='edit' then
 patch=p->'patch';
 if jsonb_typeof(patch) is distinct from 'object' or patch - array['caption','layout','frame','date','names','places','stickers','doodles','effect'] <> '{}'::jsonb then raise exception 'Invalid editor settings.';end if;
 if length(patch->>'caption')>180 or length(patch->>'date')>12 or patch->>'layout' not in ('3-shot strip','4-shot strip','Polaroid','Square collage') or patch->>'frame' not in ('Cream','Film border','Lace','Gingham','Floral') then raise exception 'Invalid postcard settings.';end if;
 for v in select value from jsonb_each(patch) where key in ('names','places') loop
 if jsonb_typeof(v)<>'array' or jsonb_array_length(v)<>2 or exists(select from jsonb_array_elements(v) x where jsonb_typeof(x)<>'string' or length(x::text)>82) then raise exception 'Use two short text labels.';end if;end loop;
 if patch?'effect' then v=patch->'effect';
 if v-array['name','size','x','y','include']<>'{}'::jsonb or v->>'name' not in ('Off','Shared Heart','Starlight','Floating Hearts') or jsonb_typeof(v->'include')<>'boolean' or not ((v->>'x')::numeric between 0 and 1 and (v->>'y')::numeric between 0 and 1 and (v->>'size')::numeric between 0 and 1) then raise exception 'Invalid effect.';end if;end if;
 if patch?'stickers' then
 if jsonb_array_length(patch->'stickers')>24 then raise exception 'Sticker limit reached.';end if;
 for v in select value from jsonb_array_elements(patch->'stickers') loop if v-array['x','y','size','text']<>'{}'::jsonb or length(v->>'text')>8 then raise exception 'Invalid sticker.';end if;end loop;end if;
 if patch?'doodles' then
 if jsonb_array_length(patch->'doodles')>30 then raise exception 'Doodle limit reached.';end if;
 for v in select value from jsonb_array_elements(patch->'doodles') loop
 if v-array['points','width','color']<>'{}'::jsonb or jsonb_array_length(v->'points')>200 or length(v->>'color')>9 then raise exception 'Invalid doodle.';end if;
 for point in select value from jsonb_array_elements(v->'points') loop if point-array['x','y']<>'{}'::jsonb or not ((point->>'x')::numeric between 0 and 1 and (point->>'y')::numeric between 0 and 1) then raise exception 'Invalid coordinates.';end if;end loop;end loop;end if;
 update booth.members set ready=false,approved=null where room=rid;
 end if;
 return booth.booth_action(rid,op,p);
end $$;
revoke all on function public.booth_action(uuid,text,jsonb) from public,anon;
grant execute on function public.booth_action(uuid,text,jsonb) to authenticated;

