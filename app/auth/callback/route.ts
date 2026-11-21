import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db, origin } from "@/lib/server";
import { safeNext } from "@/lib/shared";
export async function GET(req: NextRequest) {
  const url = req.nextUrl,
    client = await db(),
    jar = await cookies(),
    type = url.searchParams.get("type"),
    hash = url.searchParams.get("token_hash"),
    code = url.searchParams.get("code");
  const response =
    hash && (type === "email" || type === "recovery" || type === "signup")
      ? await client.auth.verifyOtp({ token_hash: hash, type })
      : code
        ? await client.auth.exchangeCodeForSession(code)
        : null;
  const next =
    type === "recovery" || url.searchParams.get("flow") === "recovery"
      ? "/reset-password"
      : jar.get("klikilig-invite")
        ? "/invite"
        : jar.has("klikilig-next")
          ? safeNext(jar.get("klikilig-next")!.value)
          : "/login?confirmed=1";
  return NextResponse.redirect(
    origin() + (!response || response.error ? "/login?expired=1" : next),
  );
}
