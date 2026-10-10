import "./style.css";
import { init as initPhysics } from "@dimforge/rapier3d-compat";
import { GameComposer } from "./game/GameComposer";
import { Game } from "./game/Game";
import { artIdsForRoom } from "./shared/art";
import { errorsIn, formatIssues } from "./shared/issues";
import { validateGame } from "./shared/validate";

await initPhysics();

const canvas = document.getElementById("gl-canvas") as HTMLCanvasElement;
export const composer = new GameComposer(canvas);

/** Shows why the game can't start, and stops here. */
function fail(message: string): never {
  composer.hud.showMessage(message);
  throw new Error(message);
}

// ?game=<id> picks the game; the games in fixtures/games are served under their file names.
const gameId = new URLSearchParams(location.search).get("game") ?? "haunted";
const response = await fetch(`/api/games/${encodeURIComponent(gameId)}`);
if (!response.ok) fail(`Couldn't load game "${gameId}":\n${await response.text()}`);

// The server validates too; checking again here guards against a hand-edited or stale file.
const { spec, issues } = validateGame(await response.json());
if (!spec) fail(`Game "${gameId}" has problems:\n${formatIssues(errorsIn(issues))}`);

const game = new Game(gameId, spec);
composer.loadGame(game);

// The room the player starts in loads first, then the rest. Each image appears as soon as the server has
// it (from disk, or generated now), and the game is playable with placeholders until then.
const ids = [...new Set([...artIdsForRoom(spec, spec.rooms[0]), ...game.textures.ids])];
const failed = await game.textures.load(gameId, ids);
console.log(`Loaded ${ids.length - failed.length}/${ids.length} textures`, ...(failed.length ? ["failed:", failed] : []));
