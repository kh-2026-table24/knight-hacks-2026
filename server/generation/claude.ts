import Anthropic from "@anthropic-ai/sdk";
import type { TokenUsage } from "../../src/shared/api";
import { log } from "../log";

// The Claude API client for game generation. It reads ANTHROPIC_API_KEY from the environment
// (npm run dev loads .env.local). It's made on first use so the server still starts without a key.
let client: Anthropic | undefined;
const claude = () => (client ??= new Anthropic());

const MODEL = "claude-opus-5-5";

// Text runs about this many characters per token; only used for the live estimate while a call streams.
const CHARS_PER_TOKEN = 4;
// A long call logs that it's still going this often, so the terminal doesn't look stuck.
const HEARTBEAT_MS = 20_000;
const count = (n: number) => n.toLocaleString("en-US");

/**
 * Adds up a game's tokens across its Claude calls, including calls still streaming. Those count their
 * input as soon as it's known and an estimate of their output so far, until the exact count arrives.
 */
export class TokenMeter {
  private done: TokenUsage = { input: 0, cached: 0, output: 0, live: 0 };
  private readonly streaming = new Map<number, TokenUsage>();
  private nextCall = 0;

  /** `onChange` hears the new total after every update; `final` is when a call's exact count came in. */
  constructor(private readonly onChange: (total: TokenUsage, final: boolean) => void) {}

  /** Only the calls that have finished, with exact counts. */
  get finished(): TokenUsage {
    return this.done;
  }

  get total(): TokenUsage {
    const total = { ...this.done, live: this.streaming.size };
    for (const call of this.streaming.values()) {
      total.input += call.input;
      total.cached += call.cached;
      total.output += call.output;
    }
    return total;
  }

  /** Starts counting one call. Report its running usage; `final` the last time. */
  call() {
    const id = this.nextCall++;
    return (usage: Omit<TokenUsage, "live">, final = false) => {
      if (final) {
        this.streaming.delete(id);
        this.done = { input: this.done.input + usage.input, cached: this.done.cached + usage.cached, output: this.done.output + usage.output, live: 0 };
      } else {
        this.streaming.set(id, { ...usage, live: 1 });
      }
      this.onChange(this.total, final);
    };
  }
}

export interface AskOptions {
  /** Stable text shared by several calls (the format guide, the storyboard), cached so repeats are cheap. */
  system?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Shown in logs. */
  label: string;
  /** The game the call is for; its log lines go with that game. */
  gameId?: string;
  /** Counts what the call costs as it streams, even if it then throws (a refusal or a cut-off answer still spent them). */
  meter?: TokenMeter;
}

/** Sends one prompt and returns the text of Claude's answer. Throws if it was cut off or declined. */
export async function askClaude(prompt: string, { system, effort = "high", label, gameId, meter }: AskOptions): Promise<string> {
  const started = Date.now();
  const report = meter?.call();
  const live = { input: 0, cached: 0, output: 0 };
  let thinkingTokens = 0;
  let textChars = 0;
  log(gameId, `claude ${label}: started (effort ${effort})`);
  const heartbeat = setInterval(() => {
    const phase = textChars > 0 ? "writing the answer" : "thinking";
    log(gameId, `claude ${label}: ${phase}, ${Math.round((Date.now() - started) / 1000)}s, ~${count(live.output)} tokens out so far`);
  }, HEARTBEAT_MS);

  // Streamed because a whole room with thinking can run long, and so the meter can count as it goes.
  const stream = claude().beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    // Nothing reads the thinking, so it isn't sent; the token-count beta still streams a running
    // estimate of how much there's been.
    thinking: { type: "adaptive", display: "omitted" },
    output_config: { effort },
    // Horror themes can trip a safety classifier; on a refusal the API retries on a fallback model.
    betas: ["server-side-fallback-2026-07-01", "thinking-token-count-2026-05-13"],
    fallbacks: "default",
    ...(system && { system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] }),
    messages: [{ role: "user", content: prompt }],
  });
  stream.on("streamEvent", (event) => {
    if (event.type === "message_start") {
      const usage = event.message.usage;
      live.input = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0);
      live.cached = usage.cache_read_input_tokens ?? 0;
    } else if (event.type === "content_block_delta" && event.delta.type === "thinking_delta") {
      thinkingTokens += event.delta.estimated_tokens ?? 0;
    } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      textChars += event.delta.text.length;
    } else {
      return;
    }
    live.output = thinkingTokens + Math.round(textChars / CHARS_PER_TOKEN);
    report?.(live);
  });

  let message;
  try {
    message = await stream.finalMessage();
  } catch (error) {
    // The exact count never came; keep the estimate.
    report?.(live, true);
    log(gameId, `claude ${label}: failed after ${Math.round((Date.now() - started) / 1000)}s: ${error instanceof Error ? error.message : String(error)}`, "error");
    throw error;
  } finally {
    clearInterval(heartbeat);
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens } = message.usage;
  report?.({ input: input_tokens + (cache_creation_input_tokens ?? 0), cached: cache_read_input_tokens ?? 0, output: output_tokens }, true);
  log(gameId, `claude ${label}: done in ${seconds}s, ${count(input_tokens)} in (${count(cache_read_input_tokens ?? 0)} cached), ${count(output_tokens)} out`);

  if (message.stop_reason === "refusal") throw new Error(`Claude declined ${label}: ${message.stop_details?.explanation ?? "no reason given"}`);
  if (message.stop_reason === "max_tokens") throw new Error(`Claude ran out of tokens on ${label}`);
  return message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}
