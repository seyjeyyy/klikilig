import { db } from "@/lib/server";
import Invite from "@/components/invite";
import { Header } from "@/components/brand";
export const metadata = {
  title: "Private invitation · Klikilig",
  openGraph: {
    title: "Klikilig",
    description: "You’re invited to a private photo booth.",
    images: ["/icon.svg"],
  },
  robots: { index: false },
};
export default async function Page() {
  const signed = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? !!(await (await db()).auth.getUser()).data.user
    : false;
  return (
    <>
      <Header member={signed} />
      <Invite signed={signed} />
    </>
  );
}
