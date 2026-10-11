import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import type { CreatedGame } from "../src/shared/api";
import { getAsset } from "./assets";
import { getGame, InvalidGameError, isSafeId } from "./games";
import { createGame, gameStatus, resumePainting, summarizeGames } from "./jobs";
import { log } from "./log";
import { onCloudRun } from "./secrets";

// Game server. Vite proxies /api here (see vite.config.ts); `npm run dev` starts both.
//   GET  /api/games                        -> every game and how far along it is: GameSummary[]
//   POST /api/games                        -> starts making a new game (story, rooms, then art): { id }
//   GET  /api/games/:gameId                -> the game's GameSpec JSON, once its rooms are built
//   GET  /api/games/:gameId/status         -> GameStatus; also starts painting a game whose art isn't all made
//   GET  /api/games/:gameId/assets/:artId  -> PNG, once it's been made (404 until then)
// In production (`npm run build && npm start`) it also serves the built client from dist/.
const PORT = Number(process.env.PORT) || 3002;
const DIST_DIR = join(import.meta.dirname, "..", "dist");

// ALLOWED_GAMES (comma-separated ids) limits which games are served, e.g. on Cloud Run. Setting it also
// turns off making new games, since they'd never be on the list.
const ALLOWED_GAMES = process.env.ALLOWED_GAMES?.split(",").map((id) => id.trim()).filter(Boolean);
const isAllowed = (gameId: string) => isSafeId(gameId) && (!ALLOWED_GAMES || ALLOWED_GAMES.includes(gameId));

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const send = (res: ServerResponse, status: number, body: string | Buffer, type = "text/plain", cache?: string) => {
  res.writeHead(status, { "Content-Type": type, ...(cache && { "Cache-Control": cache }) }).end(body);
};

/** A file from dist/, or index.html for any other page. Vite's hashed files in assets/ never change, so they cache forever. */
async function sendStatic(res: ServerResponse, pathname: string) {
  const file = join(DIST_DIR, normalize(pathname).replace(/^(\.\.[/\\])+/, ""));
  const body = file.startsWith(DIST_DIR) && extname(file) ? await readFile(file).catch(() => undefined) : undefined;
  if (body) {
    const immutable = pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
    return send(res, 200, body, CONTENT_TYPES[extname(file)] ?? "application/octet-stream", immutable);
  }
  const index = await readFile(join(DIST_DIR, "index.html")).catch(() => undefined);
  return index ? send(res, 200, index, CONTENT_TYPES[".html"], "no-cache") : send(res, 404, "Not found (run npm run build to serve the client)");
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [api, games, gameId, assets, artId] = parts;
  const creating = req.method === "POST" && api === "api" && games === "games" && parts.length === 2;
  if (req.method !== "GET" && !creating) return send(res, 405, "Method not allowed");

  try {
    if (api !== "api") return await sendStatic(res, pathname);
    if (creating) {
      if (ALLOWED_GAMES) return send(res, 403, "Making new games is turned off on this server");
      const created: CreatedGame = { id: createGame() };
      return send(res, 202, JSON.stringify(created), "application/json");
    }
    if (games === "games" && parts.length === 2) {
      const list = (await summarizeGames()).filter((g) => isAllowed(g.id));
      return send(res, 200, JSON.stringify(list), "application/json");
    }
    if (games !== "games" || !gameId || !isAllowed(gameId)) return send(res, 404, "Not found");

    if (parts.length === 4 && assets === "status") {
      const status = await gameStatus(gameId);
      return status ? send(res, 200, JSON.stringify(status), "application/json", "no-store") : send(res, 404, `No game "${gameId}"`);
    }
    const game = await getGame(gameId);
    if (!game) return send(res, 404, `No game "${gameId}"`);
    if (parts.length === 3) return send(res, 200, JSON.stringify(game), "application/json");
    if (parts.length === 5 && assets === "assets" && isSafeId(artId)) {
      const png = await getAsset(gameId, game, artId);
      // An id names its exact prompt, so a made image never changes.
      return png ? send(res, 200, png, "image/png", "public, max-age=31536000, immutable") : send(res, 404, `Art ${artId} of game ${gameId} isn't made yet`);
    }
    send(res, 404, "Not found");
  } catch (error) {
    if (error instanceof InvalidGameError) return send(res, 500, error.message);
    log(undefined, `${req.method} ${req.url} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`, "error");
    // Details stay in the logs; visitors don't need stack traces.
    send(res, 500, onCloudRun ? "Server error" : String(error));
  }
});

server.listen(PORT, () => {
  log(undefined, `Game server on http://localhost:${PORT}`);
  resumePainting().catch((error) => log(undefined, `Couldn't resume painting: ${error instanceof Error ? error.message : String(error)}`, "error"));
});
