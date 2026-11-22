import { createHash, createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { db, origin } from "@/lib/server";
import { safeNext } from "@/lib/shared";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export async function POST(req: NextRequest) {
  try {
    const base = origin();
    if (req.headers.get("origin") !== base)
      return NextResponse.json(
        { error: "Use the configured app address." },
        { status: 403 },
      );
    const data = await req.json(),
      action = String(data.action),
      client = await db(),
      jar = await cookies();
    const cookie = {
      httpOnly: true,
      secure: base.startsWith("https:"),
      sameSite: "lax" as const,
      path: "/",
      maxAge: 3600,
    };
    const callback = base + "/auth/callback";
    async function rpc(name: string, args: Record<string, unknown> = {}) {
      const { data: result, error } = await client.rpc(name, args);
      if (error)
        throw new Error(
          error.code === "P0001"
            ? error.message
            : "The room service could not complete this request.",
        );
      return result;
    }
    let result: unknown = {};
    if (["signup", "login", "forgot-password", "resend"].includes(action)) {
      const next = safeNext(
        data.next ??
          (action === "resend" ? jar.get("klikilig-next")?.value : null),
      );
      jar.set("klikilig-next", next, cookie);
      const email = String(data.email).trim(),
        password = String(data.password || "");
      if (action === "login") {
        const res = await client.auth.signInWithPassword({ email, password });
        if (res.error)
          throw new Error(
            "Check your email and password, and confirm your email before logging in.",
          );
        result = { next };
        jar.delete("klikilig-next");
        jar.delete("klikilig-signup-email");
      }
      if (action === "signup") {
        const name = String(data.name || "").trim();
        if (!name || name.length > 80 || password.length < 8)
          throw new Error(
            "Enter a display name and a password of at least eight characters.",
          );
        const res = await client.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: name,
              signup_intent:
                next === "/invite"
                  ? "invite"
                  : next === "/dashboard?create=1"
                    ? "create"
                    : "dashboard",
            },
            emailRedirectTo: callback,
          },
        });
        if (res.error)
          throw new Error(
            "Signup could not be completed. Check your details or try logging in.",
          );
        result = { confirm: !res.data.session, next };
        if (!res.data.session) {
          jar.set("klikilig-signup-email", digest(email.toLowerCase()), cookie);
          const handle =
            next === "/invite" ? jar.get("klikilig-invite")?.value : undefined;
          if (handle) jar.set("klikilig-signup-invite", handle, cookie);
          else jar.delete("klikilig-signup-invite");
        } else jar.delete("klikilig-next");
      }
      if (action === "resend") {
        const { error } = await client.auth.resend({
          type: "signup",
          email,
          options: { emailRedirectTo: callback },
        });
        if (error)
          throw new Error(
            "Please wait before requesting another confirmation.",
          );
      }
      if (action === "forgot-password") {
        await client.auth.resetPasswordForEmail(email, {
          redirectTo: callback + "?flow=recovery",
        });
      }
    } else if (action === "continue") {
      if (!/^[A-Za-z0-9_-]{43}$/.test(data.token))
        throw new Error(
          "This invitation is incomplete. Reopen the original link.",
        );
      const handle = await rpc("booth_continue", {
        secret_digest: digest(data.token),
      });
      jar.set("klikilig-invite", handle, cookie);
    } else {
      const {
        data: { user },
      } = await client.auth.getUser();
      if (!user)
        return NextResponse.json(
          { error: "Please sign in to continue." },
          { status: 401 },
        );
      switch (action) {
        case "logout":
          await client.auth.signOut();
          jar.delete("klikilig-invite");
          break;
        case "settings": {
          const name = String(data.name || "").trim();
          if (!name || name.length > 80)
            throw new Error("Use a display name between 1 and 80 characters.");
          const { error } = await client.auth.updateUser({
            data: { display_name: name, reduced_motion: !!data.reducedMotion },
          });
          if (error) throw new Error("Could not save preferences.");
          break;
        }
        case "reset-password": {
          if (String(data.password).length < 8)
            throw new Error("Use at least eight characters.");
          const { error } = await client.auth.updateUser({
            password: data.password,
          });
          if (error) throw new Error("Please request a new recovery email.");
          result = { next: safeNext(jar.get("klikilig-next")?.value || null) };
          break;
        }
        case "create": {
          const token = String(data.token);
          if (!/^[A-Za-z0-9_-]{43}$/.test(token))
            throw new Error("Invalid invitation.");
          if (data.adult && process.env.ADULT_PRIVATE_ENABLED !== "true")
            throw new Error("Adult private is unavailable.");
          const id = await rpc("booth_create", {
            req: data.req,
            title_input: data.title,
            layout_input: data.layout,
            secret_digest: digest(token),
            is_adult: !!data.adult,
          });
          jar.set("link-" + id, token, { ...cookie, maxAge: 86400 });
          result = { id };
          break;
        }
        case "preview":
        case "join": {
          const handle = jar.get("klikilig-invite")?.value;
          if (!handle)
            throw new Error("Reopen your original invitation to join.");
          result = await rpc("booth_invitation", {
            handle,
            accept_invite: action === "join",
          });
          break;
        }
        case "link":
        case "rotate": {
          const snap = await rpc("booth_action", {
            rid: data.id,
            op: "snapshot",
          });
          if (snap.room.host !== user.id || snap.members.length !== 1)
            throw new Error("This invitation is no longer available.");
          let token = jar.get("link-" + data.id)?.value;
          if (
            action === "link" &&
            token &&
            !(await rpc("booth_host_link_valid", {
              rid: data.id,
              secret_digest: digest(token),
            }))
          ) {
            jar.delete("link-" + data.id);
            token = undefined;
          }
          if (action === "rotate") {
            token = randomBytes(32).toString("base64url");
            await rpc("booth_action", {
              rid: data.id,
              op: "rotate",
              p: { digest: digest(token) },
            });
            jar.set("link-" + data.id, token, { ...cookie, maxAge: 86400 });
          }
          result = { link: token ? base + "/invite#" + token : null };
          break;
        }
        case "ice": {
          await rpc("booth_action", { rid: data.id, op: "snapshot" });
          const urls = process.env.TURN_URL,
            secret = process.env.TURN_SECRET;
          const username =
            Math.floor(Date.now() / 1000 + 1800) +
            ":" +
            user.id +
            ":" +
            data.id;
          result = {
            servers: [
              { urls: "stun:stun.l.google.com:19302" },
              ...(urls && secret
                ? [
                    {
                      urls: urls.split(","),
                      username,
                      credential: createHmac("sha1", secret)
                        .update(username)
                        .digest("base64"),
                    },
                  ]
                : []),
            ],
          };
          break;
        }
        case "room":
          if (
            ![
              "snapshot",
              "ready",
              "schedule",
              "cancel",
              "stop",
              "live",
              "ack",
              "approve",
              "filter",
              "edit",
              "end",
              "block",
              "report",
            ].includes(data.op)
          )
            throw new Error("Unknown room action.");
          result = await rpc("booth_action", {
            rid: data.id,
            op: data.op,
            p: data.p || {},
          });
          break;
        default:
          throw new Error("Unknown action.");
      }
    }
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Please try again." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
