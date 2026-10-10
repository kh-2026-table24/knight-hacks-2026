import "./style.css";
import { GameComposer } from "./game/GameComposer";

const canvas = document.getElementById("gl-canvas") as HTMLCanvasElement;
export const composer = new GameComposer(canvas);
