import { createServer } from "node:http";
import { query } from "@anthropic-ai/claude-agent-sdk";

const PORT = 3001;

// Strip the API key so the Agent SDK falls back to the local Claude Code login (your subscription).
const { ANTHROPIC_API_KEY: _unused, ...subscriptionEnv } = process.env;

// Callers may pick a model per request; anything else falls back to the default.
// Sonnet is the fast default; room layout asks for Opus because spatial planning benefits from it.
const DEFAULT_MODEL = "claude-sonnet-5-5";
const ALLOWED_MODELS = new Set([DEFAULT_MODEL, "claude-opus-5-5"]);

async function askClaude(prompt: string, model = DEFAULT_MODEL): Promise<string> {
  for await (const message of query({
    prompt,
    options: {
      tools: [], // plain text in, text out: no file/bash access
      maxTurns: 1,
      model,
      effort: "medium",
      env: subscriptionEnv,
    },
  })) {
    if (message.type === "result") {
      if (message.subtype !== "success") throw new Error(`Claude failed: ${message.subtype}`);
      return message.result;
    }
  }
  throw new Error("No result from Claude");
}

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:5173"); // Vite dev server
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  if (req.method !== "POST" || req.url !== "/api/claude") {
    return res.writeHead(404).end();
  }

  try {
    let body = "";
    for await (const chunk of req) body += chunk;
    const { prompt, model } = JSON.parse(body) as { prompt?: string; model?: string };
    if (!prompt) {
      return res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Missing prompt" }));
    }
    if (model !== undefined && !ALLOWED_MODELS.has(model)) {
      return res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: `Unsupported model: ${model}` }));
    }

    const text = await askClaude(prompt, model);
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ text }));
  } catch (error) {
    console.error(error);
    res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: String(error) }));
  }
});

// Bind to 127.0.0.1 so only this machine can use your subscription.
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Claude server listening on http://localhost:${PORT}/api/claude`);
});
