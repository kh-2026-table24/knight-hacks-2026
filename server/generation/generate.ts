import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { artIdsForRoom, collectArt } from "../../src/shared/art";
import { doorSides, objectivesSetIn } from "../../src/shared/checkGame";
import { GENERATED_ROOM } from "../../src/shared/constants";
import { errorsIn, formatIssues, type Issue } from "../../src/shared/issues";
import { parseGameSpec } from "../../src/shared/parseSpec";
import { isFields } from "../../src/shared/reader";
import { LIMITS, type GameSpec } from "../../src/shared/spec";
import { validateGame } from "../../src/shared/validate";
import { gameDir, isSafeId, readIfExists, saveGame } from "../games";
import { checkStoryboard, type Storyboard, type StoryboardRoom } from "./checkStoryboard";
import { log } from "../log";
import { autofixRoom } from "./autofix";
import { askClaude, TokenMeter } from "./claude";
import { applyPatch, patchSection, repairSection, type RepairContext } from "./repair";
import { roomPrompt, roomSystemPrompt } from "./roomPrompt";
import { randomStory, storyboardPrompt } from "./storyboard";
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

/**
 * Generates a game and saves it as server/games/<gameId>/game.json. Throws if it can't be made valid.
 * A game that failed in repairs picks up from its saved storyboard and draft instead of starting over.
 */
export async function generateGame(gameId: string, hooks: GenerateHooks = {}): Promise<GameSpec> {
  const draft = await savedDraft(gameId);
  if (draft) log(gameId, `picking up from the saved storyboard and ${draft.rooms.size} rooms`);
  const storyboard = draft?.storyboard ?? (await writeStoryboard(gameId, hooks.meter));
  hooks.onStoryboard?.(storyboard);
  const system = roomSystemPrompt(storyboard);
  // Each room's share of what generation aims for (the warning level), well under the hard limit.
  const artBudget = Math.floor(LIMITS.artJobsWarning / storyboard.rooms.length);
  const ask = { gameId, system, storyboard, artBudget, meter: hooks.meter };

  const rooms = draft?.rooms ?? new Map<string, unknown>();
  if (!draft) {
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
  }

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
    const wishes = wishesByRoom(game, storyboard, artBudget, issues);
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

/** The storyboard and rooms a failed run left on disk (storyboard.json and game.draft.json), if both are there and still fit together. */
async function savedDraft(gameId: string): Promise<{ storyboard: Storyboard; rooms: Map<string, unknown> } | undefined> {
  const [storyboardText, draftText] = await Promise.all(["storyboard.json", "game.draft.json"].map((file) => readIfExists(join(gameDir(gameId), file))));
  if (storyboardText === undefined || draftText === undefined) return undefined;
  const { storyboard } = checkStoryboard((JSON.parse(storyboardText) as { storyboard?: unknown }).storyboard);
  // The draft lists its rooms in the storyboard's order (see assemble).
  const draftRooms = (JSON.parse(draftText) as { rooms?: unknown[] }).rooms;
  if (!storyboard || draftRooms?.length !== storyboard.rooms.length) return undefined;
  return { storyboard, rooms: new Map(storyboard.rooms.map((room, i) => [room.id, draftRooms[i]])) };
}

/** Asks for a storyboard until its map and keys check out, and saves it next to the game. */
async function writeStoryboard(gameId: string, meter: TokenMeter | undefined): Promise<Storyboard> {
  // Picked once, so a storyboard sent back for fixes keeps its story.
  const story = randomStory();
  log(gameId, `story: ${story}`);
  let repair: RepairContext | undefined;
  for (let attempt = 0; ; attempt++) {
    const prompt = storyboardPrompt(story) + (repair ? repairSection(repair, "storyboard", "fix the rooms, doors, keys, objectives and intro so the map works, and keep the story") : "");
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
    objectives: storyboard.objectives.map(({ id, text }) => ({ id, text })),
    intro: storyboard.intro,
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

/**
 * Rooms that are valid but fall short of what generation asks for: 1 to 5 things to interact with, a
 * compact size, characters whose conversations lead somewhere, the storyboard's objectives, the room's
 * share of the image budget, and the warnings marked for repair (stairs that can't be climbed).
 */
function wishesByRoom(game: unknown, storyboard: Storyboard, artBudget: number, issues: Issue[]): Map<string, string[]> {
  const wishes = new Map<string, string[]>();
  const add = (room: string, wish: string) => wishes.set(room, [...(wishes.get(room) ?? []), wish]);
  for (const issue of issues) if (issue.repair && issue.room) add(issue.room, issue.message);
  const parsed = parseGameSpec(game);
  const rooms = parsed.rooms.map(({ room }) => room);
  const totalArt = collectArt({ rooms, connections: parsed.connections }).size;
  for (const room of rooms) {
    const examinable = room.props.filter((prop) => prop.examine || prop.contains).length;
    const talkers = room.characters.filter((character) => character.dialogue).length;
    if (examinable + talkers === 0) {
      add(room.id, `${room.id} has nothing to interact with. Give 1 to 3 of its story objects "examine" lines.`);
    }

    const [w, h, d] = room.size;
    if (Math.max(w, d) > GENERATED_ROOM.maxSide || h > GENERATED_ROOM.maxHeight) {
      add(room.id, `${room.id} is ${w} x ${h} x ${d} m; keep rooms to at most ${GENERATED_ROOM.maxSide} m wide and deep and ${GENERATED_ROOM.maxHeight} m tall. Shrink it and move everything in to fit.`);
    }

    room.characters.forEach((character, i) => {
      if (character.dialogue && !character.gives && !character.objective) {
        add(room.id, `characters[${i}](${character.id})'s conversation leads nowhere. End it with an outcome: "gives" a key or sets an "objective" (one of this room's, from the prompt).`);
      }
    });

    const set = new Set(objectivesSetIn(room).map(({ objective }) => objective));
    for (const objective of storyboard.objectives.filter((o) => o.room === room.id && !set.has(o.id))) {
      add(room.id, `Nothing sets the objective "${objective.id}". Put "objective": "${objective.id}" on ${objective.trigger ?? "the story object or character that leads to it"}.`);
    }

    const art = artIdsForRoom({ rooms, connections: parsed.connections }, room).length;
    if (totalArt > LIMITS.artJobsWarning && art > artBudget) {
      add(room.id, `The game needs ${totalArt} images; it should need at most ${LIMITS.artJobsWarning}. This room needs ${art}; bring it to about ${artBudget} by building blocky things from color-only parts, reusing one material with different "color"s, reusing one sprite description (with "tint" for color variants), and animating only things that move.`);
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
