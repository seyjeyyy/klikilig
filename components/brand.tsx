import Link from "next/link";
import { Heart } from "lucide-react";
export function Stamp() {
  return (
    <span className="stamp" aria-hidden="true">
      <Heart fill="currentColor" size={23} />
    </span>
  );
}
export function Brand() {
  return (
    <Link className="brand" href="/">
      <Stamp />
      Klikilig
    </Link>
  );
}
export function Header({ member = false }: { member?: boolean }) {
  return (
    <header>
      <nav>
        <Brand />
        <div className="navlinks">
          <Link href="/how-it-works">How it works</Link>
          {member ? (
            <>
              <Link href="/dashboard">Dashboard</Link>
              <Link className="signup" href="/settings">
                Settings
              </Link>
            </>
          ) : (
            <>
              <Link href="/login">Log in</Link>
              <Link className="signup" href="/signup">
                Sign up
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
