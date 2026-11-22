import { expect } from "@playwright/test";
/** Inspect only the disposable local SMTP inbox. Never print email tokens. */
export async function confirmationEmail(email: string) {
  const inbox = "http://127.0.0.1:54324/api/v1";
  let link = "";
  await expect
    .poll(
      async () => {
        const response = await fetch(inbox + "/messages");
        if (!response.ok) return false;
        const list = (await response.json()) as {
          messages: { ID: string; To: { Address: string }[] }[];
        };
        const hit = list.messages.find((m) =>
          m.To.some((t) => t.Address === email),
        );
        if (!hit) return false;
        const message = await (
          await fetch(inbox + "/message/" + hit.ID)
        ).json();
        link =
          String(message.HTML)
            .match(/href="([^"]+)"/i)?.[1]
            .replaceAll("&amp;", "&") || "";
        return !!link;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  const parsed = new URL(link);
  expect(parsed.origin + parsed.pathname).toBe(
    "http://localhost:3000/auth/callback",
  );
  expect(parsed.searchParams.has("token_hash")).toBe(true);
  return link;
}
