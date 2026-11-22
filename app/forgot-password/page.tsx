import Auth from "@/components/auth";
import { Header } from "@/components/brand";
import { safeNext } from "@/lib/shared";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string;

    expired?: string;
  }>;
}) {
  const p = await searchParams;
  return (
    <>
      <Header />
      <Auth
        mode="forgot-password"
        next={safeNext(p.next || null)}
        message={
          p.expired ? "This email link has expired. Request another one." : ""
        }
      />
    </>
  );
}
