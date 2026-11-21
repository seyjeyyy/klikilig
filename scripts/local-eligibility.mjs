// Set up synthetic eligibility in a disposable local Supabase project only.
import { createClient } from "@supabase/supabase-js";
const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
if (
  process.env.NODE_ENV === "production" ||
  process.env.VERCEL ||
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
  process.env.KLIKILIG_LOCAL_TEST !== "1"
)
  throw Error("Local test project required.");
const user = process.argv[2];
if (!user) throw Error("Pass a local test user UUID.");
const client = createClient(url.origin, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { error } = await client.rpc("booth_eligibility_result", {
  subject: user,
  valid_until: new Date(Date.now() + 3600000).toISOString(),
});
if (error) throw Error("Could not set local test eligibility.");
async function pulse() {
  const { error } = await client.rpc("booth_provider_health", {
    observed_at: new Date().toISOString(),
    available: true,
  });
  if (error) throw Error("Could not refresh the local test provider.");
}
await pulse();
if (process.argv.includes("--watch"))
  setInterval(() => pulse().catch(() => process.exit(1)), 60_000);
