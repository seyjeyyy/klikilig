import { test, expect, Page, BrowserContext } from "@playwright/test";
import { confirmationEmail } from "./mailbox";
test("landing postcard and responsive routes without a camera prompt", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw Error("Unexpected camera request");
    };
  });
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Magkalayo man, isang klik lang." }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.getByRole("button", { name: "Preview a postcard" }).click();
  await expect(
    page.getByText("save the last photo for our silliest faces."),
  ).toBeVisible();
  await page.getByRole("link", { name: "Create a room" }).click();
  await expect(page).toHaveURL(/login/);
});
const suffix = () => crypto.randomUUID().slice(0, 12);
async function signup(page: Page, name: string) {
  await page.getByLabel("Display name").fill(name);
  const email = suffix() + "@example.test";
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Photo-date-12345!");
  await page.getByLabel("Confirm password").fill("Photo-date-12345!");
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  if (process.env.KLIKILIG_EMAIL_TEST === "1") {
    await expect(
      page.getByRole("heading", { name: "Check your email" }),
    ).toBeVisible();
    await page.goto(await confirmationEmail(email));
    await expect(
      page.getByText("Email verified. Welcome to Klikilig!"),
    ).toBeAttached();
  }
}
async function setup(context: BrowserContext) {
  await context.grantPermissions([
    "camera",
    "microphone",
    "clipboard-read",
    "clipboard-write",
  ]);
  return context.newPage();
}
test("two accounts open and accept the same invitation", async ({
  browser,
  baseURL,
}) => {
  test.skip(
    process.env.KLIKILIG_INTEGRATION !== "1",
    "Requires isolated local Supabase Auth and Postgres.",
  );
  const hostContext = await browser.newContext({ baseURL }),
    guestContext = await browser.newContext({
      baseURL,
      viewport: { width: 390, height: 844 },
    });
  try {
    const host = await setup(hostContext),
      guest = await setup(guestContext);
    await host.goto("/");
    await host.getByRole("link", { name: "Create a room" }).click();
    await host.getByRole("link", { name: "Create an account" }).click();
    await signup(host, "José");
    const form = host.getByRole("dialog");
    await form.getByLabel("Starting layout").selectOption("3-shot strip");
    await form
      .getByRole("button", { name: "Create room", exact: true })
      .click();
    host.on("pageerror", (e) => console.error(e.message));
    const sheet = host.getByRole("dialog");
    const input = sheet.getByLabel("Private invitation");
    await expect(input).toHaveValue(/\/invite#/, { timeout: 30000 });
    const link = await input.inputValue();
    await sheet.getByRole("button", { name: "Copy link", exact: true }).click();
    await expect(sheet.getByText("Link copied", { exact: true })).toBeVisible();
    await sheet.getByRole("button", { name: "Close" }).click();
    await guest.goto(link);
    await guest.getByRole("link", { name: "Create an account" }).click();
    await signup(guest, "María");
    await expect(guest).toHaveURL(/\/invite$/);
    await expect(
      host.getByText("Waiting for your partner", { exact: true }),
    ).toBeVisible();
    await guest.getByRole("button", { name: "Join this room" }).click();
    await expect(guest).toHaveURL(host.url().split("?")[0]);
    await expect(host.getByText(/Partner joined ·/)).toBeVisible();
    if (process.env.KLIKILIG_MEDIA_TEST !== "1") return;
    await Promise.all(
      [host, guest].map((p) =>
        p.getByRole("button", { name: "Turn on camera" }).click(),
      ),
    );
    async function take(shot: number) {
      await Promise.all(
        [host, guest].map((p) =>
          p.getByRole("button", { name: "Ready", exact: true }).click(),
        ),
      );
      await host.getByRole("button", { name: "Take photo " + shot }).click();
    }
    async function rows() {
      return host.locator(".editor canvas").evaluate(async (node) => {
        const ctx = (node as HTMLCanvasElement).getContext("2d")!;
        return Promise.all(
          [85, 265, 450].map(async (y) => {
            const data = ctx.getImageData(30, y, 300, 65).data;
            if (new Set(data).size < 32) return "";
            const hash = await crypto.subtle.digest("SHA-256", data);
            return Array.from(new Uint8Array(hash), (v) =>
              v.toString(16).padStart(2, "0"),
            ).join("");
          }),
        );
      });
    }
    for (const shot of [1, 2, 3]) {
      await take(shot);
      for (const p of [host, guest])
        await expect(
          p.getByRole("button", { name: "Retake " + shot, exact: true }),
        ).toBeVisible({ timeout: 20000 });
    }
    await expect.poll(async () => (await rows()).every(Boolean)).toBeTruthy();
    const original = await rows();
    await host.getByRole("button", { name: "Retake 2" }).click();
    await expect(
      guest.getByRole("button", { name: "Retake 2" }),
    ).toHaveAttribute("aria-pressed", "true");
    await take(2);
    for (const page of [host, guest]) {
      await expect
        .poll(
          async () =>
            page.evaluate(async () => {
              const response = await fetch("/api/action", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "room",
                  id: location.pathname.split("/").pop(),
                  op: "snapshot",
                }),
              });
              const snapshot = await response.json();
              return [
                snapshot.round?.attempt,
                snapshot.round?.status,
                snapshot.room?.revision,
              ].join("/");
            }),
          { timeout: 22000 },
        )
        .toBe("2/done/4");
    }
    await expect.poll(async () => (await rows())[1]).not.toBe(original[1]);
    const retaken = await rows();
    expect(retaken[0]).toBe(original[0]);
    expect(retaken[2]).toBe(original[2]);
    for (const [p, note] of [
      [host, "Mahal kita"],
      [guest, "See you soon"],
    ] as const) {
      await p.getByLabel("If you were here right now, I’d…").fill(note);
      await p.getByRole("button", { name: "Seal note" }).click();
    }
    await Promise.all(
      [host, guest].map((p) =>
        p.getByRole("button", { name: "Turn it over" }).click(),
      ),
    );
    await expect(
      host.getByRole("button", { name: "View front" }),
    ).toBeVisible();
    await Promise.all(
      [host, guest].map((p) =>
        p.getByRole("button", { name: "Approve this revision" }).click(),
      ),
    );
    await host.getByRole("button", { name: "Prepare postcard" }).click();
    await expect(
      guest.getByRole("button", { name: "Download postcard" }),
    ).toBeVisible();
    const hashes = await Promise.all(
      [host, guest].map(async (p) => {
        const pending = p.waitForEvent("download");
        await p.getByRole("button", { name: "Download postcard" }).click();
        const file = await pending,
          readable = await file.createReadStream();
        const { createHash } = await import("node:crypto");
        const hash = createHash("sha256");
        for await (const chunk of readable!) hash.update(chunk);
        return hash.digest("hex");
      }),
    );
    expect(hashes[0]).toBe(hashes[1]);
  } finally {
    if (test.info().status !== "passed") {
      for (const [seat, context] of [
        ["host", hostContext],
        ["guest", guestContext],
      ] as const) {
        const page = context.pages()[0];
        if (page && new URL(page.url()).pathname.startsWith("/room/")) {
          const status = await page
            .locator("main > [role=status]")
            .textContent({ timeout: 1000 })
            .catch(() => "");
          if (status) console.info(seat + " room status: " + status);
        }
      }
    }
    await guestContext.close();
    await hostContext.close();
  }
});
