// Copies generated games (server/games/<id>/: game.json plus any art made so far) into the Cloud Storage
// bucket the live server reads its games from. The server re-reads the bucket on every request, so a
// published game shows up in the game list right away, without a redeploy. Art it's missing is generated
// on the server the first time someone plays, and saved to the bucket too.
//
//   npm run publish-game -- <game-id> [<game-id>...]
//
// Needs the gcloud CLI, logged in (gcloud auth login). GAMES_BUCKET overrides the bucket.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { errorsIn, formatIssues } from "../src/shared/issues";
import { validateGame } from "../src/shared/validate";
import { uploadGame } from "../server/bucket";
import { gameDir, isSafeId } from "../server/games";

const SITE = "https://hackathon-2026-637555496889.us-east1.run.app";

const ids = process.argv.slice(2);
if (ids.length === 0 || !ids.every(isSafeId)) {
  console.error("Usage: npm run publish-game -- <game-id> [<game-id>...]   (ids of folders in server/games)");
  process.exit(1);
}

let failed = false;
for (const id of ids) {
  // Only publish a game the server will accept: it validates on load and would answer 500 otherwise.
  let issues;
  try {
    issues = validateGame(JSON.parse(await readFile(join(gameDir(id), "game.json"), "utf8"))).issues;
  } catch (error) {
    console.error(`✗ ${id}: no readable server/games/${id}/game.json (${error instanceof Error ? error.message : error})`);
    failed = true;
    continue;
  }
  const errors = errorsIn(issues);
  if (errors.length) {
    console.error(`✗ ${id} doesn't validate, not publishing:\n${formatIssues(errors)}`);
    failed = true;
    continue;
  }

  try {
    await uploadGame(id);
  } catch (error) {
    console.error(`✗ ${id}: ${error instanceof Error ? error.message : error}`);
    failed = true;
    continue;
  }
  console.log(`✓ ${id} published: ${SITE}/?game=${id}`);
}
if (failed) process.exitCode = 1;
