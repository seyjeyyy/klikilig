import { test, expect } from "@playwright/test";
import { confirmationEmail } from "./mailbox";
for (const scenario of [
  "same browser",
  "fresh browser",
  "cookies lost",
] as const) {
  test("signup email in " + scenario, async ({ browser, baseURL }) => {
    test.skip(
      process.env.KLIKILIG_EMAIL_TEST !== "1",
      "Requires confirmation-enabled local Supabase and Mailpit.",
    );
    const signup = await browser.newContext({ baseURL });
    const gmail = await browser.newContext({ baseURL });
    try {
      const page = await signup.newPage();
      const next =
        scenario === "same browser"
          ? "/dashboard?create=1"
          : scenario === "cookies lost"
            ? "/invite"
            : "/dashboard";
      const email = crypto.randomUUID() + "@example.test";
      await page.goto("/signup?next=" + encodeURIComponent(next));
      await page.getByLabel("Display name").fill("Photo date");
      await page.getByLabel("Email address").fill(email);
      for (const name of ["Password", "Confirm password"])
        await page.getByLabel(name, { exact: true }).fill("Test-confirm-234!");
      await page.getByRole("button", { name: "Sign up", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Check your email" }),
      ).toBeVisible();
      const link = await confirmationEmail(email);
      const reader = scenario === "same browser" ? page : await gmail.newPage();
      if (scenario === "cookies lost")
        await reader.route("**/auth/callback?**", async (route) => {
          const response = await route.fetch({ maxRedirects: 0 });
          const headers = { ...response.headers() };
          delete headers["set-cookie"];
          await gmail.clearCookies();
          await route.fulfill({ response, headers });
        });
      await reader.goto(link);
      if (scenario === "cookies lost") {
        await expect(
          reader.getByRole("heading", {
            name: "Email verified. Log in to continue",
          }),
        ).toBeVisible();
        await expect(
          reader.getByText(/reopen your original invitation/i),
        ).toBeVisible();
        await reader
          .getByRole("link", { name: "Log in", exact: true })
          .last()
          .click();
        await reader.getByLabel("Email address").fill(email);
        await reader
          .getByLabel("Password", { exact: true })
          .fill("Test-confirm-234!");
        await reader
          .getByRole("button", { name: "Log in", exact: true })
          .click();
        await expect(reader).toHaveURL(/\/dashboard$/);
      } else {
        await expect(
          reader.getByText("Email verified. Welcome to Klikilig!"),
        ).toBeAttached();
        await expect(reader).toHaveURL(/\/dashboard$/);
        if (scenario === "same browser") {
          await expect(reader.getByRole("dialog")).toBeVisible();
          await reader.reload();
          await expect(reader.getByRole("dialog")).not.toBeVisible();
        }
      }
      await reader.goto(link);
      await expect(
        reader.getByRole("button", { name: "Resend confirmation" }),
      ).toBeVisible();
      await expect(
        reader.getByText("Email verified. Welcome to Klikilig!"),
      ).toHaveCount(0);
      await reader.goto("/auth/callback?token_hash=invalid&type=signup");
      await expect(
        reader.getByRole("heading", {
          name: "This confirmation link is unavailable",
        }),
      ).toBeVisible();
    } finally {
      await signup.close();
      await gmail.close();
    }
  });
}
