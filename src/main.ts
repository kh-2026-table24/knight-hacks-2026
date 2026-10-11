import "./style.css";
import { init as initPhysics } from "@dimforge/rapier3d-compat";
import { GameComposer } from "./game/GameComposer";
import { Game } from "./game/Game";
import { LoadingScreen } from "./game/ui/LoadingScreen";
import { TitleScreen } from "./game/ui/TitleScreen";
import { PLAYABLE_SHARE, progressOf, type GameStatus } from "./shared/api";
import { errorsIn, formatIssues } from "./shared/issues";
import { validateGame } from "./shared/validate";

// How often to ask the server how the game is coming along.
const POLL_MS = 1500;

await initPhysics();

const canvas = document.getElementById("gl-canvas") as HTMLCanvasElement;
export const composer = new GameComposer(canvas);

// ?game=<id> goes straight into a game (the games in fixtures/games are served under their file names);
// without it, the title screen offers a new game or the ones made before. The pick goes into the
// address, so reloading stays in it.
let gameId = new URLSearchParams(location.search).get("game");
let title: TitleScreen | undefined;
if (!gameId) {
  title = new TitleScreen(composer.sounds.audio);
  gameId = await title.choose();
  history.replaceState(null, "", `?game=${encodeURIComponent(gameId)}`);
}
const id = gameId;
// Underneath the title screen, which fades out over it.
const loading = new LoadingScreen();
title?.hide();

/** Shows why the game can't start, and stops here. */
function fail(message: string): never {
  loading.fail(message);
  throw new Error(message);
}

// Esc goes back to the title screen, unless it's closing a dialogue. The server keeps making the game.
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !e.defaultPrevented && !composer.hud.dialogue.isOpen) location.assign("/");
});

/** Undefined when the server didn't answer properly (busy, or restarting); it's asked again next time. */
async function fetchStatus(): Promise<GameStatus | undefined> {
  const response = await fetch(`/api/games/${encodeURIComponent(id)}/status`).catch(() => undefined);
  if (response?.status === 404) fail(`There's no game "${id}".`);
  if (!response?.ok) return undefined;
  return response.json();
}

async function fetchGame(): Promise<Game> {
  const response = await fetch(`/api/games/${encodeURIComponent(id)}`);
  if (!response.ok) fail(`Couldn't load game "${id}":\n${await response.text()}`);
  // The server validates too; checking again here guards against a hand-edited or stale file.
  const { spec, issues } = validateGame(await response.json());
  if (!spec) fail(`Game "${id}" has problems:\n${formatIssues(errorsIn(issues))}`);
  return new Game(id, spec);
}

/** Loads the images the server has finished since last time, so rooms fill in as it paints them. */
async function loadFinished(game: Game, status: GameStatus) {
  game.textures.giveUp(status.failed);
  const failed = await game.textures.load(id, status.ready);
  if (failed.length) console.warn("Images that wouldn't load:", failed);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The server writes the story, builds the rooms, then paints every image, the rooms the player reaches
// first first. The game opens once PLAYABLE_SHARE of the images are made and the first room has all of
// its own; any other room opens once its images are in (Interactions.useDoor checks).
let game: Game | undefined;
for (;;) {
  const status = await fetchStatus();
  if (status) {
    loading.show(status);
    if (status.stage === "failed") fail(status.error ?? "Generation failed");
    if (status.stage === "art" || status.stage === "ready") {
      game ??= await fetchGame();
      await loadFinished(game, status);
      if (progressOf(status) >= PLAYABLE_SHARE && game.isRoomReady(game.startRoom.id)) {
        loading.show(status, true);
        break;
      }
    }
  }
  await sleep(POLL_MS);
}

const playing = game;
composer.loadGame(playing);
loading.hide();

// Keep following the painting while the player plays, until every image is in.
for (;;) {
  const status = await fetchStatus();
  if (status) {
    await loadFinished(playing, status);
    if (status.stage === "ready" && status.ready.every((art) => playing.textures.isSettled(art))) {
      console.log(`All ${status.total} images loaded${status.failed.length ? `, ${status.failed.length} given up on` : ""}`);
      break;
    }
  }
  await sleep(POLL_MS);
}
