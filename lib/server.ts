import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
export function origin() {
  const host =
    process.env.VERCEL_ENV === "preview"
      ? process.env.VERCEL_URL
      : process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const value =
    process.env.VERCEL_ENV === "preview" && host
      ? "https://" + host
      : process.env.APP_ORIGIN || (host ? "https://" + host : "");
  if (!value) throw new Error("Set APP_ORIGIN for this deployment.");
  const u = new URL(value);
  if (
    u.protocol !== "https:" &&
    !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))
  )
    throw new Error("A secure origin is required.");
  return u.origin;
}
export async function db() {
  const jar = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    throw new Error("Connect a Supabase project to enable accounts and rooms.");
  return createServerClient(url, key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll(items) {
        try {
          items.forEach(({ name, value, options }) =>
            jar.set(name, value, options),
          );
        } catch {
          /* Server components have read-only cookies. */
        }
      },
    },
  });
}
export async function account(next: string) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL)
    redirect("/login?next=" + encodeURIComponent(next));
  const client = await db();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/login?next=" + encodeURIComponent(next));
  return { client, user };
}
