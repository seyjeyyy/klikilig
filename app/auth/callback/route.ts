import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { db, origin } from "@/lib/server";
export async function GET(req: NextRequest) {
  const base = origin(),
    p = req.nextUrl.searchParams,
    jar = await cookies(),
    client = await db();
  const go = (path: string) =>
    NextResponse.redirect(base + path, {
      headers: {
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  const recovery = p.get("type") === "recovery" || p.get("flow") === "recovery";
  const failed = () =>
    go(recovery ? "/forgot-password?expired=1" : "/auth/confirmation");
  if (p.has("error") || p.has("error_code")) return failed();
  const hash = p.get("token_hash"),
    type = p.get("type"),
    code = p.get("code");
  const verified =
    hash && (type === "signup" || type === "email" || type === "recovery")
      ? await client.auth.verifyOtp({ token_hash: hash, type })
      : code
        ? await client.auth.exchangeCodeForSession(code)
        : null;
  if (!verified || verified.error || !verified.data.user?.email_confirmed_at)
    return failed();
  if (recovery) return go("/reset-password");
  const user = verified.data.user;
  const sameSignup =
    !!user.email &&
    jar.get("klikilig-signup-email")?.value ===
      createHash("sha256")
        .update(user.email.trim().toLowerCase())
        .digest("hex");
  const requested = sameSignup ? jar.get("klikilig-next")?.value : undefined;
  const intent =
    user.user_metadata.signup_intent ??
    (requested === "/invite"
      ? "invite"
      : requested === "/dashboard?create=1"
        ? "create"
        : "dashboard");
  const dest =
    intent === "invite" || intent === "create" ? intent : "dashboard";
  const { data: ticket, error } = await client.rpc("issue_email_receipt", {
    destination: dest,
  });
  if (error || !ticket) return failed();
  if (dest === "invite") {
    const handle = sameSignup
      ? jar.get("klikilig-signup-invite")?.value
      : undefined;
    if (handle)
      jar.set("klikilig-invite", handle, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: base.startsWith("https:"),
        maxAge: 3600,
      });
    else jar.delete("klikilig-invite");
  }
  jar.delete("klikilig-signup-invite");
  jar.delete("klikilig-next");
  jar.delete("klikilig-signup-email");
  jar.set("klikilig-welcome", user.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: base.startsWith("https:"),
    path: "/",
    maxAge: 120,
  });
  return go("/auth/confirmation?receipt=" + encodeURIComponent(ticket));
}
