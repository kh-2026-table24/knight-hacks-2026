import "./style.css";
import { init as initPhysics } from "@dimforge/rapier3d-compat";
import { GameComposer } from "./game/GameComposer";
import { Game } from "./game/Game";
import type { SavedGame } from "./game/generation/output/output";

await initPhysics();

const canvas = document.getElementById("gl-canvas") as HTMLCanvasElement;
export const composer = new GameComposer(canvas);

// ?game=<id> picks the game. The server creates it the first time it's asked for.
const gameId = new URLSearchParams(location.search).get("game") ?? "dev";
const response = await fetch(`/api/games/${encodeURIComponent(gameId)}`);
if (!response.ok) throw new Error(`Couldn't load game ${gameId}: ${await response.text()}`);
const game = new Game((await response.json()) as SavedGame);
composer.loadGame(game);

// Request every texture at once. Each appears as soon as the server has it, from disk or freshly generated;
// the game is playable with placeholders until then.
const textureIds = [...game.textures.prompts.keys()];
const results = await Promise.allSettled(
  textureIds.map((id) => game.textures.setImage(id, `/api/games/${encodeURIComponent(game.id)}/assets/${encodeURIComponent(id)}`)),
);
const failed = textureIds.filter((_, i) => results[i].status === "rejected");
console.log(`Loaded ${textureIds.length - failed.length}/${textureIds.length} textures`, ...(failed.length ? ["failed:", failed] : []));
