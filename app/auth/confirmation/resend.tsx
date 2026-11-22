"use client";
import { useState } from "react";
import { api } from "@/lib/shared";
export default function Resend() {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const email = new FormData(e.currentTarget).get("email");
        setBusy(true);
        try {
          await api("resend", { email });
          setMessage(
            "If your account needs confirmation, check your inbox for a new link.",
          );
          setTimeout(() => setBusy(false), 60000);
        } catch (err) {
          setMessage((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <label>
        Email address
        <input required type="email" name="email" autoComplete="email" />
      </label>
      <button disabled={busy}>Resend confirmation</button>
      <p role="status">{message}</p>
    </form>
  );
}
