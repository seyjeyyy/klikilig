import { origin } from "@/lib/server";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-serif-text/400.css";
import "@fontsource/dm-serif-text/400-italic.css";
import "@fontsource/caveat/500.css";
import "./style.css";
export const metadata = {
  metadataBase:
    process.env.APP_ORIGIN || process.env.VERCEL_URL
      ? new URL(origin())
      : undefined,
  title: "Klikilig · A little photo date",
  description:
    "A private online photo booth for two people in different places.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
