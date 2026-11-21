export const layouts = [
  "3-shot strip",
  "4-shot strip",
  "Polaroid",
  "Square collage",
] as const;
export function safeNext(input: string | null) {
  return input &&
    (/^\/room\/[0-9a-f-]{36}$/.test(input) ||
      [
        "/dashboard",
        "/dashboard?create=1",
        "/invite",
        "/strips",
        "/settings",
      ].includes(input))
    ? input
    : "/dashboard";
}
export async function api(action: string, data: Record<string, unknown> = {}) {
  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...data }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Please try again.");
  return result;
}
