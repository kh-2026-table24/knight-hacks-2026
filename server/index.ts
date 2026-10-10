import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { getAsset } from "./assets";
import { getGame, isSafeId } from "./games";
import { onCloudRun } from "./secrets";

// Game server. Vite proxies /api here (see vite.config.ts); `npm run dev` starts both.
//   GET /api/games/:gameId                    -> game JSON (created the first time it's asked for)
//   GET /api/games/:gameId/assets/:textureId  -> PNG (generated the first time it's asked for)
// In production (`npm run build && npm start`) it also serves the built client from dist/.
const PORT = Number(process.env.PORT) || 3002;
const DIST_DIR = join(import.meta.dirname, "..", "dist");

// On Cloud Run, games are read-only: only games already in server/games are served, and visitors
// can't create new ones. ALLOWED_GAMES (comma-separated ids) narrows that list further.
const CREATE_GAMES = !onCloudRun;
const ALLOWED_GAMES = process.env.ALLOWED_GAMES?.split(",").map((id) => id.trim()).filter(Boolean);
const isAllowed = (gameId: string) => isSafeId(gameId) && (!ALLOWED_GAMES || ALLOWED_GAMES.includes(gameId));

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
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
    const [api, games, gameId, assets, textureId] = parts;
    if (api !== "api") return await sendStatic(res, pathname);
    if (games !== "games" || !gameId || !isAllowed(gameId)) return send(res, 404, "Not found");

    if (parts.length === 3) {
      const game = await getGame(gameId, CREATE_GAMES);
      return game ? send(res, 200, JSON.stringify(game), "application/json") : send(res, 404, `No game ${gameId}`);
    }
    if (parts.length === 5 && assets === "assets" && isSafeId(textureId)) {
      const game = await getGame(gameId, false);
      const png = game && (await getAsset(game, textureId));
      return png ? send(res, 200, png, "image/png", "public, max-age=86400") : send(res, 404, `No texture ${textureId} in game ${gameId}`);
    }
    send(res, 404, "Not found");
  } catch (error) {
    console.error(`${req.url} failed:`, error);
    // Details stay in the logs; visitors don't need stack traces.
    send(res, 500, onCloudRun ? "Server error" : String(error));
  }
});

server.listen(PORT, () => console.log(`Game server on http://localhost:${PORT}`));
