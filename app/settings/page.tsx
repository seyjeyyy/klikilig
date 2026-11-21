import { account } from "@/lib/server";
import { Header } from "@/components/brand";
import { Preferences } from "@/components/preferences";
export default async function Page() {
  const { user } = await account("/settings");
  return (
    <>
      <Header member />
      <main className="container">
        <h1>Settings</h1>
        <Preferences
          name={user.user_metadata.display_name || ""}
          reduced={!!user.user_metadata.reduced_motion}
        />
      </main>
    </>
  );
}
