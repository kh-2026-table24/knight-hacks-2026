import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gameDir } from "./games";
import { log } from "./log";
import { onCloudRun } from "./secrets";

// The live server reads games from a Cloud Storage bucket mounted at server/games/. Games made on a local
// server are copied up to it as they're made, so they show up on the live site too: once the game is
// saved, then again as its images and screams come in. Only finished games go up (a saved game.json is
// always valid); drafts, status files and failed attempts stay local.
//
// Uses the gcloud CLI (gcloud auth login). SYNC_GAMES=off in .env.local turns it off; GAMES_BUCKET picks
// another bucket. On Cloud Run there's nothing to do: server/games/ is the bucket.
export const BUCKET = process.env.GAMES_BUCKET ?? "project-5566acbe-9477-4102-a25-paradise-games";
const enabled = !onCloudRun && process.env.SYNC_GAMES !== "off";
// Uploads for one game are batched: at most one this often while it's being painted.
const SYNC_DELAY_MS = 30_000;
// The generator's working files; the server never serves them.
const EXCLUDE = "(^|/)(game\\.draft\\.json|status\\.json)$";

const run = promisify(execFile);

/** Copies a game's folder (game.json plus whatever art and screams it has) to the bucket. Adds and updates; never deletes. */
export async function uploadGame(gameId: string, { quiet = false } = {}) {
  await run("gcloud", ["storage", "rsync", "--recursive", "--exclude", EXCLUDE, gameDir(gameId), `gs://${BUCKET}/${gameId}`], {
    maxBuffer: 16 * 1024 * 1024,
  }).catch((error: { stderr?: string; message: string }) => {
    throw new Error((error.stderr || error.message).trim().split("\n").slice(-3).join(" "));
  });
  if (!quiet) log(gameId, `copied to gs://${BUCKET}/${gameId}`);
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const running = new Map<string, Promise<void>>();

/** Something in this game's folder changed: copy it to the bucket soon (or now, with `immediately`). */
export function syncGame(gameId: string, { immediately = false } = {}) {
  if (!enabled) return;
  if (timers.has(gameId) && !immediately) return;
  clearTimeout(timers.get(gameId));
  timers.set(
    gameId,
    setTimeout(
      () => {
        timers.delete(gameId);
        // One upload per game at a time; a change during one is picked up by the next.
        const previous = running.get(gameId) ?? Promise.resolve();
        const next = previous.then(async () => {
          // A game only goes up once it has a saved, valid game.json.
          if (!(await access(join(gameDir(gameId), "game.json")).then(() => true, () => false))) return;
          await uploadGame(gameId, { quiet: true }).catch((error) => log(gameId, `couldn't copy it to the bucket: ${error.message}`, "warn"));
        });
        running.set(gameId, next);
        void next.finally(() => running.get(gameId) === next && running.delete(gameId));
      },
      immediately ? 0 : SYNC_DELAY_MS,
    ),
  );
}
