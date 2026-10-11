import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { collectScreams, type ScreamJob } from "../src/shared/screams";
import type { GameSpec } from "../src/shared/spec";
import { syncGame } from "./bucket";
import { gameDir } from "./games";
import { log } from "./log";
import { getSecret } from "./secrets";

// Generates each hostile character's scream with ElevenLabs' sound effects, alongside the painting, and
// saves it as assets/<id>.mp3 beside the images. A game has only a few, so they're made right away; one
// that fails isn't retried, and the client falls back to a recorded voice for it.
const ENDPOINT = "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128";
const SECONDS = 2.5;
const MAX_CONCURRENT = 2;
// Added to every description, so they all land as jumpscares.
const STYLE = "A sudden, loud horror video game jumpscare scream, right in the listener's face, cavernous reverb. No music.";

const assetsDir = (gameId: string) => join(gameDir(gameId), "assets");

export interface ScreamStatus {
  total: number;
  ready: string[];
  failed: string[];
}

interface Voicing {
  ready: Set<string>;
  failed: Set<string>;
  scanned: Promise<void>;
}

// Keyed by the GameSpec object, like the painting, so an edited game starts afresh.
const voicings = new WeakMap<GameSpec, Voicing>();
const plans = new WeakMap<GameSpec, Map<string, ScreamJob>>();
function planOf(game: GameSpec) {
  let plan = plans.get(game);
  if (!plan) plans.set(game, (plan = collectScreams(game)));
  return plan;
}

/** The finished MP3 for a scream id, or undefined if it isn't made (or the game has no such scream). */
export async function getScream(gameId: string, game: GameSpec, id: string): Promise<Buffer | undefined> {
  if (!planOf(game).has(id)) return undefined;
  return readFile(join(assetsDir(gameId), `${id}.mp3`)).catch(() => undefined);
}

/** Where a game's screams stand. `start` makes the missing ones if that hasn't been started since the server started. */
export async function screamStatus(gameId: string, game: GameSpec, { start }: { start: boolean }): Promise<ScreamStatus> {
  let voicing = voicings.get(game);
  if (!voicing && start) voicing = startVoicing(gameId, game);
  const total = planOf(game).size;
  if (!voicing) return { total, ready: await madeIds(gameId, game), failed: [] };
  await voicing.scanned;
  return { total, ready: [...voicing.ready], failed: [...voicing.failed] };
}

function startVoicing(gameId: string, game: GameSpec): Voicing {
  const voicing: Voicing = { ready: new Set(), failed: new Set(), scanned: Promise.resolve() };
  voicings.set(game, voicing);
  let todo: ScreamJob[] = [];
  voicing.scanned = madeIds(gameId, game).then((ids) => {
    for (const id of ids) voicing.ready.add(id);
    todo = [...planOf(game).values()].filter((job) => !voicing.ready.has(job.id));
  });

  void (async () => {
    await voicing.scanned;
    if (!todo.length) return;
    log(gameId, `voicing ${todo.length} scream${todo.length === 1 ? "" : "s"}`);
    const queue = [...todo];
    const worker = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const started = Date.now();
        try {
          await make(gameId, job);
          voicing.ready.add(job.id);
          log(gameId, `voiced ${job.id} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
        } catch (error) {
          voicing.failed.add(job.id);
          log(gameId, `couldn't voice ${job.id}, it'll use the recorded ${job.voice} scream: ${error instanceof Error ? error.message : String(error)}`, "warn");
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, todo.length) }, worker));
  })();
  return voicing;
}

async function make(gameId: string, job: ScreamJob) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": await getSecret("ELEVENLABS_API_KEY", "elevenlabs-key") },
    body: JSON.stringify({ text: `${job.prompt}. ${STYLE}`, duration_seconds: SECONDS, prompt_influence: 0.6 }),
  });
  if (!response.ok) throw new Error(`ElevenLabs returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
  await mkdir(assetsDir(gameId), { recursive: true });
  await writeFile(join(assetsDir(gameId), `${job.id}.mp3`), Buffer.from(await response.arrayBuffer()));
  syncGame(gameId);
}

async function madeIds(gameId: string, game: GameSpec): Promise<string[]> {
  const files = new Set(await readdir(assetsDir(gameId)).catch(() => [] as string[]));
  return [...planOf(game).keys()].filter((id) => files.has(`${id}.mp3`));
}
