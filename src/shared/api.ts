// Shapes of the game server's JSON responses that aren't a GameSpec.

/**
 * Where a game is in being made. story: writing the storyboard. rooms: building the rooms. art: painting
 * its images, playable once PLAYABLE_SHARE of them are done. ready: every image is made (or given up on).
 * failed: generation stopped.
 */
export type GameStage = "story" | "rooms" | "art" | "ready" | "failed";

/** A game can be entered once this share of its images is made. */
export const PLAYABLE_SHARE = 0.6;

/** One entry of GET /api/games. */
export interface GameSummary {
  id: string;
  title: string;
  summary: string;
  rooms: number;
  stage: GameStage;
  /** Share of its images made, 0 to 1. */
  progress: number;
  /** The server is working on it right now; otherwise it picks up where it left off when the game is opened. */
  loading: boolean;
}

/** Claude tokens spent writing a game, summed over every call (storyboard, rooms, repairs). */
export interface TokenUsage {
  /** Input tokens read in full (including ones written to the prompt cache). */
  input: number;
  /** Input tokens read from the prompt cache, which cost a fraction of the rest. */
  cached: number;
  output: number;
  /** Calls still streaming; their output counts as an estimate until they finish. */
  live: number;
}

/** POST /api/games: the new game's id. It keeps being made whether or not anyone is waiting for it. */
export interface CreatedGame {
  id: string;
}

/** GET /api/games/:gameId/status. Asking also starts painting a game whose images aren't all made. */
export interface GameStatus {
  stage: GameStage;
  /** Known once the storyboard is written. */
  title?: string;
  /** While rooms are being built. */
  roomsBuilt?: number;
  roomsTotal?: number;
  /** Why it failed. */
  error?: string;
  /** Once the game exists: how many images it needs, the ids made so far, and the ids given up on. */
  total: number;
  ready: string[];
  failed: string[];
  /** Images being drawn right now. */
  generating: number;
  /** Games made by this server; fixtures have none. */
  tokens?: TokenUsage;
  /** The latest server log lines about this game, oldest first (since the server last started). */
  log: string[];
}

/** Share of a game's images settled (made or given up on), 0 to 1. */
export const progressOf = ({ total, ready, failed }: Pick<GameStatus, "total" | "ready" | "failed">) =>
  total === 0 ? 1 : (ready.length + failed.length) / total;
