import { account } from "@/lib/server";
import { Header } from "@/components/brand";
import Dashboard from "@/components/dashboard";
import VerificationNotice from "@/components/verification-notice";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ create?: string; reopen?: string }>;
}) {
  const create = (await searchParams).create === "1";
  const { client, user } = await account(
    "/dashboard" + (create ? "?create=1" : ""),
  );
  const { data, error } = await client.rpc("booth_account");
  return (
    <>
      <Header member />
      {error ? (
        <main className="container">
          Room service unavailable. Check the project migrations.
        </main>
      ) : (
        <Dashboard
          notice={<VerificationNotice user={user} reopen={(await searchParams).reopen==="1"}/>}
          rooms={data.rooms}
          create={create}
          name={user.user_metadata.display_name || "there"}
          eligible={
            data.eligible && process.env.ADULT_PRIVATE_ENABLED === "true"
          }
        />
      )}
    </>
  );
}
