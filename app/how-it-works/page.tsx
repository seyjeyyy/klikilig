import { Header } from "@/components/brand";
import { Steps } from "@/components/landing";
import Link from "next/link";
export default function Page() {
  return (
    <>
      <Header />
      <main className="container">
        <h1>How it works</h1>
        <Steps />
        <div className="paper">
          <h2>Inside your booth</h2>
          <p>
            Sign in and share the private invitation with one person. Each of
            you chooses when to turn on your camera and when to take a photo.
          </p>
          <h2>Your keepsake</h2>
          <p>
            Photos and notes travel between your browsers. Download your
            finished strip before leaving. Saving to My Strips keeps a copy in
            this browser.
          </p>
          <Link className="button primary" href="/dashboard?create=1">
            Create a room
          </Link>
        </div>
      </main>
    </>
  );
}
