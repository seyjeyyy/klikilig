import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
/** Minimal signed result from the operator's age-assurance gateway. Images and documents are never accepted. */
export async function POST(req: NextRequest) {
  const secret = process.env.ELIGIBILITY_WEBHOOK_SECRET,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY,
    url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const deny = () =>
    NextResponse.json({ error: "Unavailable" }, { status: 403 });
  if (process.env.ADULT_PRIVATE_ENABLED !== "true" || !secret || !key || !url)
    return deny();
  const ts = req.headers.get("x-klikilig-timestamp") || "",
    sig = req.headers.get("x-klikilig-signature") || "";
  if (
    !/^\d{10}$/.test(ts) ||
    Math.abs(Date.now() / 1000 - Number(ts)) > 180 ||
    !/^\w{64}$/.test(sig)
  )
    return deny();
  const raw = await req.text();
  if (raw.length > 1024) return deny();
  const expected = createHmac("sha256", secret)
    .update(ts + "." + raw)
    .digest();
  const given = Buffer.from(sig, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return deny();
  try {
    const b = JSON.parse(raw);
    const admin = createClient(url, key, { auth: { persistSession: false } });
    if (
      Object.keys(b).join(",") === "available" &&
      typeof b.available === "boolean"
    ) {
      const { error } = await admin.rpc("booth_provider_health", {
        observed_at: new Date(Number(ts) * 1000).toISOString(),
        available: b.available,
      });
      return error ? deny() : new NextResponse(null, { status: 204 });
    }
    if (
      Object.keys(b).sort().join(",") !== "eligible,expires,user_id" ||
      typeof b.eligible !== "boolean" ||
      typeof b.user_id !== "string" ||
      !Number.isFinite(Date.parse(b.expires))
    )
      return deny();
    const { error } = await admin.rpc("booth_eligibility_result", {
      subject: b.user_id,
      valid_until: b.eligible ? b.expires : new Date(0).toISOString(),
    });
    return error ? deny() : new NextResponse(null, { status: 204 });
  } catch {
    return deny();
  }
}
