// Talks to the local Claude server (scripts/server.ts). Works from the browser and from Node scripts.
const SERVER_URL = "http://localhost:3001/api/claude";

/** Room layout uses Opus: placing geometry that fits, connects and climbs is the hardest step. */
export const ROOM_MODEL = "claude-opus-5-5";

/** `model` must be one the server allows; omit it for the server's default (Sonnet). */
export async function askClaude(prompt: string, model?: string): Promise<string> {
  const res = await fetch(SERVER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, model }),
  });
  const data = (await res.json()) as { text?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? `Claude server error ${res.status}`);
  return data.text ?? "";
}
