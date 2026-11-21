"use client";
import { useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Camera, Images } from "lucide-react";
import { api, layouts } from "@/lib/shared";
export default function Dashboard({
  rooms,
  eligible,
  create,
  name,
}: {
  rooms: {
    id: string;
    title: string;
    seat: string;
    claimed: boolean;
    expires: string;
  }[];
  eligible: boolean;
  create: boolean;
  name: string;
}) {
  const router = useRouter();
  const modal = useRef<HTMLDialogElement>(null),
    req = useRef(""),
    token = useRef("");
  const [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [title, setTitle] = useState(""),
    [layout, setLayout] = useState<string>(layouts[0]),
    [adult, setAdult] = useState(false);
  function open() {
    req.current = crypto.randomUUID();
    token.current = btoa(
      String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
    )
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    modal.current?.showModal();
  }
  useEffect(() => {
    if (create) open();
  }, [create]);
  return (
    <main className="container">
      <p className="eyebrow">YOUR PHOTO BOOTH</p>
      <h1>Hello, {name}.</h1>
      <button className="primary" onClick={open}>
        <Camera />
        Create a room
      </button>
      <h2>Active rooms</h2>
      {rooms.length === 0 && <p>Your photo dates will appear here.</p>}
      {rooms.map((r) => (
        <article className="paper roomrow" key={r.id}>
          <h3>{r.title}</h3>
          <p>
            {r.claimed ? "Partner joined" : "Waiting for your partner"} ·
            Expires {new Date(r.expires).toLocaleString()}
          </p>
          <div className="actions">
            <Link className="button secondary" href={"/room/" + r.id}>
              Resume
            </Link>
            {r.seat === "host" && (
              <>
                {!r.claimed && (
                  <Link href={"/room/" + r.id + "?invite=1"}>
                    Invite partner
                  </Link>
                )}
                <button
                  onClick={async () => {
                    if (confirm("End this room for both people?"))
                      try {
                        await api("room", { id: r.id, op: "end" });
                        location.reload();
                      } catch (e) {
                        setStatus((e as Error).message);
                      }
                  }}
                >
                  End room
                </button>
              </>
            )}
          </div>
        </article>
      ))}
      <Link className="paper shelf" href="/strips">
        <Images />
        My Strips
      </Link>
      <p role="status">{status}</p>
      <dialog ref={modal}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            try {
              const { id } = await api("create", {
                req: req.current,
                token: token.current,
                title,
                layout,
                adult,
              });
              router.push("/room/" + id + "?invite=1");
            } catch (e) {
              setStatus((e as Error).message);
              setBusy(false);
            }
          }}
        >
          <h2>Create a room</h2>
          <label>
            Room title
            <input
              placeholder="Our photo date"
              value={title}
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Starting layout
            <select value={layout} onChange={(e) => setLayout(e.target.value)}>
              {layouts.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Session type
            <select
              value={adult ? "adult" : "standard"}
              onChange={(e) => setAdult(e.target.value === "adult")}
            >
              <option value="standard">Standard</option>
              {eligible && <option value="adult">Adult private</option>}
            </select>
          </label>
          {adult && (
            <p>
              Your partner can still take screenshots or record their screen.
            </p>
          )}
          <button disabled={busy} className="primary">
            {busy ? "Creating room…" : "Create room"}
          </button>
          <button type="button" onClick={() => modal.current?.close()}>
            Cancel
          </button>
          <p role="status">{status}</p>
        </form>
      </dialog>
    </main>
  );
}
