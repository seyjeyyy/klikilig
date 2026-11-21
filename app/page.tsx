import Landing from "@/components/landing";
import { Header } from "@/components/brand";
import { db } from "@/lib/server";
export default async function Page() {
  const member = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? !!(await (await db()).auth.getUser()).data.user
    : false;
  return (
    <>
      <Header member={member} />
      <Landing />
    </>
  );
}
