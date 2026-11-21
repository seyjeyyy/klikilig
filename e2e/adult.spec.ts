import { test, expect, Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

test("two verified adults independently permit live video, a shot and an export", async ({
  browser,
  baseURL,
}) => {
  test.skip(
    process.env.KLIKILIG_ADULT_TEST !== "1",
    "Requires the disposable local adult-mode fixture.",
  );
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname))
    throw Error("A local test project is required.");
  const admin = createClient(url.origin, process.env.KLIKILIG_TEST_ADMIN_KEY!, {
    auth: { persistSession: false },
  });
  async function heartbeat() {
    const { error } = await admin.rpc("booth_provider_health", {
      observed_at: new Date().toISOString(),
      available: true,
    });
    if (error) throw Error("Test provider unavailable.");
  }
  const contexts = await Promise.all(
    [1, 2].map(() => browser.newContext({ baseURL, permissions: ["camera"] })),
  );
  const [host, guest] = await Promise.all(contexts.map((c) => c.newPage()));
  const password = "Synthetic-color-bars-12345!";
  async function login(page: Page, name: string) {
    const email = crypto.randomUUID() + "@example.test";
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: name },
    });
    expect(error).toBeNull();
    const eligible = await admin.rpc("booth_eligibility_result", {
      subject: data.user!.id,
      valid_until: new Date(Date.now() + 3600000).toISOString(),
    });
    expect(eligible.error).toBeNull();
    await page.goto("/login");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  }
  await heartbeat();
  const pulse = setInterval(() => {
    void heartbeat();
  }, 50000);
  try {
    await Promise.all([login(host, "Alex"), login(guest, "Sam")]);
    await host
      .getByRole("button", { name: "Create a room", exact: true })
      .click();
    const form = host.getByRole("dialog");
    await form.getByLabel("Session type").selectOption("adult");
    await form.getByLabel("Starting layout").selectOption("Polaroid");
    await form
      .getByRole("button", { name: "Create room", exact: true })
      .click();
    const sheet = host.getByRole("dialog"),
      link = sheet.getByLabel("Private invitation");
    await expect(link).toHaveValue(/\/invite#/, { timeout: 20000 });
    await guest.goto(await link.inputValue());
    await expect(
      guest.getByText(/Your partner can still take screenshots/),
    ).toBeVisible();
    await guest.getByRole("button", { name: "Join this room" }).click();
    await expect(host.getByText("Partner joined · Connected")).toBeVisible({
      timeout: 20000,
    });
    await host.getByRole("button", { name: "Agree to live sharing" }).click();
    await expect(
      host.getByRole("button", { name: "Turn on camera" }),
    ).toBeDisabled();
    await guest.getByRole("button", { name: "Agree to live sharing" }).click();
    for (const page of [host, guest]) {
      await page.getByRole("button", { name: "Turn on camera" }).click();
      await page.getByRole("button", { name: "Ready", exact: true }).click();
    }
    await host.getByRole("button", { name: "Take photo 1" }).click();
    await expect(guest.getByRole("button", { name: "Retake 1" })).toBeVisible({
      timeout: 20000,
    });
    await host.getByRole("button", { name: "Approve this revision" }).click();
    await expect(
      host.getByRole("button", { name: "Prepare photo strip" }),
    ).toBeDisabled();
    await guest.getByRole("button", { name: "Approve this revision" }).click();
    await host.getByRole("button", { name: "Prepare photo strip" }).click();
    await expect(
      guest.getByRole("button", { name: "Download photo strip" }),
    ).toBeVisible({ timeout: 20000 });
    await expect(
      guest.getByRole("button", { name: "Save to My Strips" }),
    ).toHaveCount(0);
    const tracks = await Promise.all(
      [host, guest].map((page, seat) =>
        page
          .locator(".tile video")
          .nth(seat)
          .evaluateHandle(
            (video) =>
              (
                (video as HTMLVideoElement).srcObject as MediaStream
              ).getVideoTracks()[0],
          ),
      ),
    );
    for (const track of tracks)
      expect(await track.evaluate((t) => t.readyState)).toBe("live");
    await host.route("**/api/action", (route) =>
      route.request().postDataJSON().op === "stop"
        ? route.abort()
        : route.continue(),
    );
    await host.getByRole("button", { name: "Stop sharing" }).click();
    await expect(
      host.getByRole("button", { name: "Stop sharing" }),
    ).toHaveCount(0);
    await expect(
      guest.getByRole("button", { name: "Stop sharing" }),
    ).toHaveCount(0);
    await expect(
      host.getByRole("button", { name: "Turn on camera" }),
    ).toBeDisabled();
    await expect(
      host.getByRole("button", { name: "Download photo strip" }),
    ).toHaveCount(0);
    for (const track of tracks)
      expect(await track.evaluate((t) => t.readyState)).toBe("ended");
  } finally {
    clearInterval(pulse);
    await Promise.all(contexts.map((c) => c.close()));
  }
});
