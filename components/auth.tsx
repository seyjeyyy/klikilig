"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Eye, EyeOff, Mail } from "lucide-react";
import { api } from "@/lib/shared";
const titles: Record<string, string> = {
  login: "Welcome back",
  signup: "Create your account",
  "forgot-password": "Reset your password",
  "reset-password": "Choose a new password",
};
export default function Auth({
  mode,
  next,
  message,
}: {
  mode: string;
  next: string;
  message: string;
}) {
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [pass, setPass] = useState(""),
    [confirm, setConfirm] = useState(""),
    [visible, setVisible] = useState(false),
    [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false),
    [status, setStatus] = useState(message),
    [cool, setCooldown] = useState(0);
  useEffect(() => {
    if (cool) {
      const id = setTimeout(() => setCooldown(cool - 1), 1000);
      return () => clearTimeout(id);
    }
  }, [cool]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setStatus("");
    try {
      if ((mode === "signup" || mode === "reset-password") && pass !== confirm)
        throw Error("Your passwords must match.");
      const res = await api(mode, { email, password: pass, next, name });
      if (res.confirm || mode === "forgot-password") {
        setSent(true);
        setCooldown(60);
      } else location.assign(res.next || next);
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const link = (m: string) => "/" + m + "?next=" + encodeURIComponent(next);
  return (
    <main className="center">
      <section className="paper formcard">
        <Mail className="red" />
        <h1>{sent ? "Check your email" : titles[mode]}</h1>
        {sent ? (
          <>
            <p>
              {mode === "signup"
                ? "Open the confirmation link to finish creating your account."
                : "If your address has an account, a recovery link is on its way."}
            </p>
            {mode === "signup" && (
              <button
                disabled={cool > 0 || busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api("resend", { email, next });
                    setStatus("Confirmation requested.");
                    setCooldown(60);
                  } catch (e) {
                    setStatus((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Resend confirmation {cool > 0 && "(" + cool + "s)"}
              </button>
            )}
            <Link href={link("login")}>Return to login</Link>
          </>
        ) : (
          <form onSubmit={submit}>
            {mode === "signup" && (
              <label>
                Display name
                <input
                  required
                  maxLength={80}
                  autoComplete="nickname"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            )}
            {mode !== "reset-password" && (
              <label>
                Email address
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
            )}
            {mode !== "forgot-password" && (
              <>
                <label>
                  Password
                  <span className="inputGroup">
                    <input
                      required
                      type={visible ? "text" : "password"}
                      minLength={mode === "login" ? 1 : 8}
                      autoComplete={
                        mode === "login" ? "current-password" : "new-password"
                      }
                      value={pass}
                      onChange={(e) => setPass(e.target.value)}
                    />
                    <button
                      type="button"
                      aria-label={visible ? "Hide password" : "Show password"}
                      onClick={() => setVisible(!visible)}
                    >
                      {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </span>
                </label>
                {mode !== "login" && (
                  <label>
                    Confirm password
                    <input
                      required
                      type={visible ? "text" : "password"}
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                    />
                  </label>
                )}
              </>
            )}
            {mode === "login" && (
              <Link href={link("forgot-password")}>Forgot password?</Link>
            )}
            <button disabled={busy} className="primary">
              {busy
                ? "Please wait…"
                : {
                    login: "Log in",
                    signup: "Sign up",
                    "forgot-password": "Send recovery email",
                    "reset-password": "Save new password",
                  }[mode]}
            </button>
            <Link href={link(mode === "login" ? "signup" : "login")}>
              {mode === "login"
                ? "Create an account"
                : "Already have an account? Log in"}
            </Link>
          </form>
        )}
        <p role="status">{status}</p>
      </section>
    </main>
  );
}
