import { createServer, type ServerResponse } from "node:http";
import { getAsset } from "./assets";
import { getGame, InvalidGameError, isSafeId } from "./games";

// Game server. Vite proxies /api here (see vite.config.ts); `npm run dev` starts both.
//   GET /api/games/:gameId                -> the game's GameSpec JSON
//   GET /api/games/:gameId/assets/:artId  -> PNG (generated the first time it's asked for)
const PORT = 3002;

const send = (res: ServerResponse, status: number, body: string | Buffer, type = "text/plain") => {
  res.writeHead(status, { "Content-Type": type }).end(body);
};

const server = createServer(async (req, res) => {
  const parts = new URL(req.url ?? "/", "http://localhost").pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [api, games, gameId, assets, artId] = parts;
  if (req.method !== "GET" || api !== "api" || games !== "games" || !gameId || !isSafeId(gameId)) {
    return send(res, 404, "Not found");
  }

  try {
    const game = await getGame(gameId);
    if (!game) return send(res, 404, `No game "${gameId}"`);
    if (parts.length === 3) return send(res, 200, JSON.stringify(game), "application/json");
    if (parts.length === 5 && assets === "assets" && isSafeId(artId)) {
      const png = await getAsset(gameId, game, artId);
      return png ? send(res, 200, png, "image/png") : send(res, 404, `No art ${artId} in game ${gameId}`);
    }
    send(res, 404, "Not found");
  } catch (error) {
    if (error instanceof InvalidGameError) return send(res, 500, error.message);
    console.error(`${req.url} failed:`, error);
    send(res, 500, String(error));
  }
});

server.listen(PORT, () => console.log(`Game server on http://localhost:${PORT}`));
