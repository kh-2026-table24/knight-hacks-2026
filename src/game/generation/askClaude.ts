// Talks to the local Claude server (scripts/server.ts). Works from the browser and from Node scripts.
const SERVER_URL = "http://localhost:3001/api/claude";

export async function askClaude(prompt: string): Promise<string> {
  const res = await fetch(SERVER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const data = (await res.json()) as { text?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? `Claude server error ${res.status}`);
  return data.text ?? "";
}
