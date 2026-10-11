// Shapes of the game server's JSON responses that aren't a GameSpec.

/** One entry of GET /api/games. */
export interface GameSummary {
  id: string;
  title: string;
  summary: string;
  rooms: number;
}
