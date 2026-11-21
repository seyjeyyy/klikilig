"use client";
import { useEffect, useState, useRef } from "react";
import {
  cardFrames,
  cardLayouts,
  renderCard,
  renderDownload,
  CardSettings,
  CardPoint,
} from "@/lib/postcard";
import { Snapshot } from "@/lib/room-types";
import { BoothPeer } from "@/lib/peer";
import { flip } from "@/lib/effects";
import { download, saveStrip } from "@/lib/store";
type Body = Record<string, unknown>;
type Props = {
  s: Snapshot;
  pairs: string[];
  total: number;
  index: number;
  select: (n: number) => void;
  peer: React.RefObject<BoothPeer | null>;
  busRef: React.RefObject<(t: string, b: Body) => void>;
  online: boolean;
  edit: (p: Body) => Promise<void>;
  act: (op: string, p?: Body) => Promise<Snapshot>;
  message: (s: string) => void;
};
const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function dataURL(blob: Blob) {
  return new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => fail(Error("Could not read PNG."));
    r.readAsDataURL(blob);
  });
}
export default function EditorPanel({
  s,
  pairs,
  total,
  index,
  select,
  peer,
  busRef,
  online,
  edit,
  act,
  message,
}: Props) {
  const e = s.room.editor,
    rev = s.room.revision,
    host = s.room.host === s.me,
    adult = s.room.adult;
  const [note, setNote] = useState(""),
    [sealed, setSealed] = useState("Writing"),
    [theirSeal, setTheirSeal] = useState("Writing"),
    [back, setShowingBack] = useState(false),
    [revealed, setRevealed] = useState(false),
    [agreed, setAgreed] = useState(false),
    [readyFiles, setReadyFiles] = useState<Record<string, Blob>>({}),
    [drawing, setDrawing] = useState(false),
    [open, setOpen] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null),
    stroke = useRef<CardPoint[]>([]),
    state = useRef({
      mine: false,
      theirs: false,
      sent: false,
      received: false,
      acked: false,
      otherText: "",
    }),
    latest = useRef(rev),
    cache = useRef<Record<string, Blob>>({}),
    working = useRef(new Set<string>()),
    noteRef = useRef("");
  const names: [string, string] = e.names || [
    s.members.find((m) => m.seat === "host")?.name || "Host",
    s.members.find((m) => m.seat === "guest")?.name || "Guest",
  ];
  const settings: CardSettings = {
    ...e,
    names,
    layout: e.layout || s.room.layout,
  };
  const count = pairs.slice(0, total).filter(Boolean).length,
    complete = count === total && s.round?.status !== "pending";
  const run = (job: Promise<unknown>) =>
    job.catch((err) => message(err.message));
  function reset() {
    state.current = {
      mine: false,
      theirs: false,
      sent: false,
      received: false,
      acked: false,
      otherText: "",
    };
    setAgreed(false);
    setRevealed(false);
    setShowingBack(false);
    setSealed("Writing");
    setTheirSeal("Writing");

    working.current.clear();
    cache.current = {};
    setReadyFiles({});
  }
  useEffect(() => {
    latest.current = rev;
    reset();
  }, [rev]);
  useEffect(() => {
    let alive = true;
    const valid = Array.from({ length: total }, (_, i) => pairs[i] || "");
    const notes: [string, string] = host
      ? [noteRef.current, state.current.otherText]
      : [state.current.otherText, noteRef.current];
    renderCard(valid, settings, back && revealed ? notes : undefined)
      .then((card) => {
        if (!alive || !canvas.current) return;

        const target = canvas.current;
        target.width = 360;
        target.height = Math.round((360 * card.height) / card.width);
        target
          .getContext("2d")
          ?.drawImage(card, 0, 0, target.width, target.height);
      })
      .catch((err) => message(err.message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev, pairs, back, revealed, total, open, s.members.length]);
  function seal(value: string) {
    setSealed(value);

    if (value === "Skipped") noteRef.current = "";
    else noteRef.current = note;
    peer.current?.small("seal", { rev, value });
  }
  function showBack() {
    if (
      !state.current.received ||
      !state.current.acked ||
      !state.current.mine ||
      !state.current.theirs
    )
      return;
    setRevealed(true);
    if (canvas.current) void flip(canvas.current, () => setShowingBack(true));
    else setShowingBack(true);
  }
  function exchange() {
    const st = state.current;
    if (!st.mine || !st.theirs || st.sent) return;
    st.sent = true;
    const version = rev;
    run(
      (async () => {
        await peer.current!.send("note", { rev, text: noteRef.current });
        if (latest.current !== version || state.current !== st) return;
        st.acked = true;
        showBack();
      })(),
    );
  }
  function agree() {
    state.current.mine = true;
    setAgreed(true);
    peer.current?.small("reveal", { rev });
    exchange();
  }
  async function produce(kind: string) {
    if (
      !host ||
      working.current.has(kind) ||
      cache.current[kind] ||
      !complete ||
      (kind === "postcard" && !revealed)
    )
      return;
    working.current.add(kind);
    try {
      const current = await act("snapshot");
      if (
        current.room.revision !== rev ||
        !current.members.every((m) => m.approved === rev) ||
        current.members.length !== 2
      )
        throw Error("Both partners must approve this revision.");
      const front = await renderCard(pairs, settings);
      const reverse =
        kind === "postcard"
          ? await renderCard(pairs, settings, [
              noteRef.current,
              state.current.otherText,
            ])
          : undefined;
      const blob = await renderDownload(front, reverse);
      await peer.current!.send("png", { kind, rev, url: await dataURL(blob) });
      if (latest.current !== rev) return;
      cache.current[kind] = blob;
      setReadyFiles({ ...cache.current });
      peer.current?.small("copies", { kind, rev });
      message("Both copies are ready.");
    } finally {
      working.current.delete(kind);
    }
  }
  useEffect(() => {
    busRef.current = (type, b) => {
      if (type === "disconnect") {
        reset();
        return;
      }
      if (b.rev !== rev) {
        if (type === "note" || type === "png")
          throw Error("The postcard revision changed.");
        return;
      }
      if (type === "seal") {
        setTheirSeal(String(b.value));
        return;
      }
      if (type === "reveal") {
        state.current.theirs = true;
        exchange();
        return;
      }
      if (
        type === "note" &&
        state.current.mine &&
        state.current.theirs &&
        typeof b.text === "string"
      ) {
        state.current.otherText = Array.from(segments.segment(b.text))
          .slice(0, 160)
          .map((g) => g.segment)
          .join("");
        state.current.received = true;
        showBack();
        return;
      }
      if (type === "generate") run(produce(String(b.kind)));
      if (type === "note") throw Error("Mutual reveal is required.");
      if (
        type === "png" &&
        !host &&
        typeof b.url === "string" &&
        b.url.startsWith("data:image/png;base64,") &&
        s.members.every((m) => m.approved === rev)
      ) {
        const raw = atob(b.url.split(",")[1]);
        cache.current[String(b.kind)] = new Blob(
          [Uint8Array.from(raw, (c) => c.charCodeAt(0))],
          { type: "image/png" },
        );
        return;
      }
      if (type === "png")
        throw Error("Both people must approve the current revision.");
      if (type === "copies" && !host && cache.current[String(b.kind)]) {
        setReadyFiles({ ...cache.current });
        message("Both copies are ready.");
      }
    };
  });
  const approved =
    s.members.length === 2 &&
    s.members.every((m) => m.approved === rev) &&
    (!adult || (online && s.members.every((m) => m.live)));
  const mine = s.members.find((m) => m.uid === s.me)!;
  function field(key: "names" | "places", i: number, v: string) {
    const values = [...(settings[key] || ["", ""])];
    values[i] = v;
    run(edit({ [key]: values }));
  }
  function point(ev: React.PointerEvent<HTMLCanvasElement>) {
    const box = ev.currentTarget.getBoundingClientRect();
    return {
      x: (ev.clientX - box.left) / box.width,
      y: (ev.clientY - box.top) / box.height,
    };
  }
  return (
    <aside className="editor paper">
      <h2>Your keepsake</h2>
      <button aria-expanded={open} onClick={() => setOpen(!open)}>
        {count} of {total} photos · {open ? "Hide editor" : "Open editor"}
      </button>
      {open && (
        <>
          <canvas
            className={drawing ? "draftCanvas" : ""}
            aria-label={back ? "Postcard reverse" : "Photo strip preview"}
            ref={canvas}
            onPointerDown={(ev) => {
              if (drawing) {
                ev.currentTarget.setPointerCapture(ev.pointerId);
                stroke.current = [point(ev)];
              }
            }}
            onPointerMove={(ev) => {
              if (drawing && ev.buttons && stroke.current.length < 200)
                stroke.current.push(point(ev));
            }}
            onPointerUp={() => {
              if (drawing && stroke.current.length) {
                run(
                  edit({
                    doodles: [
                      ...(e.doodles || []),
                      {
                        points: stroke.current,
                        color: "#ad203b",
                        width: 0.004,
                      },
                    ],
                  }),
                );
                stroke.current = [];
              }
            }}
          />
          <div className="actions">
            {Array.from({ length: total }, (_, i) => (
              <button
                key={i}
                aria-pressed={index === i}
                onClick={() => select(i)}
              >
                {pairs[i] ? "Retake" : "Shot"} {i + 1}
              </button>
            ))}
          </div>
          <details>
            <summary>Customize the front</summary>
            <label>
              Layout
              <select
                value={settings.layout}
                onChange={(ev) => {
                  select(0);
                  run(edit({ layout: ev.target.value }));
                }}
              >
                {Object.keys(cardLayouts).map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
            <label>
              Frame
              <select
                value={e.frame || "Cream"}
                onChange={(ev) => run(edit({ frame: ev.target.value }))}
              >
                {cardFrames.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            {(["names", "places"] as const).map((k) =>
              [0, 1].map((i) => (
                <label key={k + i}>
                  {i ? "Guest" : "Host"} {k === "names" ? "name" : "place"}
                  <input
                    key={settings[k]?.[i]}
                    maxLength={48}
                    defaultValue={settings[k]?.[i] || ""}
                    onBlur={(ev) => {
                      if (ev.target.value !== (settings[k]?.[i] || ""))
                        field(k, i, ev.target.value);
                    }}
                  />
                </label>
              )),
            )}
            {(["caption", "date"] as const).map((k) => (
              <label key={k}>
                {k === "caption" ? "Caption" : "Date"}
                <input
                  type={k === "date" ? "date" : "text"}
                  maxLength={180}
                  key={e[k]}
                  defaultValue={e[k] || ""}
                  onBlur={(ev) => {
                    if (ev.target.value !== (e[k] || ""))
                      run(edit({ [k]: ev.target.value }));
                  }}
                />
              </label>
            ))}
            <div className="actions">
              <button
                onClick={() =>
                  run(
                    edit({
                      stickers: [
                        ...(e.stickers || []),
                        {
                          x: 0.86,
                          y: 0.93 - (e.stickers?.length || 0) * 0.035,
                          text: "♥",
                          size: 0.05,
                        },
                      ],
                    }),
                  )
                }
              >
                Add heart sticker
              </button>
              <button onClick={() => setDrawing(!drawing)}>
                {drawing ? "Finish doodling" : "Draw on strip"}
              </button>
              <button
                disabled={!e.doodles?.length}
                onClick={() => run(edit({ doodles: e.doodles?.slice(0, -1) }))}
              >
                Undo doodle
              </button>
            </div>
          </details>
          {!complete && !adult && !online && count > 0 && (
            <button
              onClick={() =>
                run(
                  renderCard(pairs, settings)
                    .then((c) => renderDownload(c))
                    .then((b) => download(b, "klikilig-strip.png")),
                )
              }
            >
              Download available front
            </button>
          )}
          {complete && (
            <>
              <h3>Secret notes</h3>
              <label>
                If you were here right now, I’d…
                <textarea
                  disabled={sealed !== "Writing"}
                  value={note}
                  onChange={(ev) =>
                    setNote(
                      Array.from(segments.segment(ev.target.value))
                        .slice(0, 160)
                        .map((g) => g.segment)
                        .join(""),
                    )
                  }
                />
              </label>
              <p>
                {Array.from(segments.segment(note)).length}/160 · Partner:{" "}
                {theirSeal}
              </p>
              {sealed === "Writing" ? (
                <div className="actions">
                  <button disabled={!online} onClick={() => seal("Sealed")}>
                    Seal note
                  </button>
                  <button disabled={!online} onClick={() => seal("Skipped")}>
                    Skip
                  </button>
                </div>
              ) : (
                <p>Your note: {sealed}</p>
              )}
              {revealed ? (
                <button
                  onClick={() =>
                    canvas.current && void flip(canvas.current, () => setShowingBack(!back))
                  }
                >
                  {back ? "View front" : "View back"}
                </button>
              ) : (
                <button
                  disabled={
                    !online ||
                    agreed ||
                    sealed === "Writing" ||
                    theirSeal === "Writing"
                  }
                  onClick={agree}
                >
                  {agreed ? "Waiting for mutual reveal" : "Turn it over"}
                </button>
              )}
              <h3>Keep this photo date</h3>
              {adult && (
                <p>A downloaded file is then under the recipient’s control.</p>
              )}
              <button
                disabled={!online || mine.approved === rev}
                onClick={() => run(act("approve", { revision: rev }))}
              >
                {mine.approved === rev
                  ? "Revision approved"
                  : "Approve this revision"}
              </button>
              {["strip", ...(revealed ? ["postcard"] : [])].map((kind) => (
                <button
                  key={kind}
                  disabled={!approved}
                  onClick={() => {
                    const file = readyFiles[kind];
                    if (file) {
                      run(
                        act("snapshot").then((current) => {
                          if (
                            current.room.revision !== rev ||
                            !current.members.every(
                              (m) => m.approved === rev && (!adult || m.live),
                            )
                          )
                            throw Error(
                              "Both people must approve the current revision.",
                            );
                          download(file, "klikilig-" + kind + ".png");
                        }),
                      );
                      return;
                    }
                    if (host) run(produce(kind));
                    else peer.current?.small("generate", { kind, rev });
                  }}
                >
                  {readyFiles[kind] ? "Download" : "Prepare"}{" "}
                  {kind === "strip" ? "photo strip" : "postcard"}
                </button>
              ))}
              {!adult && !online && (
                <button
                  onClick={() =>
                    run(
                      renderCard(pairs, settings)
                        .then((c) => renderDownload(c))
                        .then((b) => download(b, "klikilig-strip.png")),
                    )
                  }
                >
                  Download available front
                </button>
              )}
              {!adult && readyFiles.strip && (
                <button
                  onClick={() =>
                    run(
                      saveStrip({
                        id: s.me + "/" + s.room.id + "/" + rev,
                        title: s.room.title,
                        image: readyFiles.strip,
                      }).then(() =>
                        message("Saved to My Strips on this device."),
                      ),
                    )
                  }
                >
                  Save to My Strips
                </button>
              )}
            </>
          )}
        </>
      )}
    </aside>
  );
}
