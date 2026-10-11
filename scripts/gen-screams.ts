// Generates the jumpscare screams with ElevenLabs and saves them as public/audio/screams/<voice>.mp3. A
// hostile character's `scream` (src/shared/spec.ts) picks which one plays when it catches the player.
// Needs ELEVENLABS_API_KEY in .env.local. Each run is a new (billed) generation, so commit the results.
//
//   npm run screams                 every voice
//   npm run screams -- woman sting  just these
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SCREAMS, type Scream } from "../src/shared/spec";

const SECONDS = 2.5;
const PROMPTS: Record<Scream | "sting", string> = {
  woman: "A ghostly woman's shrill, piercing banshee scream rising into a distorted wail, close to the ear, cavernous reverb. Horror jumpscare.",
  man: "A man's hoarse, agonized, furious scream, raw and right in your face, cold stone room reverb. Horror jumpscare.",
  child: "A ghost child's high, unnatural shriek that warps and echoes, close and sudden. Horror jumpscare.",
  creature: "An inhuman demonic screech, several voices layered and distorted, lunging close. Horror monster jumpscare.",
  beast: "A huge animal's vicious roaring snarl as it lunges at you, teeth snapping, close. Horror jumpscare.",
  vermin: "A giant rat's loud shrill squealing screech and hiss, right in your face, claws scrabbling. Horror jumpscare.",
  drowned: "A drowned spirit's gurgling waterlogged scream, choking through water, splashing and bubbling, close. Horror jumpscare.",
  sting: "A sudden loud horror jumpscare stinger: a dissonant screeching orchestral string stab over a deep distorted impact boom.",
};

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("ELEVENLABS_API_KEY is not set; add it to .env.local");
  process.exit(1);
}
const all = [...SCREAMS, "sting"] as const;
const names = process.argv.slice(2);
const unknown = names.filter((name) => !(all as readonly string[]).includes(name));
if (unknown.length) {
  console.error(`Unknown: ${unknown.join(", ")}. Voices: ${all.join(", ")}`);
  process.exit(1);
}

const dir = join(import.meta.dirname, "..", "public", "audio", "screams");
await mkdir(dir, { recursive: true });
let failed = false;
for (const name of (names.length ? names : all) as (typeof all)[number][]) {
  const response = await fetch("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128", {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
    body: JSON.stringify({ text: PROMPTS[name], duration_seconds: SECONDS, prompt_influence: 0.6 }),
  });
  if (!response.ok) {
    console.error(`✗ ${name}: ElevenLabs returned ${response.status}: ${await response.text()}`);
    failed = true;
    continue;
  }
  const audio = Buffer.from(await response.arrayBuffer());
  await writeFile(join(dir, `${name}.mp3`), audio);
  console.log(`✓ public/audio/screams/${name}.mp3 (${Math.round(audio.length / 1024)} KB)`);
}
if (failed) process.exitCode = 1;
