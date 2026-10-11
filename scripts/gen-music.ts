// Generates a looping music bed with ElevenLabs and saves it under public/audio/, where the client loads
// it. Needs ELEVENLABS_API_KEY in .env.local. Each run is a new (billed) generation, so commit the result.
//
//   npm run music -- menu-theme
//
// Uses the sound-effects endpoint with loop on, which is available on the free plan and loops seamlessly
// (up to 30 s). ElevenLabs' music endpoint (/v1/music) makes longer, more musical tracks but needs a paid plan.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TRACKS: Record<string, { prompt: string; seconds: number }> = {
  "menu-theme": {
    prompt: [
      "Eerie dark ambient music loop for a 1999 PlayStation survival horror title menu:",
      "a slow, slightly detuned music box melody over a deep unresolved drone, distant low piano notes,",
      "tape hiss and wobble, a faint metallic scrape. Quiet, sparse and unsettling. No drums, no voices.",
    ].join(" "),
    seconds: 30,
  },
};

const [name = "menu-theme"] = process.argv.slice(2);
const track = TRACKS[name];
if (!track) {
  console.error(`Unknown track "${name}". Tracks: ${Object.keys(TRACKS).join(", ")}`);
  process.exit(1);
}
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("ELEVENLABS_API_KEY is not set; add it to .env.local");
  process.exit(1);
}

console.log(`Generating "${name}" (${track.seconds}s loop)...`);
const response = await fetch("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128", {
  method: "POST",
  headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
  body: JSON.stringify({ text: track.prompt, duration_seconds: track.seconds, loop: true, prompt_influence: 0.5 }),
});
if (!response.ok) {
  console.error(`ElevenLabs returned ${response.status}: ${await response.text()}`);
  process.exit(1);
}

const dir = join(import.meta.dirname, "..", "public", "audio");
await mkdir(dir, { recursive: true });
const audio = Buffer.from(await response.arrayBuffer());
await writeFile(join(dir, `${name}.mp3`), audio);
console.log(`Saved public/audio/${name}.mp3 (${Math.round(audio.length / 1024)} KB)`);
