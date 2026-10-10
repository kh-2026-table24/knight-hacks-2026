import { Connection, type Side } from "../../Connection";

// What the planner writes: the story, which rooms exist, where they sit on the map grid,
// and how they connect. Each room is then laid out by its own room call.

export interface RoomBrief {
  id: string;
  name: string;
  outdoor: boolean;
  /** [x, z] map cell. North is -z, east is +x. */
  gridPosition: [number, number];
  /** What the room is, what happened in it, its key objects. */
  brief: string;
}

export interface ConnectionPlan {
  id: string;
  roomIds: [string, string];
}

export interface HousePlan {
  title: string;
  story: string;
  rooms: RoomBrief[];
  connections: ConnectionPlan[];
}

/** A door a room must have: which connection, which wall, and where it leads. */
export interface DoorSlot {
  connectionId: string;
  side: Side;
  leadsTo: string;
}

/** Everything a room call needs to know about the house around it. */
export interface RoomContext {
  theme: string;
  house: HousePlan;
  room: RoomBrief;
  layout: string;
  doors: DoorSlot[];
}

/** The grounds, the main room and at least 2 side rooms. There is no upper limit: the planner
 * decides how many the story needs, and the grid rules keep any number of rooms consistent. */
export const MIN_ROOMS = 4;

type Fields = Record<string, unknown>;
const isFields = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function parseRoom(value: unknown, index: number, errors: string[]): RoomBrief | null {
  const path = `rooms[${index}]`;
  if (!isFields(value)) {
    errors.push(`${path} must be an object`);
    return null;
  }
  const before = errors.length;
  const { id, name, outdoor, gridPosition, brief } = value;
  if (typeof id !== "string" || !SLUG.test(id)) errors.push(`${path}.id must be a lowercase slug like "great-hall"`);
  if (typeof name !== "string" || !name.trim()) errors.push(`${path}.name must be a non-empty string`);
  if (typeof outdoor !== "boolean") errors.push(`${path}.outdoor must be true or false`);
  if (!Array.isArray(gridPosition) || gridPosition.length !== 2 || !gridPosition.every(Number.isInteger)) {
    errors.push(`${path}.gridPosition must be two integers [x, z]`);
  }
  if (typeof brief !== "string" || !brief.trim()) errors.push(`${path}.brief must be a non-empty string`);
  if (errors.length > before) return null;
  return { id: id as string, name: (name as string).trim(), outdoor: outdoor as boolean, gridPosition: gridPosition as [number, number], brief: (brief as string).trim() };
}

/** Checks the planner's JSON: shape, grid adjacency, and that every room can be reached from the start. */
export function parseHousePlan(value: unknown, roomCount?: number): { plan: HousePlan | null; errors: string[] } {
  const errors: string[] = [];
  if (!isFields(value)) return { plan: null, errors: ["The house must be a JSON object"] };

  const title = typeof value.title === "string" ? value.title.trim() : "";
  const story = typeof value.story === "string" ? value.story.trim() : "";
  if (!title) errors.push("title must be a non-empty string");
  if (!story) errors.push("story must be a non-empty string");

  const rawRooms = Array.isArray(value.rooms) ? value.rooms : [];
  if (roomCount ? rawRooms.length !== roomCount : rawRooms.length < MIN_ROOMS) {
    errors.push(roomCount ? `There must be exactly ${roomCount} rooms, got ${rawRooms.length}` : `There must be at least ${MIN_ROOMS} rooms, got ${rawRooms.length}`);
  }
  const rooms = rawRooms.flatMap((r, i) => parseRoom(r, i, errors) ?? []);

  const ids = new Set<string>();
  const cells = new Set<string>();
  for (const room of rooms) {
    if (ids.has(room.id)) errors.push(`Room id "${room.id}" is used twice`);
    if (cells.has(room.gridPosition.join(","))) errors.push(`Two rooms share gridPosition [${room.gridPosition}]`);
    ids.add(room.id);
    cells.add(room.gridPosition.join(","));
  }
  // The engine enters rooms[1] through rooms[0]'s north wall, i.e. the building's front door.
  if (rooms[0] && (!rooms[0].outdoor || rooms[0].gridPosition.join(",") !== "0,0")) errors.push("rooms[0] must be outdoors at gridPosition [0, 0]");
  if (rooms[1] && (rooms[1].outdoor || rooms[1].gridPosition.join(",") !== "0,-1")) errors.push("rooms[1] must be indoors at gridPosition [0, -1]");

  const grid = new Map(rooms.map((r) => [r.id, r.gridPosition]));
  const connections: ConnectionPlan[] = [];
  const pairs = new Set<string>();
  for (const [i, c] of (Array.isArray(value.connections) ? value.connections : []).entries()) {
    const path = `connections[${i}]`;
    if (!isFields(c) || typeof c.id !== "string" || !Array.isArray(c.roomIds) || c.roomIds.length !== 2) {
      errors.push(`${path} must be {"id": string, "roomIds": [string, string]}`);
      continue;
    }
    const [a, b] = c.roomIds as unknown[];
    if (typeof a !== "string" || typeof b !== "string" || !grid.has(a) || !grid.has(b) || a === b) {
      errors.push(`${path} "${c.id}" must join two different existing room ids`);
      continue;
    }
    const [ax, az] = grid.get(a)!;
    const [bx, bz] = grid.get(b)!;
    if (Math.abs(ax - bx) + Math.abs(az - bz) !== 1) {
      errors.push(`${path} "${c.id}": ${a} [${ax}, ${az}] and ${b} [${bx}, ${bz}] are not in neighboring grid cells`);
      continue;
    }
    const pair = [a, b].sort().join("|");
    if (pairs.has(pair)) errors.push(`${a} and ${b} are connected twice`);
    pairs.add(pair);
    connections.push({ id: c.id, roomIds: [a, b] });
  }

  if (rooms.length >= 2 && !pairs.has([rooms[0].id, rooms[1].id].sort().join("|"))) {
    errors.push(`rooms[0] "${rooms[0].id}" and rooms[1] "${rooms[1].id}" must be connected (the front door)`);
  }
  const reached = new Set(rooms[0] ? [rooms[0].id] : []);
  for (let grew = true; grew; ) {
    grew = false;
    for (const { roomIds: [a, b] } of connections) {
      if (reached.has(a) !== reached.has(b)) {
        reached.add(a).add(b);
        grew = true;
      }
    }
  }
  for (const room of rooms) if (!reached.has(room.id)) errors.push(`Room "${room.id}" can't be reached from rooms[0]`);

  if (errors.length > 0) return { plan: null, errors };
  return { plan: { title, story, rooms, connections }, errors };
}

/** The doors `roomId` needs, with walls worked out the same way the engine does. */
export function doorSlots(house: HousePlan, roomId: string): DoorSlot[] {
  const grid = new Map(house.rooms.map((r) => [r.id, r.gridPosition]));
  const names = new Map(house.rooms.map((r) => [r.id, r.name]));
  return house.connections
    .filter((c) => c.roomIds.includes(roomId))
    .map((c) => {
      const connection = new Connection(c, grid);
      return { connectionId: c.id, side: connection.sideIn(roomId)!, leadsTo: names.get(connection.otherRoom(roomId)) ?? "?" };
    });
}
