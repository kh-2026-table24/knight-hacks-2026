import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { artIdsForRoom, collectArt } from "../../src/shared/art";
import { doorSides } from "../../src/shared/checkGame";
import { errorsIn, formatIssues, type Issue } from "../../src/shared/issues";
import { parseGameSpec } from "../../src/shared/parseSpec";
import { isFields } from "../../src/shared/reader";
import { LIMITS, type GameSpec } from "../../src/shared/spec";
import { validateGame } from "../../src/shared/validate";
import { gameDir, isSafeId, saveGame } from "../games";
import { checkStoryboard, type Storyboard, type StoryboardRoom } from "./checkStoryboard";
import { log } from "../log";
import { autofixRoom } from "./autofix";
import { askClaude, TokenMeter } from "./claude";
import { applyPatch, patchSection, repairSection, type RepairContext } from "./repair";
import { roomPrompt, roomSystemPrompt } from "./roomPrompt";
import { STORYBOARD_PROMPT } from "./storyboard";
import { extractTagged, extractTaggedJson } from "./tagged";

// The whole pipeline: a storyboard call, then one call per room in parallel, then validation with
// room-scoped repairs. Code assembles the GameSpec itself (title, map, room order) from the storyboard,
// so Claude never has to keep ids consistent across separate calls. Before every check, code fixes what
// it can (autofix.ts); Claude repairs the rest with patches, not whole new rooms.

const MAX_REPAIRS = 2;
// The storyboard decides the story and the quality of the whole game, so it gets the most thought.
// Rooms work from it, and repairs use the rooms' effort too, so they can read the rooms' cached prompt.
const STORYBOARD_EFFORT = "high";
const ROOM_EFFORT = "medium";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Told how generation is going, so the server can show it while the player waits. */
export interface GenerateHooks {
  onStoryboard?(storyboard: Storyboard): void;
  onRoomBuilt?(built: number, total: number): void;
  /** Counts the tokens every Claude call spends. */
  meter?: TokenMeter;
}

/** Generates a game and saves it as server/games/<gameId>/game.json. Throws if it can't be made valid. */
export async function generateGame(gameId: string, hooks: GenerateHooks = {}): Promise<GameSpec> {
  const storyboard = await writeStoryboard(gameId, hooks.meter);
  hooks.onStoryboard?.(storyboard);
  const system = roomSystemPrompt(storyboard);
  // A share of the warning level, not the hard limit, so a few rooms running over still fits.
  const artBudget = Math.floor(LIMITS.artJobsWarning / storyboard.rooms.length);
  const ask = { gameId, system, storyboard, artBudget, meter: hooks.meter };

  const rooms = new Map<string, unknown>();
  const build = async (room: StoryboardRoom, onStart?: () => void) => {
    rooms.set(room.id, await buildRoom(ask, room, onStart));
    hooks.onRoomBuilt?.(rooms.size, storyboard.rooms.length);
  };
  // Parallel calls can't read a prompt cache another call is still writing, so the first room goes
  // alone until its answer starts; the others then read the shared system prompt from the cache.
  const [first, ...rest] = storyboard.rooms;
  let started = () => {};
  const firstStarted = new Promise<void>((resolve) => (started = resolve));
  const firstBuilt = build(first, started);
  await Promise.race([firstStarted, firstBuilt]);
  await Promise.all([firstBuilt, ...rest.map((room) => build(room))]);

  const doorArt = new Map(storyboard.doors.flatMap((door) => (door.description ? [[door.id, door.description] as const] : [])));
  for (let round = 0; ; round++) {
    autofix(gameId, storyboard, rooms, doorArt);
    const game = assemble(storyboard, rooms);
    await writeJson(gameId, "game.draft.json", game);
    const { spec, issues } = validateGame(game);
    const warnings = issues.filter((issue) => issue.severity === "warning");
    if (warnings.length) log(gameId, `${warnings.length} warning${warnings.length === 1 ? "" : "s"}:\n${formatIssues(warnings)}`, "warn");
    const problems = problemsByRoom(game, errorsIn(issues), artBudget);
    // Asked for while there are repair rounds left, but not worth failing a playable game over.
    const wishes = wishesByRoom(game);
    if (spec && (wishes.size === 0 || round === MAX_REPAIRS)) {
      await saveGame(gameId, spec);
      log(gameId, `saved "${spec.title}"`);
      return spec;
    }

    for (const [id, list] of wishes) problems.set(id, [...(problems.get(id) ?? []), ...list]);
    if (round === MAX_REPAIRS || problems.size === 0) {
      throw new Error(`Game ${gameId} still has problems after ${round} repair rounds:\n${formatIssues(errorsIn(issues))}`);
    }
    log(gameId, `repair round ${round + 1} for ${[...problems.keys()].join(", ")}:\n${[...problems.values()].flat().map((p) => `- ${p}`).join("\n")}`, "warn");
    await Promise.all(
      [...problems].map(async ([id, list]) => {
        const room = storyboard.rooms.find((r) => r.id === id)!;
        rooms.set(id, await repairRoom(ask, room, rooms.get(id), list));
      }),
    );
  }
}

/** Asks for a storyboard until its map and keys check out, and saves it next to the game. */
async function writeStoryboard(gameId: string, meter: TokenMeter | undefined): Promise<Storyboard> {
  let repair: RepairContext | undefined;
  for (let attempt = 0; ; attempt++) {
    const prompt = STORYBOARD_PROMPT + (repair ? repairSection(repair, "storyboard", "fix the rooms, doors and keys so the map works, and keep the story") : "");
    const text = await askClaude(prompt, { label: `storyboard${attempt ? ` (fix ${attempt})` : ""}`, gameId, effort: STORYBOARD_EFFORT, meter });

    let json: unknown;
    let problems: string[];
    try {
      json = extractTaggedJson(text, "storyboard");
      const checked = checkStoryboard(json);
      if (checked.storyboard) {
        await writeJson(gameId, "storyboard.json", { research: extractTagged(text, "research"), storyboard: json });
        const { title, rooms, doors } = checked.storyboard;
        log(gameId, `storyboard: "${title}", ${rooms.length} rooms (${rooms.map((r) => r.id).join(", ")}), ${doors.filter((d) => d.locked).length} locked doors`);
        return checked.storyboard;
      }
      problems = checked.problems;
    } catch (error) {
      problems = [message(error)];
    }
    if (attempt === MAX_REPAIRS) throw new Error(`The storyboard for ${gameId} still has problems:\n${problems.map((p) => `- ${p}`).join("\n")}`);
    log(gameId, `storyboard needs fixing:\n${problems.map((p) => `- ${p}`).join("\n")}`, "warn");
    repair = { previous: json === undefined ? text : JSON.stringify(json, null, 2), problems };
  }
}

/** What every room call shares. */
interface RoomAsk {
  gameId: string;
  system: string;
  storyboard: Storyboard;
  artBudget: number;
  meter: TokenMeter | undefined;
}

/** The fields the map fixes, forced onto whatever Claude wrote. */
function pinMapFields(json: unknown, room: StoryboardRoom) {
  if (isFields(json)) Object.assign(json, { id: room.id, grid: room.grid, outdoor: room.outdoor });
  return json;
}

/** One room's JSON, as Claude wrote it. */
async function buildRoom({ gameId, system, storyboard, artBudget, meter }: RoomAsk, room: StoryboardRoom, onStart?: () => void) {
  let repair: RepairContext | undefined;
  for (let attempt = 0; ; attempt++) {
    const prompt = roomPrompt(storyboard, room, artBudget) + (repair ? repairSection(repair, "room", "write the room again as valid JSON") : "");
    const text = await askClaude(prompt, { system, label: `room ${room.id}${repair ? " (unreadable, again)" : ""}`, gameId, effort: ROOM_EFFORT, meter, onStart });
    try {
      return pinMapFields(extractTaggedJson(text, "room"), room);
    } catch (error) {
      // Unreadable JSON gets one more try, shown the broken answer; a second failure ends generation.
      if (attempt === 1) throw new Error(`Room ${room.id} of ${gameId}: ${message(error)}`);
      repair = { previous: text, problems: [message(error)] };
    }
  }
}

/** The room with Claude's patch for `problems` applied. An unreadable patch leaves it as it was, for the next round. */
async function repairRoom({ gameId, system, storyboard, artBudget, meter }: RoomAsk, room: StoryboardRoom, current: unknown, problems: string[]) {
  const prompt = roomPrompt(storyboard, room, artBudget) + patchSection({ previous: JSON.stringify(current), problems });
  const text = await askClaude(prompt, { system, label: `room ${room.id} (repair)`, gameId, effort: ROOM_EFFORT, meter });
  try {
    return pinMapFields(applyPatch(current, extractTaggedJson(text, "patch")), room);
  } catch (error) {
    log(gameId, `couldn't apply the repair patch for ${room.id}: ${message(error)}`, "warn");
    return current;
  }
}

/** Fixes in code what it can in every room that parses, logging each change. Fixed rooms are stored parsed. */
function autofix(gameId: string, storyboard: Storyboard, rooms: Map<string, unknown>, doorArt: Map<string, string>) {
  const parsed = parseGameSpec(assemble(storyboard, rooms));
  const sides = doorSides(
    parsed.rooms.map(({ room }) => room),
    parsed.connections,
  );
  for (const { room } of parsed.rooms) {
    const fixes = autofixRoom(room, sides.get(room.id) ?? new Map(), doorArt);
    if (fixes.length === 0) continue;
    rooms.set(room.id, room);
    log(gameId, `fixed ${room.id} in code:\n${fixes.map((fix) => `- ${fix}`).join("\n")}`);
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
        add(room.id, `The game needs ${total} images; the limit is ${LIMITS.artJobs}. This room needs ${count}; bring it to about ${artBudget} by reusing one description for repeated things (with "tint" for color variants), using fewer materials, and animating only things that move.`);
      }
    }
  }
  return byRoom;
}

/** Rooms that are valid but fall short of what generation asks for: something to examine in every room. */
function wishesByRoom(game: unknown): Map<string, string[]> {
  const wishes = new Map<string, string[]>();
  for (const { room } of parseGameSpec(game).rooms) {
    if (!room.props.some((prop) => prop.examine || prop.contains)) {
      wishes.set(room.id, [`${room.id} has nothing to examine or search. Give 1 to 4 of its story objects "examine" lines (characters don't count).`]);
    }
  }
  return wishes;
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
  const meter = new TokenMeter(() => {});
  try {
    await generateGame(gameId, { meter });
  } catch (error) {
    console.error(message(error));
    process.exitCode = 1;
  } finally {
    await writeJson(gameId, "usage.json", { ...meter.finished, calls: meter.calls });
  }
}
