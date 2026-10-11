import { createHash, timingSafeEqual } from "node:crypto";
import { getSecret, onCloudRun } from "./secrets";

// Making a game spends real money (Claude, Gemini and ElevenLabs), so it takes a passcode. It's
// GAME_PASSCODE in .env.local, or the game-passcode secret on Cloud Run. Locally, with none set, anyone
// can make games; on Cloud Run, with no secret, nobody can.

// Wrong guesses allowed from one address, and from everyone together, in each window.
const MAX_WRONG_PER_ADDRESS = 5;
const MAX_WRONG_TOTAL = 30;
const WINDOW_MS = 10 * 60 * 1000;

export type PasscodeCheck = "ok" | "wrong" | "locked" | "off";

const wrong = new Map<string, number[]>();

const hash = (text: string) => createHash("sha256").update(text).digest();

/** Whether `given` is the passcode. `from` identifies the guesser (their address), for the limit on wrong guesses. */
export async function checkPasscode(given: unknown, from: string): Promise<PasscodeCheck> {
  let passcode: string;
  try {
    passcode = await getSecret("GAME_PASSCODE", "game-passcode");
  } catch {
    return onCloudRun ? "off" : "ok";
  }

  const now = Date.now();
  const recent = (key: string) => (wrong.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent(from).length >= MAX_WRONG_PER_ADDRESS || recent("*").length >= MAX_WRONG_TOTAL) return "locked";

  // Compared as hashes, so the comparison takes the same time whatever was typed.
  if (typeof given === "string" && timingSafeEqual(hash(given.trim()), hash(passcode))) return "ok";
  for (const key of [from, "*"]) wrong.set(key, [...recent(key), now]);
  return "wrong";
}
