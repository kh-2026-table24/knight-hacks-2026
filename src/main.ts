import "./style.css";
import { init as initPhysics } from "@dimforge/rapier3d-compat";
import { GameComposer } from "./game/GameComposer";
import { Game } from "./game/Game";
import { generate } from "./game/generation/generate";

await initPhysics();

const canvas = document.getElementById("gl-canvas") as HTMLCanvasElement;
export const composer = new GameComposer(canvas);

composer.loadGame(new Game(await generate()));
