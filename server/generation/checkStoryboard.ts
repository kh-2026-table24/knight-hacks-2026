import { solveLocks } from "../../src/shared/checkGame";
import { sideToward } from "../../src/shared/geometry";
import { isFields, SLUG } from "../../src/shared/reader";
import { LIMITS, type Vec2 } from "../../src/shared/spec";

// The storyboard is mostly prose that the room prompts read as-is, so only the parts code relies on
// are typed and checked here: the room ids and cells, the doors between them, which room holds each
// key, and the objectives and the rooms that set them. Those are cheap to fix now and expensive to discover after every room is built.

export interface StoryboardRoom {
  id: string;
  name: string;
  outdoor: boolean;
  grid: Vec2;
}

export interface StoryboardDoor {
  id: string;
  rooms: [string, string];
  locked: boolean;
  description?: string;
}

export interface StoryboardKey {
  name: string;
  appearance: string;
  unlocks: string;
  room: string;
  howFound?: string;
  hint?: string;
}

export interface StoryboardObjective {
  id: string;
  text: string;
  /** The room whose prop, character or pickup sets it. The first objective has none: it's shown from the start. */
  room?: string;
  /** What the player interacts with there to set it. */
  trigger?: string;
}

/** The checked parts of a storyboard, plus the whole thing as Claude wrote it. */
export interface Storyboard {
  title: string;
  summary: string;
  rooms: StoryboardRoom[];
  doors: StoryboardDoor[];
  keys: StoryboardKey[];
  objectives: StoryboardObjective[];
  raw: Record<string, unknown>;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const isCell = (v: unknown): v is Vec2 => Array.isArray(v) && v.length === 2 && v.every(Number.isInteger);

/** The storyboard, or the problems that stop rooms being built from it (written for Claude to fix). */
export function checkStoryboard(value: unknown): { storyboard?: Storyboard; problems: string[] } {
  const problems: string[] = [];
  if (!isFields(value)) return { problems: ["The storyboard must be a JSON object"] };
  const list = (key: string) => (Array.isArray(value[key]) ? (value[key] as unknown[]) : (problems.push(`"${key}" must be a list`), []));

  const title = str(value.title);
  const summary = str(value.summary);
  if (!title) problems.push(`"title" is missing`);
  if (!summary) problems.push(`"summary" is missing`);

  const rooms: StoryboardRoom[] = [];
  const cells = new Map<string, string>();
  list("rooms").forEach((r, i) => {
    const at = `rooms[${i}]`;
    if (!isFields(r)) return problems.push(`${at} must be an object`);
    const id = str(r.id);
    if (!id || !SLUG.test(id)) return problems.push(`${at}.id must be kebab-case (lowercase letters, digits and dashes), got ${JSON.stringify(r.id)}`);
    if (rooms.some((room) => room.id === id)) return problems.push(`${at}.id "${id}" is used by another room too`);
    if (!isCell(r.grid)) return problems.push(`${at}(${id}).grid must be two whole numbers [x, z]`);
    const other = cells.get(r.grid.join(","));
    if (other) return problems.push(`${at}(${id}).grid [${r.grid.join(", ")}] is the same cell as room "${other}"; every room needs its own cell`);
    cells.set(r.grid.join(","), id);
    rooms.push({ id, name: str(r.name) ?? id, outdoor: r.outdoor === true, grid: r.grid });
  });
  if (rooms.length === 0) problems.push("The storyboard needs at least one room");
  if (rooms.length > LIMITS.rooms) problems.push(`The storyboard has ${rooms.length} rooms; the limit is ${LIMITS.rooms}`);
  const roomById = new Map(rooms.map((room) => [room.id, room]));

  const doors: StoryboardDoor[] = [];
  list("doors").forEach((d, i) => {
    const at = `doors[${i}]`;
    if (!isFields(d)) return problems.push(`${at} must be an object`);
    const id = str(d.id);
    if (!id || !SLUG.test(id)) return problems.push(`${at}.id must be kebab-case, got ${JSON.stringify(d.id)}`);
    if (doors.some((door) => door.id === id)) return problems.push(`${at}.id "${id}" is used by another door too`);
    const pair = Array.isArray(d.rooms) ? d.rooms : [];
    const [a, b] = pair.map((room) => roomById.get(String(room)));
    if (pair.length !== 2 || !a || !b) return problems.push(`${at}(${id}).rooms must name two rooms from the rooms list, got ${JSON.stringify(d.rooms)}`);
    if (a === b || !sideToward(a.grid, b.grid)) {
      return problems.push(`${at}(${id}) joins "${a.id}" [${a.grid.join(", ")}] and "${b.id}" [${b.grid.join(", ")}], which aren't neighbors; their cells must differ by 1 in exactly one coordinate`);
    }
    if (doors.some((door) => door.rooms.includes(a.id) && door.rooms.includes(b.id))) return problems.push(`${at}(${id}) joins "${a.id}" and "${b.id}", which another door already joins`);
    doors.push({ id, rooms: [a.id, b.id], locked: d.locked === true, ...(str(d.description) && { description: str(d.description) }) });
  });
  const doorById = new Map(doors.map((door) => [door.id, door]));

  const keys: StoryboardKey[] = [];
  list("keys").forEach((k, i) => {
    const at = `keys[${i}]`;
    if (!isFields(k)) return problems.push(`${at} must be an object`);
    const name = str(k.name);
    const unlocks = str(k.unlocks);
    const room = str(k.room);
    if (!name) return problems.push(`${at}.name is missing`);
    const door = unlocks ? doorById.get(unlocks) : undefined;
    if (!door) return problems.push(`${at}(${name}).unlocks must be the id of a door, got ${JSON.stringify(k.unlocks)}`);
    if (!door.locked) return problems.push(`${at}(${name}) unlocks "${door.id}", which isn't locked; lock that door or remove the key`);
    if (!room || !roomById.has(room)) return problems.push(`${at}(${name}).room must be the id of a room, got ${JSON.stringify(k.room)}`);
    keys.push({ name, appearance: str(k.appearance) ?? name, unlocks: door.id, room, howFound: str(k.howFound), hint: str(k.hint) });
  });

  const objectives: StoryboardObjective[] = [];
  list("objectives").forEach((o, i) => {
    const at = `objectives[${i}]`;
    if (!isFields(o)) return problems.push(`${at} must be an object`);
    const id = str(o.id);
    const text = str(o.text);
    if (!id || !SLUG.test(id)) return problems.push(`${at}.id must be kebab-case, got ${JSON.stringify(o.id)}`);
    if (objectives.some((objective) => objective.id === id)) return problems.push(`${at}.id "${id}" is used by another objective too`);
    if (!text) return problems.push(`${at}(${id}).text is missing`);
    if (text.length > LIMITS.objectiveLength) return problems.push(`${at}(${id}).text is ${text.length} characters; keep it under ${LIMITS.objectiveLength}`);
    const room = str(o.room);
    if (i > 0 && (!room || !roomById.has(room))) return problems.push(`${at}(${id}).room must be the id of the room whose object sets it, got ${JSON.stringify(o.room)}`);
    objectives.push({ id, text, ...(i > 0 && { room, trigger: str(o.trigger) }) });
  });
  if (objectives.length === 0) problems.push(`"objectives" needs at least one objective, the one shown at the start`);
  if (objectives.length > LIMITS.objectives) problems.push(`The storyboard has ${objectives.length} objectives; the limit is ${LIMITS.objectives}`);

  // Walk the map the way a player would, opening each locked door once its key's room is reached.
  if (rooms.length > 0) {
    const keyRooms = new Map<string, string[]>();
    for (const key of keys) keyRooms.set(key.unlocks, [...(keyRooms.get(key.unlocks) ?? []), key.room]);
    const { reached, opened } = solveLocks({ start: rooms[0].id, connections: doors, keyRooms });
    for (const door of doors) {
      if (door.locked && !keyRooms.has(door.id)) problems.push(`Locked door "${door.id}" has no key; add one to "keys"`);
      else if (door.locked && !opened.has(door.id)) problems.push(`Locked door "${door.id}" can never be opened: its key is only in rooms the player can't reach before it`);
    }
    for (const room of rooms) if (!reached.has(room.id)) problems.push(`Room "${room.id}" can't be reached from the first room, "${rooms[0].id}"`);
  }

  if (problems.length > 0 || !title || !summary) return { problems };
  return { storyboard: { title, summary, rooms, doors, keys, objectives, raw: value }, problems };
}
