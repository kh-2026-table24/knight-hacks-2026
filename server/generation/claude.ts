import { query } from "@anthropic-ai/claude-agent-sdk";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaRawMessageStreamEvent } from "@anthropic-ai/sdk/resources/beta/messages";
import type { TokenUsage } from "../../src/shared/api";
import { log } from "../log";
import { onCloudRun } from "../secrets";

// Two ways to reach Claude. Locally, calls go through the Claude Code login on this machine (your
// subscription), via the Agent SDK. Cloud Run has no login, so there they use the API key
// (ANTHROPIC_API_KEY). CLAUDE_BACKEND=api or CLAUDE_BACKEND=subscription overrides the choice.
const BACKEND = process.env.CLAUDE_BACKEND === "api" || process.env.CLAUDE_BACKEND === "subscription" ? process.env.CLAUDE_BACKEND : onCloudRun ? "api" : "subscription";

// The API client is made on first use so the server still starts without a key.
let client: Anthropic | undefined;
const claude = () => (client ??= new Anthropic());

const MODEL = "claude-opus-5-5";
const MAX_OUTPUT_TOKENS = 64000;

// Text runs about this many characters per token; only used for the live estimate while a call streams.
const CHARS_PER_TOKEN = 4;
// A long call logs that it's still going this often, so the terminal doesn't look stuck.
const HEARTBEAT_MS = 20_000;
const count = (n: number) => n.toLocaleString("en-US");

/** One finished Claude call, for the per-call breakdown saved with a game. */
export interface CallUsage extends Omit<TokenUsage, "live"> {
  label: string;
  seconds: number;
  /** It threw (declined, cut off, network); its output is an estimate. */
  failed?: boolean;
}

/**
 * Adds up a game's tokens across its Claude calls, including calls still streaming. Those count their
 * input as soon as it's known and an estimate of their output so far, until the exact count arrives.
 */
export class TokenMeter {
  private done: TokenUsage = { input: 0, cached: 0, output: 0, live: 0 };
  private readonly streaming = new Map<number, TokenUsage>();
  private readonly finishedCalls: CallUsage[] = [];
  private nextCall = 0;

  /** `onChange` hears the new total after every update; `final` is when a call's exact count came in. */
  constructor(private readonly onChange: (total: TokenUsage, final: boolean) => void) {}

  /** Only the calls that have finished, with exact counts. */
  get finished(): TokenUsage {
    return this.done;
  }

  /** Every finished call, in the order they finished. */
  get calls(): readonly CallUsage[] {
    return this.finishedCalls;
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

  /** Starts counting one call. Report its running usage; `final` the last time (`failed` if it threw). */
  call(label: string) {
    const id = this.nextCall++;
    const started = Date.now();
    return (usage: Omit<TokenUsage, "live">, final = false, failed = false) => {
      if (final) {
        this.streaming.delete(id);
        const seconds = Math.round((Date.now() - started) / 100) / 10;
        this.finishedCalls.push({ label, ...usage, seconds, ...(failed && { failed }) });
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
  /** Called once the answer starts streaming, which is when the prompt cache it wrote can be read. */
  onStart?: () => void;
}

/** Sends one prompt and returns the text of Claude's answer. Throws if it was cut off or declined. */
export async function askClaude(prompt: string, { system, effort = "high", label, gameId, meter, onStart }: AskOptions): Promise<string> {
  const started = Date.now();
  const report = meter?.call(label);
  const live = { input: 0, cached: 0, output: 0 };
  let thinkingTokens = 0;
  let textChars = 0;
  log(gameId, `claude ${label}: started (effort ${effort}, ${BACKEND})`);
  const heartbeat = setInterval(() => {
    const phase = textChars > 0 ? "writing the answer" : "thinking";
    log(gameId, `claude ${label}: ${phase}, ${Math.round((Date.now() - started) / 1000)}s, ~${count(live.output)} tokens out so far`);
  }, HEARTBEAT_MS);

  // Both backends stream the same API events, so the meter counts as the answer comes in.
  const onEvent = (event: BetaRawMessageStreamEvent) => {
    if (event.type === "message_start") {
      const usage = event.message.usage;
      live.input = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0);
      live.cached = usage.cache_read_input_tokens ?? 0;
      onStart?.();
    } else if (event.type === "content_block_delta" && event.delta.type === "thinking_delta") {
      thinkingTokens += event.delta.estimated_tokens ?? 0;
    } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      textChars += event.delta.text.length;
    } else {
      return;
    }
    live.output = thinkingTokens + Math.round(textChars / CHARS_PER_TOKEN);
    report?.(live);
  };

  let answer: Answer;
  try {
    answer = BACKEND === "api" ? await viaApi(prompt, system, effort, onEvent) : await viaSubscription(prompt, system, effort, onEvent);
  } catch (error) {
    // The exact count never came; keep the estimate.
    report?.(live, true, true);
    log(gameId, `claude ${label}: failed after ${Math.round((Date.now() - started) / 1000)}s: ${error instanceof Error ? error.message : String(error)}`, "error");
    throw error;
  } finally {
    clearInterval(heartbeat);
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens } = answer.usage;
  report?.({ input: input_tokens + (cache_creation_input_tokens ?? 0), cached: cache_read_input_tokens ?? 0, output: output_tokens }, true);
  log(gameId, `claude ${label}: done in ${seconds}s, ${count(input_tokens)} in (${count(cache_read_input_tokens ?? 0)} cached), ${count(output_tokens)} out`);

  if (answer.stopReason === "refusal") throw new Error(`Claude declined ${label}${answer.refusal ? `: ${answer.refusal}` : ""}`);
  if (answer.stopReason === "max_tokens") throw new Error(`Claude ran out of tokens on ${label}`);
  return answer.text;
}

type Effort = NonNullable<AskOptions["effort"]>;

interface Answer {
  text: string;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
  stopReason: string | null;
  refusal?: string;
}

/** Through the Claude API, billed to ANTHROPIC_API_KEY. */
async function viaApi(prompt: string, system: string | undefined, effort: Effort, onEvent: (event: BetaRawMessageStreamEvent) => void): Promise<Answer> {
  // Streamed because a whole room with thinking can run long.
  const stream = claude().beta.messages.stream({
    model: MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
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
  stream.on("streamEvent", onEvent);
  const message = await stream.finalMessage();
  return {
    text: message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""),
    usage: message.usage,
    stopReason: message.stop_reason,
    refusal: message.stop_details?.explanation ?? undefined,
  };
}

// Without the API key in its environment, Claude Code falls back to this machine's login.
const { ANTHROPIC_API_KEY: _apiKey, ...subscriptionEnv } = process.env;

/** Through Claude Code's login on this machine, counted against your subscription's usage limits. */
async function viaSubscription(prompt: string, system: string | undefined, effort: Effort, onEvent: (event: BetaRawMessageStreamEvent) => void): Promise<Answer> {
  for await (const message of query({
    prompt,
    options: {
      model: MODEL,
      // A plain system prompt replaces Claude Code's own, which is about coding.
      systemPrompt: system ?? "You are the lead writer and level designer for a horror video game.",
      thinking: { type: "adaptive", display: "omitted" },
      effort,
      // Text in, text out: no tools, one turn, and nothing from this machine's settings or CLAUDE.md files.
      tools: [],
      maxTurns: 1,
      settingSources: [],
      persistSession: false,
      includePartialMessages: true,
      env: { ...subscriptionEnv, CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(MAX_OUTPUT_TOKENS) },
    },
  })) {
    if (message.type === "stream_event") onEvent(message.event);
    else if (message.type === "result") {
      if (message.subtype !== "success") throw new Error(`Claude Code stopped: ${message.subtype}`);
      return { text: message.result, usage: message.usage, stopReason: message.stop_reason };
    }
  }
  throw new Error("Claude Code ended without an answer");
}
