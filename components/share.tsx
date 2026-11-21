"use client";
import { useRef, useEffect, useState } from "react";
import QRCode from "qrcode";
import { api } from "@/lib/shared";
const message = "Tara, Klikilig tayo? I made us a private photo booth.";
export default function Share({
  id,
  expires,
  onClose,
}: {
  id: string;
  expires: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    [url, setUrl] = useState(""),
    [qr, setQrImage] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    ref.current?.showModal();
    api("link", { id })
      .then((r) => setUrl(r.link || ""))
      .catch((e) => setStatus(e.message));
  }, [id]);
  useEffect(() => {
    if (url)
      QRCode.toDataURL(url, {
        width: 200,
        margin: 4,
        errorCorrectionLevel: "M",
      })
        .then(setQrImage)
        .catch(() => setStatus("Use the link below."));
  }, [url]);
  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(label);
    } catch {
      setStatus("Select and copy this link.");
      ref.current?.querySelector("input")?.select();
    }
  }
  return (
    <dialog ref={ref} onClose={onClose}>
      <h2>Invite your person</h2>
      <p>{message}</p>
      {url && (
        <>
          <label>
            Private invitation
            <input readOnly value={url} onFocus={(e) => e.target.select()} />
          </label>
          <div className="actions">
            <button
              className="primary"
              onClick={async () => {
                if (!navigator.share)
                  return copy(
                    message + " Join me here: " + url,
                    "Invitation copied",
                  );
                try {
                  await navigator.share({
                    title: "Klikilig",
                    text: message,
                    url,
                  });
                } catch (e) {
                  if ((e as Error).name !== "AbortError")
                    setStatus("Use Copy link to share your invitation.");
                }
              }}
            >
              Share invitation
            </button>
            <button onClick={() => copy(url, "Link copied")}>Copy link</button>
            <button
              onClick={() =>
                copy(
                  message + " Join me here: " + url,
                  "Message and link copied",
                )
              }
            >
              Copy message + link
            </button>
          </div>
          {qr && (
            <img className="qr" src={qr} alt="Scan to open this invitation" />
          )}
        </>
      )}
      <p>Expires {new Date(expires).toLocaleString()}</p>
      <button
        disabled={busy}
        onClick={async () => {
          if (
            !confirm("Replace this invitation? The old link will stop working.")
          )
            return;
          setBusy(true);
          try {
            setUrl((await api("rotate", { id })).link);
            setStatus("New invitation ready.");
          } catch (e) {
            setStatus((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Replace link
      </button>{" "}
      <button onClick={onClose}>Close</button>
      <p role="status">{status}</p>
    </dialog>
  );
}
