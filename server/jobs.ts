import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { progressOf, type GameStage, type GameStatus, type GameSummary, type TokenUsage } from "../src/shared/api";
import type { GameSpec } from "../src/shared/spec";
import { paintStatus, type PaintStatus } from "./assets";
import { syncGame } from "./bucket";
import { screamStatus } from "./screams";
import { gameDir, generatedIds, getGame, listGames, readIfExists } from "./games";
import { log, recentLog } from "./log";
import { TokenMeter } from "./generation/claude";
import { generateGame } from "./generation/generate";

// What each game is doing: being written, being painted, or finished. Once started, a game keeps going
// until it's done whether or not anyone is waiting on it (leaving a game doesn't stop it), and everything
// it makes is saved in server/games/<id>/, so a finished game opens straight away.

/** A game still being written, before its game.json exists. */
interface Making {
  stage: "story" | "rooms" | "failed";
  title?: string;
  summary?: string;
  roomsBuilt?: number;
  roomsTotal?: number;
  error?: string;
}

// Saved as status.json while a game is being written, so the game list can show it, and so a game cut
// short by a server restart shows as failed instead of loading forever.
const STATUS_FILE = "status.json";
// Log lines sent with each status, for the loading screen.
const LOG_LINES = 8;
const making = new Map<string, Making>();
// Claude tokens each game cost, kept as usage.json beside it so the count outlives the server, with a
// line per call (storyboard, each room, each repair) showing where they went.
const USAGE_FILE = "usage.json";
const usage = new Map<string, TokenUsage>();

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Starts making a new game and returns its id straight away. */
export function createGame(): string {
  const id = `game-${Date.now().toString(36)}-${randomBytes(2).toString("hex")}`;
  void make(id);
  return id;
}

/** The whole flow: storyboard, rooms, then every image, in the order the player will reach them, and the screams alongside. */
async function make(gameId: string) {
  let saving = Promise.resolve();
  const update = (change: Making | Partial<Making>) => {
    const state = { ...making.get(gameId), ...change } as Making;
    making.set(gameId, state);
    // Chained, so a slow write can't land after a later one.
    saving = saving
      .then(() => mkdir(gameDir(gameId), { recursive: true }))
      .then(() => writeFile(join(gameDir(gameId), STATUS_FILE), JSON.stringify(state, null, 2)))
      .catch((error) => log(gameId, `couldn't save its status: ${message(error)}`, "warn"));
  };

  // Live totals stay in memory for the loading screen; the file is written as each call finishes.
  const meter: TokenMeter = new TokenMeter((total, final) => {
    usage.set(gameId, total);
    if (final) saving = saving.then(() => writeFile(join(gameDir(gameId), USAGE_FILE), JSON.stringify({ ...meter.finished, calls: meter.calls }, null, 2))).catch(() => {});
  });

  log(gameId, "new game: writing the storyboard");
  update({ stage: "story" });
  try {
    await generateGame(gameId, {
      onStoryboard: ({ title, summary, rooms }) => {
        log(gameId, `building ${rooms.length} rooms in parallel`);
        update({ stage: "rooms", title, summary, roomsBuilt: 0, roomsTotal: rooms.length });
      },
      onRoomBuilt: (roomsBuilt, roomsTotal) => {
        log(gameId, `rooms built: ${roomsBuilt} of ${roomsTotal}`);
        update({ roomsBuilt, roomsTotal });
      },
      meter,
    });
    await saving;
    await rm(join(gameDir(gameId), STATUS_FILE), { force: true });
    making.delete(gameId);
    // Made locally, it goes up to the live site's bucket now, and again as its art comes in (bucket.ts).
    syncGame(gameId, { immediately: true });
    // Paints the copy games.ts serves, so the painting and every status report share one plan.
    const game = await getGame(gameId);
    if (game) await Promise.all([paintStatus(gameId, game, { start: true }), screamStatus(gameId, game, { start: true })]);
  } catch (error) {
    log(gameId, `generation failed: ${message(error)}`, "error");
    update({ stage: "failed", error: message(error).split("\n")[0] });
  }
}

/** Where a game stands, or undefined if there's no such game. Asking starts painting a game whose images (or screams) aren't all made. */
export async function gameStatus(gameId: string): Promise<GameStatus | undefined> {
  const game = await getGame(gameId);
  const tokens = await tokensOf(gameId);
  if (game) {
    const [art, screams] = await Promise.all([paintStatus(gameId, game, { start: true }), screamStatus(gameId, game, { start: true })]);
    const { total, ready, failed, generating } = art;
    return { stage: artStage(art), title: game.title, total, ready, failed, generating, screams, tokens, log: recentLog(gameId, LOG_LINES) };
  }
  const state = await makingState(gameId);
  if (!state) return undefined;
  const { stage, title, roomsBuilt, roomsTotal, error } = state;
  const screams = { total: 0, ready: [], failed: [] };
  return { stage, title, roomsBuilt, roomsTotal, error, total: 0, ready: [], failed: [], generating: 0, screams, tokens, log: recentLog(gameId, LOG_LINES) };
}

async function tokensOf(gameId: string): Promise<TokenUsage | undefined> {
  if (!usage.has(gameId)) {
    const text = await readIfExists(join(gameDir(gameId), USAGE_FILE));
    if (text === undefined) return undefined;
    try {
      // The file also lists every call; only the totals go to the loading screen.
      const { input, cached, output } = JSON.parse(text) as TokenUsage;
      usage.set(gameId, { input, cached, output, live: 0 });
    } catch {
      return undefined;
    }
  }
  return usage.get(gameId);
}

/** Every game: playable ones (fixtures first), then ones still being written or that failed. */
export async function summarizeGames(): Promise<GameSummary[]> {
  const games = await Promise.all(
    (await listGames()).map(async (info) => {
      const game = (await getGame(info.id)) as GameSpec;
      const art = await paintStatus(info.id, game, { start: false });
      return { ...info, stage: artStage(art), progress: progressOf(art), loading: art.running };
    }),
  );
  const listed = new Set(games.map((g) => g.id));
  const unfinished = await Promise.all(
    (await generatedIds())
      .filter((id) => !listed.has(id))
      .map(async (id): Promise<GameSummary | undefined> => {
        const state = await makingState(id);
        if (!state) return undefined;
        const { stage, title = "An unwritten house", summary = state.error ?? "", roomsTotal = 0 } = state;
        return { id, title, summary, rooms: roomsTotal, stage, progress: 0, loading: stage !== "failed" };
      }),
  );
  return [...games, ...unfinished.filter((g) => g !== undefined)];
}

/** Picks painting back up, after a restart, for every game whose images had started being made. */
export async function resumePainting() {
  for (const id of await generatedIds()) {
    const game = await getGame(id).catch(() => undefined);
    if (!game) continue;
    if (progressOf(await paintStatus(id, game, { start: false })) < 1) await paintStatus(id, game, { start: true });
  }
}

const artStage = (art: PaintStatus): GameStage => (art.running || progressOf(art) < 1 ? "art" : "ready");

async function makingState(gameId: string): Promise<Making | undefined> {
  const live = making.get(gameId);
  if (live) return live;
  const text = await readIfExists(join(gameDir(gameId), STATUS_FILE));
  if (text === undefined) return undefined;
  let saved: Making;
  try {
    saved = JSON.parse(text) as Making;
  } catch {
    return { stage: "failed", error: "Its status file is unreadable" };
  }
  // Nothing in this server is working on it, so a restart cut it short.
  return saved.stage === "failed" ? saved : { ...saved, stage: "failed", error: "Generation was interrupted when the server restarted" };
}
