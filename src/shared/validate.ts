import { checkGame, doorSides } from "./checkGame";
import { checkRoom } from "./checkRoom";
import { errorsIn, type Issue } from "./issues";
import { parseGameSpec } from "./parseSpec";
import type { GameSpec } from "./spec";

/**
 * Everything a game must pass before it's saved or played: its shape, every room's layout, and the
 * rules that span rooms. Rooms that parsed are checked even when others didn't, so Claude hears about
 * every problem in one round. `spec` is only returned when there are no errors at all.
 */
export function validateGame(value: unknown): { spec: GameSpec | undefined; issues: Issue[] } {
  const parsed = parseGameSpec(value);
  const issues = [...parsed.issues];
  const rooms = parsed.rooms.map(({ room }) => room);
  const parsedIds = new Set(rooms.map((room) => room.id));
  const sides = doorSides(rooms, parsed.connections);

  for (const { index, room } of parsed.rooms) {
    // A door leading to a room that didn't parse can't be judged yet; it's checked once that room is fixed.
    const judgeable =
      parsed.complete ||
      room.doors.every((door) => parsed.connections.find((c) => c.id === door.connection)?.rooms.every((id) => parsedIds.has(id)));
    if (judgeable) issues.push(...checkRoom(room, { path: `rooms[${index}](${room.id})`, sides: sides.get(room.id) ?? new Map() }));
  }
  if (parsed.complete) {
    issues.push(...checkGame(parsed.spec ?? { version: 1, title: "", summary: "", rooms, connections: parsed.connections }));
  }
  return { spec: errorsIn(issues).length === 0 ? parsed.spec : undefined, issues };
}
