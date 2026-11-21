"use client";
import { useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { MailOpen } from "lucide-react";
import { api } from "@/lib/shared";
export default function Invite({ signed }: { signed: boolean }) {
  const router = useRouter();
  const once = useRef(false),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [detail, setDetail] = useState<{ title: string; adult: boolean } | null>(null);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    (async () => {
      if (location.hash) {
        await api("continue", { token: location.hash.slice(1) });
        history.replaceState(null, "", "/invite");
      }
      if (signed) setDetail(await api("preview"));
      setReady(true);
    })().catch((e) => setError(e.message));
  }, [signed]);
  return (
    <main className="center">
      <section className="paper formcard">
        <MailOpen size={40} className="red" />
        <h1>A photo date for two</h1>
        <p>{detail?.title || "You’re invited to a private photo booth."}</p>
        {detail?.adult && (
          <p>
            Adult private session. Join only if you choose to participate. Your
            partner can still take screenshots or record their screen.
          </p>
        )}
        {ready &&
          (signed ? (
            <>
              <button
                disabled={busy}
                className="primary"
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await api("join");
                    router.push("/room/" + r.id);
                  } catch (e) {
                    setError((e as Error).message);
                    setBusy(false);
                  }
                }}
              >
                Join this room
              </button>
              <Link href="/dashboard">Decline and leave</Link>
            </>
          ) : (
            <>
              <Link className="button primary" href="/login?next=/invite">
                Log in to join
              </Link>
              <Link href="/signup?next=/invite">Create an account</Link>
            </>
          ))}
        <p role="status">{error || (!ready ? "Opening invitation…" : "")}</p>
        {error && <Link href="/">Back to Klikilig</Link>}
      </section>
    </main>
  );
}
