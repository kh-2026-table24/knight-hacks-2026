// Generates the house's random distant noises with ElevenLabs and saves them as
// public/audio/noises/<name>.mp3; GameAudio plays one every so often (NOISES in src/game/audio/noises.ts).
// Needs ELEVENLABS_API_KEY in .env.local. Each run is billed, so commit the results.
//
//   npm run noises                 every noise
//   npm run noises -- owl bell     just these
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NOISES, type NoiseName } from "../src/game/audio/noises";

const PROMPTS: Record<NoiseName, string> = {
  whisper: "Several voices whispering, unintelligible, in a dark empty room. Close, then fading away. Eerie. No music.",
  knock: "Three slow, heavy knocks on a wooden door somewhere down a hallway, reverberant, then silence.",
  scratching: "Fingernails scratching slowly along the inside of a wooden wall, close and creepy.",
  "music-box": "A few slow, detuned notes of a broken music box winding down in an empty room, with reverb.",
  "footsteps-above": "Slow, heavy footsteps crossing old wooden floorboards upstairs, muffled through the ceiling.",
  "child-laugh": "A distant child's giggle echoing down an empty hallway, eerie and reverberant.",
  chains: "Heavy chains dragging and rattling across a stone floor in another room, reverberant.",
  moan: "A low, mournful moan echoing through an old empty house, ghostly and distant.",
  crow: "A crow cawing twice in the distance on a cold grey evening.",
  owl: "An owl hooting in dark woods at night, distant.",
  howl: "A lone dog howling far away in the night, echoing over empty fields.",
  bell: "A single distant church bell tolling once and fading out in cold night air.",
};

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("ELEVENLABS_API_KEY is not set; add it to .env.local");
  process.exit(1);
}
const all = Object.keys(NOISES) as NoiseName[];
const names = process.argv.slice(2);
const unknown = names.filter((name) => !(all as string[]).includes(name));
if (unknown.length) {
  console.error(`Unknown: ${unknown.join(", ")}. Noises: ${all.join(", ")}`);
  process.exit(1);
}

const dir = join(import.meta.dirname, "..", "public", "audio", "noises");
await mkdir(dir, { recursive: true });
let failed = false;
for (const name of (names.length ? names : all) as NoiseName[]) {
  const started = Date.now();
  const response = await fetch("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128", {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
    body: JSON.stringify({ text: PROMPTS[name], duration_seconds: NOISES[name].seconds, prompt_influence: 0.5 }),
  });
  if (!response.ok) {
    console.error(`✗ ${name}: ElevenLabs returned ${response.status}: ${await response.text()}`);
    failed = true;
    continue;
  }
  const audio = Buffer.from(await response.arrayBuffer());
  await writeFile(join(dir, `${name}.mp3`), audio);
  console.log(`✓ public/audio/noises/${name}.mp3 (${Math.round(audio.length / 1024)} KB, ${((Date.now() - started) / 1000).toFixed(1)}s)`);
}
if (failed) process.exitCode = 1;
