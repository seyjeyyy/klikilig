import Landing from "@/components/landing";
import { Header } from "@/components/brand";
import { db, origin } from "@/lib/server";
import { redirect } from "next/navigation";
import LegacyEmailError from "@/components/legacy-email-error";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; error_code?: string }>;
}) {
  const params = await searchParams;
  if (typeof params.code === "string")
    redirect(
      origin() + "/auth/callback?code=" + encodeURIComponent(params.code),
    );
  if (params.error_code) redirect(origin() + "/auth/confirmation");
  const member = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? !!(await (await db()).auth.getUser()).data.user
    : false;
  return (
    <>
      <Header member={member} />
      <Landing />
      <LegacyEmailError />
    </>
  );
}
