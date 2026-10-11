import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { artIdsForRoom, collectArt } from "../../src/shared/art";
import { errorsIn, formatIssues, type Issue } from "../../src/shared/issues";
import { parseGameSpec } from "../../src/shared/parseSpec";
import { isFields } from "../../src/shared/reader";
import { LIMITS, type GameSpec } from "../../src/shared/spec";
import { validateGame } from "../../src/shared/validate";
import { gameDir, isSafeId, saveGame } from "../games";
import { checkStoryboard, type Storyboard, type StoryboardRoom } from "./checkStoryboard";
import { askClaude } from "./claude";
import { repairSection, type RepairContext } from "./repair";
import { roomPrompt, roomSystemPrompt } from "./roomPrompt";
import { STORYBOARD_PROMPT } from "./storyboard";
import { extractTagged, extractTaggedJson } from "./tagged";

// The whole pipeline: a storyboard call, then one call per room in parallel, then validation with
// room-scoped repairs. Code assembles the GameSpec itself (title, map, room order) from the storyboard,
// so Claude never has to keep ids consistent across separate calls.

const MAX_REPAIRS = 2;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Generates a game and saves it as server/games/<gameId>/game.json. Throws if it can't be made valid. */
export async function generateGame(gameId: string): Promise<GameSpec> {
  const storyboard = await writeStoryboard(gameId);
  const system = roomSystemPrompt(storyboard);
  // A share of the warning level, not the hard limit, so a few rooms running over still fits.
  const artBudget = Math.floor(LIMITS.artJobsWarning / storyboard.rooms.length);
  const build = (room: StoryboardRoom, repair?: RepairContext) => buildRoom(gameId, system, storyboard, room, artBudget, repair);

  const rooms = new Map<string, unknown>();
  await Promise.all(storyboard.rooms.map(async (room) => rooms.set(room.id, await build(room))));

  for (let round = 0; ; round++) {
    const game = assemble(storyboard, rooms);
    await writeJson(gameId, "game.draft.json", game);
    const { spec, issues } = validateGame(game);
    const warnings = issues.filter((issue) => issue.severity === "warning");
    if (warnings.length) console.log(`[${gameId}] warnings:\n${formatIssues(warnings)}`);
    if (spec) {
      await saveGame(gameId, spec);
      console.log(`[${gameId}] saved "${spec.title}"`);
      return spec;
    }

    const problems = problemsByRoom(game, errorsIn(issues), artBudget);
    if (round === MAX_REPAIRS || problems.size === 0) {
      throw new Error(`Game ${gameId} still has problems after ${round} repair rounds:\n${formatIssues(errorsIn(issues))}`);
    }
    console.log(`[${gameId}] repair round ${round + 1}: ${[...problems.keys()].join(", ")}`);
    await Promise.all(
      [...problems].map(async ([id, list]) => {
        const room = storyboard.rooms.find((r) => r.id === id)!;
        rooms.set(id, await build(room, { previous: JSON.stringify(rooms.get(id), null, 2), problems: list }));
      }),
    );
  }
}

/** Asks for a storyboard until its map and keys check out, and saves it next to the game. */
async function writeStoryboard(gameId: string): Promise<Storyboard> {
  let repair: RepairContext | undefined;
  for (let attempt = 0; ; attempt++) {
    const prompt = STORYBOARD_PROMPT + (repair ? repairSection(repair, "storyboard", "fix the rooms, doors and keys so the map works, and keep the story") : "");
    const text = await askClaude(prompt, { label: `${gameId} storyboard`, effort: "high" });

    let json: unknown;
    let problems: string[];
    try {
      json = extractTaggedJson(text, "storyboard");
      const checked = checkStoryboard(json);
      if (checked.storyboard) {
        await writeJson(gameId, "storyboard.json", { research: extractTagged(text, "research"), storyboard: json });
        console.log(`[${gameId}] storyboard: "${checked.storyboard.title}", ${checked.storyboard.rooms.length} rooms`);
        return checked.storyboard;
      }
      problems = checked.problems;
    } catch (error) {
      problems = [message(error)];
    }
    if (attempt === MAX_REPAIRS) throw new Error(`The storyboard for ${gameId} still has problems:\n${problems.map((p) => `- ${p}`).join("\n")}`);
    console.log(`[${gameId}] storyboard needs fixing:\n${problems.map((p) => `- ${p}`).join("\n")}`);
    repair = { previous: json === undefined ? text : JSON.stringify(json, null, 2), problems };
  }
}

/** One room's JSON, as Claude wrote it, with the fields the map fixes forced to the storyboard's values. */
async function buildRoom(gameId: string, system: string, storyboard: Storyboard, room: StoryboardRoom, artBudget: number, repair?: RepairContext) {
  const howToFix = "move, resize, replace or remove things to fix each problem, and keep the room's story and look";
  for (let attempt = 0; ; attempt++) {
    const prompt = roomPrompt(storyboard, room, artBudget) + (repair ? repairSection(repair, "room", howToFix) : "");
    const text = await askClaude(prompt, { system, label: `${gameId} ${room.id}${repair ? " (repair)" : ""}`, effort: "high" });
    try {
      const json = extractTaggedJson(text, "room");
      if (isFields(json)) Object.assign(json, { id: room.id, grid: room.grid, outdoor: room.outdoor });
      return json;
    } catch (error) {
      // Unreadable JSON gets one more try, shown the broken answer; a second failure ends generation.
      if (attempt === 1) throw new Error(`Room ${room.id} of ${gameId}: ${message(error)}`);
      repair = { previous: text, problems: [message(error)] };
    }
  }
}

function assemble(storyboard: Storyboard, rooms: Map<string, unknown>) {
  return {
    version: 1,
    title: storyboard.title,
    summary: storyboard.summary,
    // The storyboard's first room is where the game starts, and the GameSpec's rooms[0] is too.
    rooms: storyboard.rooms.map((room) => rooms.get(room.id)),
    connections: storyboard.doors.map(({ id, rooms, locked }) => ({ id, rooms, locked })),
  };
}

/** Errors grouped by the room that should fix them. Errors no room owns are left for the caller to report. */
function problemsByRoom(game: unknown, errors: Issue[], artBudget: number): Map<string, string[]> {
  const byRoom = new Map<string, string[]>();
  const add = (room: string, problem: string) => byRoom.set(room, [...(byRoom.get(room) ?? []), problem]);
  for (const error of errors) if (error.room) add(error.room, error.message);

  // Too many images is a whole-game error; hand it to the rooms that use the most.
  const parsed = parseGameSpec(game);
  const rooms = parsed.rooms.map(({ room }) => room);
  const total = collectArt({ rooms, connections: parsed.connections }).size;
  if (total > LIMITS.artJobs) {
    for (const room of rooms) {
      const count = artIdsForRoom({ rooms, connections: parsed.connections }, room).length;
      if (count > artBudget) {
        add(room.id, `The game needs ${total} images; the limit is ${LIMITS.artJobs}. This room needs ${count}; bring it to about ${artBudget} by reusing one description for repeated things, using fewer materials and fewer animation frames.`);
      }
    }
  }
  return byRoom;
}

async function writeJson(gameId: string, file: string, value: unknown) {
  await mkdir(gameDir(gameId), { recursive: true });
  await writeFile(join(gameDir(gameId), file), JSON.stringify(value, null, 2));
}

// npx tsx --env-file=.env.local server/generation/generate.ts <game-id>
// (Skipped when imported by the server.)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const gameId = process.argv[2];
  if (!gameId || !isSafeId(gameId)) {
    console.error("Usage: npx tsx --env-file=.env.local server/generation/generate.ts <game-id>");
    process.exit(1);
  }
  try {
    await generateGame(gameId);
  } catch (error) {
    console.error(message(error));
    process.exit(1);
  }
}
