import { db } from "@/lib/server";
import Invite from "@/components/invite";
import { Header } from "@/components/brand";
import VerificationNotice from "@/components/verification-notice";
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
  const user = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? (await (await db()).auth.getUser()).data.user
    : null;
  const signed = !!user;
  return (
    <>
      <Header member={signed} />
      <VerificationNotice user={user} />
      <Invite signed={signed} />
    </>
  );
}
