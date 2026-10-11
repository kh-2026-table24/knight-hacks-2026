import Anthropic from "@anthropic-ai/sdk";

// The Claude API client for game generation. It reads ANTHROPIC_API_KEY from the environment
// (npm run dev loads .env.local). It's made on first use so the server still starts without a key.
let client: Anthropic | undefined;
const claude = () => (client ??= new Anthropic());

const MODEL = "claude-opus-5-5";

export interface AskOptions {
  /** Stable text shared by several calls (the format guide, the storyboard), cached so repeats are cheap. */
  system?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Shown in logs. */
  label: string;
}

/** Sends one prompt and returns the text of Claude's answer. Throws if it was cut off or declined. */
export async function askClaude(prompt: string, { system, effort = "high", label }: AskOptions): Promise<string> {
  const started = Date.now();
  // Streamed because a whole room with thinking can run long; finalMessage() just collects it.
  const message = await claude()
    .beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      output_config: { effort },
      // Horror themes can trip a safety classifier; on a refusal the API retries on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      ...(system && { system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] }),
      messages: [{ role: "user", content: prompt }],
    })
    .finalMessage();

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const { input_tokens, output_tokens, cache_read_input_tokens } = message.usage;
  console.log(`[claude] ${label}: ${seconds}s, ${input_tokens} in (${cache_read_input_tokens ?? 0} cached), ${output_tokens} out`);

  if (message.stop_reason === "refusal") throw new Error(`Claude declined ${label}: ${message.stop_details?.explanation ?? "no reason given"}`);
  if (message.stop_reason === "max_tokens") throw new Error(`Claude ran out of tokens on ${label}`);
  return message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}
