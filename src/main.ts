import "./style.css";
import { init as initPhysics } from "@dimforge/rapier3d-compat";
import { GameComposer } from "./game/GameComposer";
import { Game } from "./game/Game";
import { generate } from "./game/generation/generate";
import { generateAssets } from "./game/generation/assets";

await initPhysics();

const canvas = document.getElementById("gl-canvas") as HTMLCanvasElement;
export const composer = new GameComposer(canvas);

const output = await generate();
const game = new Game(output);
composer.loadGame(game);

// Images fill in as they finish; the game is playable with placeholders until then.
generateAssets(output, game.textures).catch(console.error);
