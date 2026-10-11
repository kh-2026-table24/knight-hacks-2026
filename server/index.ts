import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { getAsset } from "./assets";
import { getGame, InvalidGameError, isSafeId, listGames } from "./games";
import { onCloudRun } from "./secrets";

// Game server. Vite proxies /api here (see vite.config.ts); `npm run dev` starts both.
//   GET /api/games                        -> the games there are to play: [{ id, title, summary, rooms }]
//   GET /api/games/:gameId                -> the game's GameSpec JSON
//   GET /api/games/:gameId/assets/:artId  -> PNG (generated the first time it's asked for)
// In production (`npm run build && npm start`) it also serves the built client from dist/.
const PORT = Number(process.env.PORT) || 3002;
const DIST_DIR = join(import.meta.dirname, "..", "dist");

// ALLOWED_GAMES (comma-separated ids) limits which games are served, e.g. on Cloud Run.
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
  if (req.method !== "GET") return send(res, 405, "Method not allowed");

  try {
    const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const [api, games, gameId, assets, artId] = parts;
    if (api !== "api") return await sendStatic(res, pathname);
    if (games === "games" && parts.length === 2) {
      const list = (await listGames()).filter((g) => isAllowed(g.id));
      return send(res, 200, JSON.stringify(list), "application/json");
    }
    if (games !== "games" || !gameId || !isAllowed(gameId)) return send(res, 404, "Not found");

    const game = await getGame(gameId);
    if (!game) return send(res, 404, `No game "${gameId}"`);
    if (parts.length === 3) return send(res, 200, JSON.stringify(game), "application/json");
    if (parts.length === 5 && assets === "assets" && isSafeId(artId)) {
      const png = await getAsset(gameId, game, artId);
      return png ? send(res, 200, png, "image/png", "public, max-age=86400") : send(res, 404, `No art ${artId} in game ${gameId}`);
    }
    send(res, 404, "Not found");
  } catch (error) {
    if (error instanceof InvalidGameError) return send(res, 500, error.message);
    console.error(`${req.url} failed:`, error);
    // Details stay in the logs; visitors don't need stack traces.
    send(res, 500, onCloudRun ? "Server error" : String(error));
  }
});

server.listen(PORT, () => console.log(`Game server on http://localhost:${PORT}`));
