import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

test("confirmation and recovery links work in fresh browser contexts", async ({
  browser,
  baseURL,
}) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.KLIKILIG_TEST_ADMIN_KEY;
  test.skip(!url || !key, "Requires a disposable local Auth admin credential.");
  if (!["localhost", "127.0.0.1"].includes(new URL(url!).hostname)) {
    throw new Error("This account test requires a loopback Supabase instance.");
  }
  const admin = createClient(url!, key!, { auth: { persistSession: false } });
  const email = crypto.randomUUID() + "@example.test";
  const password = "Postcard-test-12345!";
  const signup = await admin.auth.admin.generateLink({
    type: "signup",
    email,
    password,
  });
  expect(signup.error).toBeNull();
  const callback = (hash: string, type: string) =>
    "/auth/callback?type=" + type + "&token_hash=" + encodeURIComponent(hash);
  const confirmed = await browser.newContext({ baseURL });
  const recovered = await browser.newContext({ baseURL });
  try {
    const first = await confirmed.newPage();
    await first.goto(callback(signup.data.properties!.hashed_token, "email"));
    await expect(
      first.getByText("Email verified. Welcome to Klikilig!"),
    ).toBeVisible();
    await first.goto("/dashboard");
    await expect(
      first.getByRole("heading", { name: "Active rooms" }),
    ).toBeVisible();
    const recovery = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
    });
    expect(recovery.error).toBeNull();
    const second = await recovered.newPage();
    await second.goto(
      callback(recovery.data.properties!.hashed_token, "recovery"),
    );
    await second.getByLabel("Password", { exact: true }).fill(password + "2");
    await second.getByLabel("Confirm password").fill(password + "2");
    await second.getByRole("button", { name: "Save new password" }).click();
    await expect(second).toHaveURL(/\/dashboard$/);
  } finally {
    await confirmed.close();
    await recovered.close();
  }
});
