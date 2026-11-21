"use client";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { api } from "@/lib/shared";
import { listStrips, download } from "@/lib/store";
export function Preferences({
  name,
  reduced,
}: {
  name: string;
  reduced: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(name),
    [motion, setMotion] = useState(reduced),
    [status, setStatus] = useState("");
  return (
    <section className="paper formcard">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("settings", { name: value, reducedMotion: motion });
            document.documentElement.classList.toggle("reduced-motion", motion);
            setStatus("Preferences saved.");
          } catch (err) {
            setStatus((err as Error).message);
          }
        }}
      >
        <label>
          Display name
          <input
            required
            value={value}
            maxLength={80}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={motion}
            onChange={(e) => setMotion(e.target.checked)}
          />
          Reduce motion
        </label>
        <button className="primary">Save preferences</button>
      </form>
      <button
        onClick={async () => {
          try {
            await api("logout");
            router.push("/");
          } catch (err) {
            setStatus((err as Error).message);
          }
        }}
      >
        Log out
      </button>
      <p role="status">{status}</p>
    </section>
  );
}
export function Strips({ owner }: { owner: string }) {
  const [items, setItems] = useState<
      { id: string; title: string; url: string; image: Blob }[]
    >([]),
    [status, setStatus] = useState("Loading keepsakes…");
  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    listStrips(owner)
      .then((data) => {
        if (!alive) return;
        setItems(
          data.map((d) => {
            const url = URL.createObjectURL(d.image);
            urls.push(url);
            return { ...d, url };
          }),
        );
        setStatus(data.length ? "" : "Your saved keepsakes will appear here.");
      })
      .catch(() => setStatus("Device storage is unavailable."));
    return () => {
      alive = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [owner]);
  return (
    <>
      <p>{status}</p>
      <div className="gallery">
        {items.map((item) => (
          <article key={item.id} className="paper">
            <img alt={item.title} src={item.url} />
            <h3>{item.title}</h3>
            <button onClick={() => download(item.image, "klikilig-strip.png")}>
              Download PNG
            </button>
          </article>
        ))}
      </div>
    </>
  );
}
