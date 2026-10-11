// Server logging. Every line goes to the terminal with the time, and lines about a game are also kept
// (the latest few) so its loading screen can show what the server is doing.
const KEPT_PER_GAME = 40;

export type LogLevel = "info" | "warn" | "error";

const recent = new Map<string, string[]>();

const time = () => new Date().toTimeString().slice(0, 8);

/** Logs a line, about a game if `gameId` is given (it's then prefixed with the id in the terminal). */
export function log(gameId: string | undefined, message: string, level: LogLevel = "info") {
  const line = `${time()} ${message}`;
  const terminal = gameId ? `${time()} [${gameId}] ${message}` : line;
  if (level === "error") console.error(terminal);
  else if (level === "warn") console.warn(terminal);
  else console.log(terminal);
  if (!gameId) return;
  // Only the first line of a long message (a list of problems, say) is kept for the screen.
  const lines = recent.get(gameId) ?? [];
  lines.push(`${time()} ${level === "info" ? "" : `${level.toUpperCase()} `}${message.split("\n")[0]}`);
  recent.set(gameId, lines.slice(-KEPT_PER_GAME));
}

/** The latest lines logged about a game, oldest first. */
export const recentLog = (gameId: string, count: number) => (recent.get(gameId) ?? []).slice(-count);
