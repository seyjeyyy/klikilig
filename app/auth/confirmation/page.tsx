import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Header } from "@/components/brand";
import { db } from "@/lib/server";
import Resend from "./resend";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Email confirmation · Klikilig",
  robots: { index: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ receipt?: string }>;
}) {
  const { receipt } = await searchParams,
    jar = await cookies();
  const proof =
    receipt && /^[0-9a-f-]{36}$/i.test(receipt)
      ? (await (await db()).rpc("consume_email_receipt", { receipt })).data
      : null;
  const missingInvite =
    proof?.intent === "invite" && !jar.has("klikilig-invite");
  const next =
    proof?.intent === "create"
      ? "/dashboard?create=1"
      : proof?.intent === "invite" && !missingInvite
        ? "/invite"
        : "/dashboard";
  if (proof?.signed_in) redirect(next + (missingInvite ? "?reopen=1" : ""));
  return (
    <>
      <Header />
      <main className="center">
        <section className="paper formcard">
          <h1>
            {proof
              ? "Email verified. Log in to continue"
              : "This confirmation link is unavailable"}
          </h1>
          <p>
            {proof
              ? missingInvite
                ? "After logging in, reopen your original invitation to join your person."
                : "Log in to continue your photo date."
              : "The link may have expired, already been used, or been copied incompletely. If you already confirmed your email, log in. Otherwise, request a fresh link."}
          </p>
          <Link
            className="button primary"
            href={"/login?next=" + encodeURIComponent(next)}
          >
            Log in
          </Link>
          {!proof && <Resend />}
        </section>
      </main>
    </>
  );
}
