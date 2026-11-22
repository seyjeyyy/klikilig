import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("migration enforces invitation, member, capture and consent boundaries", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create schema realtime;create table auth.users(id uuid primary key,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;create table realtime.messages(extension text);create function realtime.topic() returns text language sql as $$ select ''::text $$;`,
    );
    for (const file of (await readdir("supabase/migrations")).sort())
      await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
    const ids = Array.from({ length: 3 }, () => crypto.randomUUID()),
      req = crypto.randomUUID(),
      token = "a".repeat(64),
      newToken = "b".repeat(64);
    for (const id of ids)
      await db.query("insert into auth.users(id) values($1)", [id]);
    const as = async (i) => {
      await db.exec("reset role");
      await db.query("select set_config('test.uid',$1,false)", [ids[i] || ""]);
      await db.exec("set role " + (i < 0 ? "anon" : "authenticated"));
    };
    const scalar = async (sql, args = []) =>
      Object.values((await db.query(sql, args)).rows[0])[0];
    await as(0);
    const create = (adult = false) =>
      scalar("select public.booth_create($1,$2,$3,$4,$5)", [
        req,
        "Our date",
        "Polaroid",
        token,
        adult,
      ]);
    await assert.rejects(create(true), /unavailable/);
    const room = await create();
    assert.equal(await create(), room);
    const action = (op, p = {}) =>
      scalar("select public.booth_action($1,$2,$3)", [
        room,
        op,
        JSON.stringify(p),
      ]);
    await as(-1);
    const original = await scalar("select public.booth_continue($1)", [token]);
    await assert.rejects(db.query("select * from booth.invites"));
    await as(0);
    assert.equal((await action("snapshot")).members.length, 1);
    await action("rotate", { digest: newToken });
    await as(1);
    await assert.rejects(
      db.query("select public.booth_invitation($1,false)", [original]),
      /expired/,
    );
    const handle = await scalar("select public.booth_continue($1)", [newToken]);
    await scalar("select public.booth_invitation($1,false)", [handle]);
    await assert.rejects(action("snapshot"), /unavailable/);
    await scalar("select public.booth_invitation($1,true)", [handle]);
    await scalar("select public.booth_invitation($1,true)", [handle]);
    await as(2);
    await assert.rejects(
      db.query("select public.booth_invitation($1,true)", [handle]),
      /taken/,
    );
    assert.equal(
      await scalar("select public.booth_channel($1)", ["booth:" + room]),
      false,
    );
    await as(1);
    assert.equal(
      await scalar("select public.booth_channel($1)", ["booth:" + room]),
      true,
    );
    await assert.rejects(action("schedule", { shot: 0, seconds: 3 }), /ready/);
    await action("ready", { value: true, shot: 0 });
    await as(0);
    await action("ready", { value: true, shot: 0 });
    const round = await action("schedule", { shot: 0, seconds: 10 });
    assert.equal(
      (await action("schedule", { shot: 0, seconds: 3 })).round.id,
      round.round.id,
    );
    await action("cancel");
    assert.ok((await action("snapshot")).members.every((x) => !x.ready));
    await action("ready", { shot: 0, value: true });
    await as(1);
    await action("ready", { shot: 0, value: true });
    const retry = await action("schedule", { shot: 0, seconds: 3 });
    assert.equal(retry.round.attempt, 2);
    assert.equal(retry.round.status, "pending");
    await action("cancel");
    await as(0);
    await action("approve", { revision: 0 });
    await action("edit", { revision: 0, patch: { caption: "Mahal kita" } });
    await assert.rejects(action("approve", { revision: 0 }), /approval/);
    await as(1);
    await db.exec("reset role");
    await db.exec("update booth.config set adult_enabled=true");
    await db.query("select public.booth_provider_health(now(),true)");
    await as(0);
    const adultToken = "c".repeat(64),
      adultReq = crypto.randomUUID();
    const makeAdult = () =>
      scalar("select public.booth_create($1,'Date','Polaroid',$2,true)", [
        adultReq,
        adultToken,
      ]);
    await assert.rejects(makeAdult(), /unavailable/);
    await assert.rejects(
      db.query(
        "select public.booth_eligibility_result($1,now()+interval '1 hour')",
        [ids[0]],
      ),
    );
    await db.exec("reset role");
    await db.query(
      "insert into booth.eligibility values($1,now()+interval '1 hour')",
      [ids[0]],
    );
    await as(0);
    const adultRoom = await makeAdult();
    const adultAction = (op, p = {}) =>
      scalar("select public.booth_action($1,$2,$3)", [
        adultRoom,
        op,
        JSON.stringify(p),
      ]);
    await as(1);
    const adultHandle = await scalar("select public.booth_continue($1)", [
      adultToken,
    ]);
    await assert.rejects(
      scalar("select public.booth_invitation($1,true)", [adultHandle]),
      /eligibility/,
    );
    await db.exec("reset role");
    await db.query(
      "insert into booth.eligibility values($1,now()+interval '1 hour')",
      [ids[1]],
    );
    await as(1);
    await scalar("select public.booth_invitation($1,true)", [adultHandle]);
    await adultAction("live");
    await assert.rejects(
      adultAction("ready", { value: true, shot: 0 }),
      /agree/,
    );
    await as(0);
    await adultAction("live");
    await adultAction("ready", { value: true, shot: 0 });
    await assert.rejects(
      adultAction("schedule", { seconds: 3, shot: 0 }),
      /ready/,
    );
    await as(1);
    await adultAction("ready", { value: true, shot: 0 });
    await adultAction("schedule", { seconds: 3, shot: 0 });
    await adultAction("stop");
    const stopped = await adultAction("snapshot");
    assert.ok(
      stopped.members.every((m) => !m.live && !m.ready && m.approved === null),
    );
    assert.equal(stopped.round.status, "cancelled");
    await db.exec("reset role");
    await db.query("select public.booth_provider_health(now(),false)");
    await as(1);
    await assert.rejects(adultAction("snapshot"), /Eligibility/);
    await db.exec("reset role");
    await db.query("select public.booth_provider_health(now(),true)");
    await as(1);
    await assert.rejects(adultAction("approve", { revision: 0 }), /approval/);
    await action("block");
    await assert.rejects(action("snapshot"), /unavailable/);
  } finally {
    await db.close();
  }
});
