"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Camera, UserRound } from "lucide-react";
import { api } from "@/lib/shared";
import { BoothPeer } from "@/lib/peer";
import { filters, drawFrame } from "@/lib/visuals";
import { drawEffect, releaseEffects } from "@/lib/effects";
import { Snapshot, Member, Round, noEffect } from "@/lib/room-types";
import Share from "./share";
import EditorPanel from "./editor";
import { cardLayouts } from "@/lib/postcard";
type Bus = (t: string, b: Record<string, unknown>) => void;
function Tile({
  stream,
  member,
  local,
  seed,
}: {
  stream: MediaStream | null;
  member?: Member;
  local: boolean;
  seed: number;
}) {
  const video = useRef<HTMLVideoElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const v = video.current!,
      c = canvas.current!;
    v.srcObject = stream;
    if (stream) void v.play().catch(() => {});
    const tick = () => {
      const g = c.getContext("2d");
      if (
        v.readyState >= 2 &&
        stream?.getVideoTracks().some((t) => t.readyState === "live")
      )
        g?.drawImage(
          drawFrame(
            v,
            320,
            320,
            member?.style || 0,
            member?.strength ?? 100,
            seed,
            true,
          ),
          0,
          0,
        );
      else g?.clearRect(0, 0, 320, 320);
    };
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [stream, member?.style, member?.strength, seed]);
  return (
    <div className="tile">
      <UserRound />
      <video ref={video} playsInline autoPlay muted={local} />
      <canvas width={320} height={320} ref={canvas} />
      <small>
        {local ? "You" : member?.name || "Waiting for partner"} ·{" "}
        {member?.ready ? "Ready" : "Not ready"}
      </small>
    </div>
  );
}
function Thumbnail({ index }: { index: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () =>
      ref.current
        ?.getContext("2d")
        ?.drawImage(drawFrame(img, 64, 42, index, 100, 1, false), 0, 0);
    img.src = "/sample-1.webp";
  }, [index]);
  return <canvas ref={ref} width={64} height={42} />;
}
export default function Booth({
  initial,
  invite,
  reduced,
}: {
  initial: Snapshot;
  invite: boolean;
  reduced: boolean;
}) {
  const router = useRouter();
  useEffect(() => {
    document.documentElement.classList.toggle("reduced-motion", reduced);
  }, [reduced]);
  const [s, setSnapshot] = useState(initial),
    snap = useRef(s),
    [sharing, setSharing] = useState(invite),
    [msg, setMessage] = useState(""),
    [online, setOnline] = useState(false),
    onlineRef = useRef(false),
    stopPending = useRef(false),
    [local, setLocal] = useState<MediaStream | null>(null),
    [remote, setRemote] = useState<MediaStream | null>(null),
    [seconds, setSeconds] = useState(3),
    [index, setIndex] = useState(0),
    [remaining, setRemaining] = useState(0),
    [pairs, setPairs] = useState<string[]>([]),
    [guide, setGuide] = useState(false),
    [rear, setRearCamera] = useState(false),
    [mic, setMicrophoneEnabled] = useState(false),
    [remoteCamera, setRemoteCamera] = useState(false);
  const peer = useRef<BoothPeer | null>(null),
    stream = useRef<{ value: MediaStream | null }>({ value: null }),
    source = useRef<HTMLVideoElement | null>(null),
    overlay = useRef<HTMLCanvasElement>(null),
    offset = useRef(0),
    fired = useRef(""),
    busy = useRef(false),
    mediaGeneration = useRef(0),
    frames = useRef(
      new Map<string, { local?: string; remote?: string; combined?: string }>(),
    ),
    busRef = useRef<Bus>(() => {}),
    lastSnapshot = useRef(Date.parse(initial.now));
  const id = s.room.id,
    host = s.room.host === s.me,
    me = s.members.find((m) => m.uid === s.me)!,
    other = s.members.find((m) => m.uid !== s.me),
    effect = s.room.editor.effect || noEffect;
  const layout = s.room.editor.layout || s.room.layout,
    total = cardLayouts[layout as keyof typeof cardLayouts]?.shots || 3;
  const bothLive =
    !s.room.adult ||
    (!stopPending.current &&
      s.members.length === 2 &&
      s.members.every((m) => m.live));
  const pending = s.round?.status === "pending";
  function accept(next: Snapshot) {
    snap.current = next;
    setSnapshot(next);
  }
  async function act(op: string, p: Record<string, unknown> = {}) {
    if (op === "stop" && initial.room.adult) stopPending.current = true;
    const start = Date.now();
    const next = (await api("room", { id, op, p })) as Snapshot;
    if (op === "stop" && next.members?.every((m) => !m.live))
      stopPending.current = false;
    if (next.room && Date.parse(next.now) >= lastSnapshot.current) {
      lastSnapshot.current = Date.parse(next.now);
      accept(next);
      offset.current = Date.parse(next.now) - (start + Date.now()) / 2;
    }
    if (op !== "snapshot") peer.current?.small("refresh");
    return next;
  }
  function run(job: Promise<unknown>) {
    job.catch((e) => setMessage(e.message));
  }
  function clearMedia() {
    mediaGeneration.current++;
    stream.current.value?.getTracks().forEach((t) => t.stop());
    stream.current.value = null;
    setLocal(null);
    setMicrophoneEnabled(false);
    void peer.current?.tracks(new MediaStream());
    peer.current?.small("camera", { on: false });
  }
  function stop() {
    clearMedia();
    peer.current?.cancelTransfers();
    if (snap.current.room.adult) busRef.current("disconnect", {});
    peer.current?.small("stop");
    run(act("stop"));
  }
  async function camera(change = false) {
    if (busy.current) return;
    busy.current = true;
    const generation = mediaGeneration.current;
    try {
      if (!bothLive)
        throw Error("Both people must agree to live sharing first.");
      if (!navigator.mediaDevices)
        throw Error(
          "Reopen your original invitation in your device browser over HTTPS.",
        );
      const facing = change ? !rear : rear;
      const next = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing ? "environment" : "user" },
        audio: false,
      });
      if (
        generation !== mediaGeneration.current ||
        (snap.current.room.adult &&
          (!onlineRef.current || !snap.current.members.every((m) => m.live)))
      ) {
        next.getTracks().forEach((t) => t.stop());
        return;
      }
      clearMedia();
      stream.current.value = next;
      setLocal(next);
      setRearCamera(facing);
      const v = source.current!;
      v.srcObject = next;
      await v.play();
      await peer.current?.tracks(next);
      peer.current?.small("camera", { on: true });
      setMessage("");
    } catch {
      setMessage(
        "Camera unavailable. Check camera permissions, or reopen the original invitation in your phone’s device browser.",
      );
    } finally {
      busy.current = false;
    }
  }
  async function voice() {
    const media = stream.current.value;
    if (!media) return;
    if (mic) {
      media.getAudioTracks().forEach((t) => {
        t.stop();
        media.removeTrack(t);
      });
      setMicrophoneEnabled(false);
    } else {
      const audio = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (stream.current.value !== media) {
        audio.getTracks().forEach((t) => t.stop());
        return;
      }
      media.addTrack(audio.getAudioTracks()[0]);
      setMicrophoneEnabled(true);
    }
    await peer.current?.tracks(media);
  }
  async function combine(round: Round) {
    const parts = frames.current.get(round.id);
    if (
      !parts?.local ||
      !parts.remote ||
      parts.combined ||
      snap.current.round?.id !== round.id
    )
      return;
    const [left, right] = await Promise.all(
      (host ? [parts.local, parts.remote] : [parts.remote, parts.local]).map(
        async (url) => {
          const i = new Image();
          i.src = url;
          await i.decode();
          return i;
        },
      ),
    );
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 600;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(left, 0, 0, 600, 600);
    ctx.drawImage(right, 600, 0, 600, 600);
    const fx = round.visual.editor.effect;
    if (fx?.include) {
      const layer = document.createElement("canvas");
      layer.width = 1200;
      layer.height = 600;
      await drawEffect(layer, fx, Date.parse(round.at));
      ctx.drawImage(layer, 0, 0);
    }
    parts.combined = c.toDataURL("image/jpeg", 0.94);
    await act("ack", { id: round.id });
  }
  async function capture(round: Round) {
    const v = source.current,
      who = round.visual.members.find((m) => m.uid === initial.me)!;
    if (
      !v ||
      v.readyState < 2 ||
      !stream.current.value ||
      document.hidden ||
      !onlineRef.current ||
      Math.abs(Date.now() + offset.current - Date.parse(round.at)) > 1400
    ) {
      await act("cancel");
      const reason = document.hidden
        ? "This booth was in the background"
        : !onlineRef.current
          ? "The peer connection dropped"
          : !v || v.readyState < 2 || !stream.current.value
            ? "Your camera had no frame available"
            : "The shared capture time passed before your camera responded";
      throw Error(reason + ". Ready up and try again.");
    }
    const frame = drawFrame(
      v,
      600,
      600,
      who.style,
      who.strength,
      Date.parse(round.at),
      true,
    ).toDataURL("image/jpeg", 0.9);
    const parts = frames.current.get(round.id) || {};
    parts.local = frame;
    frames.current.set(round.id, parts);
    await peer.current?.send("frame", {
      room: id,
      round: round.id,
      shot: round.shot,
      attempt: round.attempt,
      seat: who.seat,
      frame,
    });
    await combine(round);
  }
  useEffect(() => {
    let active = true;
    let connectionChange = 0;
    source.current = document.createElement("video");
    source.current.muted = true;
    source.current.playsInline = true;
    const connection = new BoothPeer(id, host, {
      stream: (media) => {
        if (active) setRemote(media);
      },
      state: (on) => {
        if (!active) return;
        const change = ++connectionChange;
        if (on) {
          run(
            act(initial.room.adult ? "stop" : "snapshot").then(() => {
              if (active && change === connectionChange) {
                onlineRef.current = true;
                setOnline(true);
              }
            }),
          );
          peer.current?.small("camera", { on: !!stream.current.value });
        } else {
          onlineRef.current = false;
          setOnline(false);
          setRemoteCamera(false);
          busRef.current("disconnect", {});
          if (initial.room.adult) clearMedia();
          run(act("stop"));
        }
      },
      error: setMessage,
      message: async (type, b) => {
        if (!active) return;
        if (type === "select-shot") {
          const current = snap.current,
            target = Number(b.index);
          const layout = (current.room.editor.layout ||
            current.room.layout) as keyof typeof cardLayouts;
          if (
            b.revision === current.room.revision &&
            current.round?.status !== "pending" &&
            Number.isInteger(target) &&
            target >= 0 &&
            target < cardLayouts[layout].shots
          ) {
            setIndex(target);
            const member = current.members.find((m) => m.uid === current.me);
            if (member?.ready && member.intended_shot !== target)
              await act("ready", { value: false, shot: target });
          }
          return;
        }
        if (type === "refresh") {
          await act("snapshot");
          return;
        }
        if (type === "camera") {
          setRemoteCamera(!!b.on);
          return;
        }
        if (type === "stop") {
          setRemoteCamera(false);
          if (initial.room.adult) {
            clearMedia();
            connection.cancelTransfers();
            busRef.current("disconnect", {});
            run(act("stop"));
          }
          return;
        }
        if (type === "frame") {
          let round = snap.current.round;
          if (round?.id !== b.round) round = (await act("snapshot")).round;
          if (
            b.room !== id ||
            !round ||
            round.id !== b.round ||
            round.status !== "pending" ||
            round.shot !== b.shot ||
            round.attempt !== b.attempt ||
            b.seat === (host ? "host" : "guest") ||
            typeof b.frame !== "string" ||
            !b.frame.startsWith("data:image/jpeg;base64,")
          )
            return;
          const parts = frames.current.get(round.id) || {};
          parts.remote = b.frame;
          frames.current.set(round.id, parts);
          void combine(round).catch((e) => setMessage(e.message));
          return;
        }
        busRef.current(type, b);
      },
    });
    peer.current = connection;
    void connection.start().catch((e) => setMessage(e.message));
    const poll = setInterval(() => {
      act(stopPending.current ? "stop" : "snapshot")
        .then((next) => {
          const round = next.round;
          if (
            active &&
            round?.status === "pending" &&
            frames.current.get(round.id)?.combined &&
            !round.acks.includes(initial.me)
          ) {
            return act("ack", { id: round.id });
          }
        })
        .catch((e) => {
          if (active) {
            setMessage(e.message);
            if (
              e.message.includes("unavailable") ||
              e.message.includes("expired")
            ) {
              clearMedia();
              connection.close();
              clearInterval(poll);
            }
          }
        });
    }, 1200);
    const tick = setInterval(() => {
      const round = snap.current.round;
      if (round?.status === "pending") {
        const left = Date.parse(round.at) - Date.now() - offset.current;
        setRemaining(Math.max(0, Math.ceil(left / 1000)));
        if (left <= 0 && fired.current !== round.id) {
          fired.current = round.id;
          run(capture(round));
        }
      }
    }, 60);
    const exit = () => {
      clearMedia();
      connection.close();
      void fetch("/api/action", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "room", id, op: "stop" }),
      }).catch(() => {});
    };
    const visibility = () => {
      if (
        document.hidden &&
        (initial.room.adult || snap.current.round?.status === "pending")
      )
        stop();
    };
    window.addEventListener("pagehide", exit);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      clearInterval(poll);
      clearInterval(tick);
      window.removeEventListener("pagehide", exit);
      document.removeEventListener("visibilitychange", visibility);
      exit();
      releaseEffects();
    };
    // The connection owns the room lifecycle. State read by its callbacks lives in refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    if (s.round?.status !== "done") return;
    const q = s.round,
      parts = frames.current.get(q.id);
    if (parts?.combined) {
      const img = parts.combined;
      setPairs((prev) => {
        const copy = prev.slice();
        copy[q.shot] = img;
        return copy;
      });
      setIndex(Math.min(q.shot + 1, total - 1));
      frames.current.delete(q.id);
    }
  }, [s.round, total]);
  useEffect(() => {
    if (overlay.current)
      void drawEffect(
        overlay.current,
        effect,
        s.round ? Date.parse(s.round.at) : 1,
      );
  }, [effect, s.round]);
  async function edit(patch: Record<string, unknown>) {
    await act("edit", { revision: snap.current.room.revision, patch });
  }
  const changeFilter = (style: number, strength: number, match: boolean) =>
    run(act("filter", { style, strength, match }));
  return (
    <main className="container">
      <div className="boothHead">
        <div>
          <h1>{s.room.title}</h1>
          <p aria-live="polite">
            {other
              ? online
                ? "Partner joined · Connected"
                : "Partner joined · Partner reconnecting"
              : "Waiting for your partner"}
          </p>
        </div>
        <div className="actions">
          {host && !other && (
            <button onClick={() => setSharing(true)}>Invite partner</button>
          )}
          <Link href="/dashboard" onClick={stop}>
            Leave
          </Link>
        </div>
      </div>
      <div className="booth">
        <section className="studio">
          <div className="tiles">
            {(["host", "guest"] as const).map((seat) => {
              const own = me.seat === seat;
              return (
                <Tile
                  seed={s.round ? Date.parse(s.round.at) : 1}
                  key={seat}
                  member={s.members.find((m) => m.seat === seat)}
                  local={own}
                  stream={own ? local : remoteCamera ? remote : null}
                />
              );
            })}
            <canvas
              className="effectLayer"
              width={640}
              height={320}
              ref={overlay}
            />
            {guide && <div className="guide">♡</div>}
            {pending && <b className="timer">{remaining || "♡"}</b>}
          </div>
          <div className="actions">
            {s.room.adult && !me.live && (
              <button
                disabled={!online || stopPending.current}
                onClick={() => run(act("live"))}
              >
                Agree to live sharing
              </button>
            )}
            {local ? (
              <>
                <button className="primary" onClick={stop}>
                  Stop sharing
                </button>
                <button onClick={() => run(camera(true))}>Switch camera</button>
                <button onClick={() => run(voice())}>
                  {mic ? "Mute voice" : "Enable voice"}
                </button>
              </>
            ) : (
              <button disabled={!bothLive} onClick={() => run(camera())}>
                <Camera size={18} />
                Turn on camera
              </button>
            )}
          </div>
          <div className="paper">
            <div className="actions">
              <button
                disabled={!local || !online || pending || !bothLive}
                onClick={() =>
                  run(act("ready", { value: !me.ready, shot: index }))
                }
              >
                {me.ready ? "Withdraw readiness" : "Ready"}
              </button>
              <select
                aria-label="Countdown"
                style={{ width: "auto" }}
                value={seconds}
                onChange={(e) => setSeconds(+e.target.value)}
              >
                {[3, 5, 10].map((n) => (
                  <option key={n} value={n}>
                    {n} seconds
                  </option>
                ))}
              </select>
              {pending ? (
                <button onClick={() => run(act("cancel"))}>
                  Cancel countdown
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={
                    !online ||
                    !local ||
                    s.members.length !== 2 ||
                    !s.members.every(
                      (m) => m.ready && m.intended_shot === index,
                    )
                  }
                  onClick={() => run(act("schedule", { shot: index, seconds }))}
                >
                  Take photo {index + 1}
                </button>
              )}
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={guide}
                onChange={(e) => setGuide(e.target.checked)}
              />
              Half-heart guide
            </label>
            {guide && <p>Look toward the middle.</p>}
          </div>
          <h2>Photo filters</h2>
          <div className="tray">
            {filters.map((f, i) => (
              <button
                key={f.id}
                aria-pressed={me.style === i}
                disabled={pending}
                onClick={() => changeFilter(i, me.strength, s.room.matched)}
              >
                <Thumbnail index={i} />
                {f.label}
              </button>
            ))}
          </div>
          <label>
            Strength · {me.strength}%
            <input
              key={me.strength}
              type="range"
              min={0}
              max={100}
              defaultValue={me.strength}
              onPointerUp={(e) =>
                changeFilter(me.style, +e.currentTarget.value, s.room.matched)
              }
              onKeyUp={(e) =>
                changeFilter(me.style, +e.currentTarget.value, s.room.matched)
              }
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={s.room.matched}
              onChange={(e) =>
                changeFilter(me.style, me.strength, e.target.checked)
              }
            />
            Match filters
          </label>
          <details>
            <summary>Heart and starlight effects</summary>
            <label>
              Effect
              <select
                value={effect.name}
                onChange={(e) =>
                  run(edit({ effect: { ...effect, name: e.target.value } }))
                }
              >
                {["Off", "Shared Heart", "Floating Hearts", "Starlight"].map(
                  (x) => (
                    <option key={x}>{x}</option>
                  ),
                )}
              </select>
            </label>
            {effect.name !== "Off" && (
              <>
                {(["x", "y", "size"] as const).map((k, i) => (
                  <label key={k}>
                    {["Horizontal position", "Vertical position", "Size"][i]}
                    <input
                      type="range"
                      min=".05"
                      max=".95"
                      step=".01"
                      key={effect[k]}
                      defaultValue={effect[k]}
                      onChange={(e) => {
                        const v = +e.target.value;
                        if (overlay.current)
                          void drawEffect(
                            overlay.current,
                            { ...effect, [k]: v },
                            1,
                          );
                      }}
                      onPointerUp={(e) =>
                        run(
                          edit({
                            effect: { ...effect, [k]: +e.currentTarget.value },
                          }),
                        )
                      }
                      onKeyUp={(e) =>
                        run(
                          edit({
                            effect: { ...effect, [k]: +e.currentTarget.value },
                          }),
                        )
                      }
                    />
                  </label>
                ))}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={effect.include}
                    onChange={(e) =>
                      run(
                        edit({
                          effect: { ...effect, include: e.target.checked },
                        }),
                      )
                    }
                  />
                  Include in photo
                </label>
              </>
            )}
          </details>
          {other && (
            <details>
              <summary>Block or report</summary>
              <button
                onClick={() => {
                  if (confirm("Block this account and end the room?"))
                    run(act("block").then(() => router.push("/dashboard")));
                }}
              >
                Block partner
              </button>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const reason = new FormData(e.currentTarget).get("reason");
                  run(
                    act("report", { reason }).then(() =>
                      setMessage("Report submitted."),
                    ),
                  );
                }}
              >
                <label>
                  Reason and optional details
                  <textarea required name="reason" maxLength={1000} />
                </label>
                <button>Submit report</button>
              </form>
            </details>
          )}
        </section>
        <EditorPanel
          {...{
            s,
            pairs,
            total,
            index,
            select: (target: number) => {
              if (pending) return;
              setIndex(target);
              if (me.ready && me.intended_shot !== target)
                run(act("ready", { value: false, shot: target }));
              peer.current?.small("select-shot", {
                index: target,
                revision: s.room.revision,
              });
            },
            peer,
            busRef,
            online: online && !stopPending.current,
            edit,
            act,
            message: setMessage,
          }}
        />
      </div>
      <p role="status">{msg}</p>
      {sharing && host && !other && (
        <Share
          id={id}
          expires={s.room.expires}
          onClose={() => setSharing(false)}
        />
      )}
    </main>
  );
}
