import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GameSummary } from "../src/shared/api";
import { errorsIn, formatIssues } from "../src/shared/issues";
import type { GameSpec } from "../src/shared/spec";
import { validateGame } from "../src/shared/validate";

// A game is a fixture (fixtures/games/<id>.json, read fresh on every request so edits show up on reload)
// or a generated game saved as server/games/<id>/game.json. Either way its art lives in
// server/games/<id>/assets/.
const GAMES_DIR = join(import.meta.dirname, "games");
const FIXTURES_DIR = join(import.meta.dirname, "..", "fixtures", "games");
export const gameDir = (gameId: string) => join(GAMES_DIR, gameId);

/** Ids become directory and file names: letters, digits, _ . - only, and no leading dot. */
export const isSafeId = (id: string) => /^(?!\.)[\w.-]+$/.test(id);

/** A game file that exists but doesn't validate; the message lists what's wrong. */
export class InvalidGameError extends Error {}

// Validating walks every room's floor, so a game is only revalidated when its file changes. Keeping the
// same GameSpec object also lets assets.ts cache its art plan.
const validated = new Map<string, { text: string; spec: GameSpec }>();

/** The validated game, or undefined if there's no such game. Throws InvalidGameError if it doesn't validate. */
export async function getGame(gameId: string): Promise<GameSpec | undefined> {
  const text = (await readIfExists(join(FIXTURES_DIR, `${gameId}.json`))) ?? (await readIfExists(join(gameDir(gameId), "game.json")));
  if (text === undefined) return undefined;
  const cached = validated.get(gameId);
  if (cached?.text === text) return cached.spec;

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new InvalidGameError(`Game ${gameId} isn't valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const { spec, issues } = validateGame(json);
  if (!spec) throw new InvalidGameError(`Game ${gameId} has problems:\n${formatIssues(errorsIn(issues))}`);
  validated.set(gameId, { text, spec });
  return spec;
}

/** What the game list says about a game, before how far along its art is (jobs.ts adds that). */
export type GameInfo = Pick<GameSummary, "id" | "title" | "summary" | "rooms">;

/** Ids of the folders in server/games/: generated games, finished or not, and fixtures' art. */
export async function generatedIds(): Promise<string[]> {
  return (await readdir(GAMES_DIR).catch(() => [] as string[])).filter(isSafeId).sort();
}

/** Every game that validates: fixtures first, then generated ones. Ones that don't validate are left out. */
export async function listGames(): Promise<GameInfo[]> {
  const fixtures = (await readdir(FIXTURES_DIR).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5));
  const ids = [...new Set([...fixtures.sort(), ...(await generatedIds())])].filter(isSafeId);
  const games = await Promise.all(
    ids.map(async (id) => {
      try {
        const spec = await getGame(id);
        return spec && { id, title: spec.title, summary: spec.summary, rooms: spec.rooms.length };
      } catch (error) {
        console.warn(`Leaving ${id} out of the game list: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
        return undefined;
      }
    }),
  );
  return games.filter((g): g is GameInfo => g !== undefined);
}

/** Saves a generated game, already validated, as server/games/<id>/game.json. */
export async function saveGame(gameId: string, spec: GameSpec) {
  await mkdir(gameDir(gameId), { recursive: true });
  await writeFile(join(gameDir(gameId), "game.json"), JSON.stringify(spec, null, 2));
}

export async function readIfExists(file: string) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return undefined;
    throw error;
  }
}
