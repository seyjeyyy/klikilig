import { account } from "@/lib/server";
import { Header } from "@/components/brand";
import { Strips } from "@/components/preferences";
export default async function Page() {
  const { user } = await account("/strips");
  return (
    <>
      <Header member />
      <main className="container">
        <h1>My Strips</h1>
        <p>Photo dates you’ve saved on this device.</p>
        <Strips owner={user.id} />
      </main>
    </>
  );
}
