import { pathToFileURL } from "node:url";

// Talks to the local Claude server (scripts/server.ts), which uses your Claude subscription.
const SERVER_URL = "http://localhost:3001/api/claude";

export async function askClaude(prompt: string): Promise<string> {
  const res = await fetch(SERVER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  const data = (await res.json()) as { text?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
  return data.text ?? "";
}

// Connection test: npm run claude -- "your message"
// (Skipped when imported by other scripts.)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const prompt = process.argv[2] ?? "Hello Claude! Reply with a short greeting to confirm the connection works.";

  try {
    console.log(`> ${prompt}\n`);
    console.log(await askClaude(prompt));
  } catch (error) {
    if (error instanceof TypeError) {
      console.error("Could not reach the local server. Start it first with: npm run server");
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}
