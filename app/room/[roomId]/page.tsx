import Booth from "@/components/booth";
import { Header } from "@/components/brand";
import { account } from "@/lib/server";
import Link from "next/link";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ invite?: string }>;
}) {
  const { roomId } = await params;
  const { client, user } = await account("/room/" + roomId);
  const { data, error } = await client.rpc("booth_action", {
    rid: roomId,
    op: "snapshot",
  });
  return (
    <>
      <Header member />
      {error ? (
        <main className="container">
          <h1>Room unavailable</h1>
          <p>This room has ended, expired, or belongs to another account.</p>
          <Link href="/dashboard">Return to dashboard</Link>
        </main>
      ) : (
        <Booth
          reduced={!!user.user_metadata.reduced_motion}
          initial={data}
          invite={(await searchParams).invite === "1"}
        />
      )}
    </>
  );
}
