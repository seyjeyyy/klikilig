import Auth from "@/components/auth";
import { Header } from "@/components/brand";
import { safeNext } from "@/lib/shared";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string;
    confirmed?: string;
    expired?: string;
  }>;
}) {
  const p = await searchParams;
  return (
    <>
      <Header />
      <Auth
        mode="reset-password"
        next={safeNext(p.next || null)}
        message={
          p.confirmed
            ? "Your account is ready. Reopen your original invitation to join."
            : p.expired
              ? "This email link has expired. Request another one."
              : ""
        }
      />
    </>
  );
}
