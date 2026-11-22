import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";
export default async function VerificationNotice({
  user,
  reopen = false,
}: {
  user: User | null;
  reopen?: boolean;
}) {
  if (
    !user?.email_confirmed_at ||
    (await cookies()).get("klikilig-welcome")?.value !== user.id
  )
    return null;
  return (
    <div className="container" role="status">
      <strong>Email verified. Welcome to Klikilig!</strong>
      {reopen && <p>Reopen your original invitation to join your person.</p>}
    </div>
  );
}
