import type { Issue } from "./issues";
import { nested, parseAmbient, parseCharacter, parseConversation, parseDamage, parseItem, parseLight } from "./parseFeatures";
import { isFields, Reader } from "./reader";
import {
  DEFAULTS,
  LIMITS,
  SHAPES,
  type ConnectionSpec,
  type DoorSpec,
  type GameSpec,
  type PartSpec,
  type PickupSpec,
  type PropSpec,
  type RoomSpec,
} from "./spec";

// Turns untrusted JSON into a GameSpec: every field's type and range, unknown fields (a misspelled field
// would otherwise be silently ignored), and defaults. Layout and cross-room rules are checked later,
// by checkRoom and checkGame. Characters, items, lights and the like are in parseFeatures.ts.

export interface ParsedGame {
  /** Only set when there were no errors. */
  spec: GameSpec | undefined;
  issues: Issue[];
  /** The rooms that parsed, with their index in the input, so their layout can be checked even if others failed. */
  rooms: { index: number; room: RoomSpec }[];
  connections: ConnectionSpec[];
  /** Every room and connection parsed (other fields may still have errors). */
  complete: boolean;
}

export function parseGameSpec(value: unknown): ParsedGame {
  const r = new Reader();
  const parsedRooms: ParsedGame["rooms"] = [];
  const game = r.object(value, "", ["version", "title", "summary", "rooms", "connections"]);
  if (!game) return { spec: undefined, issues: r.issues, rooms: parsedRooms, connections: [], complete: false };

  const version = game.num("version");
  if (version !== undefined && version !== 1) game.error("version", `must be 1, got ${version}`);
  const title = game.text("title", { max: 120 });
  const summary = game.text("summary", { max: 1500 });
  let index = 0;
  const rooms = game.array(
    "rooms",
    (v, path) => {
      const i = index++;
      const room = tagRoom(r, v, () => parseRoom(r, v, path));
      if (room) parsedRooms.push({ index: i, room });
      return room;
    },
    { min: 1, max: LIMITS.rooms },
  );
  const connections = game.array("connections", (v, path) => parseConnection(r, v, path), { optional: true }) ?? [];
  const [rawRooms, rawConnections] = [game.raw("rooms"), game.raw("connections") ?? []];
  const complete =
    Array.isArray(rawRooms) && parsedRooms.length === rawRooms.length && Array.isArray(rawConnections) && connections.length === rawConnections.length;

  const spec = r.errorCount === 0 && title && summary && rooms ? { version: 1 as const, title, summary, rooms, connections } : undefined;
  return { spec, issues: r.issues, rooms: parsedRooms, connections, complete };
}

/** Marks every issue found while parsing one room with that room's id, so it can be repaired on its own. */
function tagRoom<T>(r: Reader, value: unknown, parse: () => T): T {
  const before = r.issues.length;
  const result = parse();
  const id = isFields(value) && typeof value.id === "string" ? value.id : undefined;
  if (id) for (const issue of r.issues.slice(before)) issue.room = id;
  return result;
}

const ROOM_FIELDS = ["id", "name", "outdoor", "grid", "size", "start", "baseLight", "walls", "floor", "doors", "props", "characters", "pickups"];

/** Parses one room. Exported for room-scoped repair, where Claude returns replacement rooms. */
export function parseRoom(r: Reader, value: unknown, path: string): RoomSpec | undefined {
  const o = r.object(value, path, ROOM_FIELDS);
  if (!o) return undefined;
  const id = o.slug("id");
  const name = o.text("name", { max: 120 });
  const outdoor = o.bool("outdoor", { optional: true }) ?? false;
  const grid = o.vec2("grid");
  if (grid && !grid.every(Number.isInteger)) o.error("grid", `must be two whole numbers [x, z], got [${grid.join(", ")}]`);
  const size = o.vec3("size");
  if (size) {
    const [w, h, d] = size;
    const [minSide, maxSide] = LIMITS.roomSide;
    const [minHeight, maxHeight] = LIMITS.roomHeight;
    if (w < minSide || w > maxSide || d < minSide || d > maxSide) o.error("size", `[W, H, D]: W and D must be from ${minSide} to ${maxSide}, got W=${w}, D=${d}`);
    if (h < minHeight || h > maxHeight) o.error("size", `[W, H, D]: H must be from ${minHeight} to ${maxHeight}, got ${h}`);
  }
  const start = o.vec2("start");
  const baseLight = o.num("baseLight", { optional: true, min: 0, max: 1 }) ?? DEFAULTS.baseLight;
  const walls = o.text("walls");
  const floor = o.text("floor");
  const doors = o.array("doors", (v, p) => parseDoor(r, v, p), { optional: true }) ?? [];
  const props = o.array("props", (v, p) => parseProp(r, v, p), { optional: true, max: LIMITS.propsPerRoom }) ?? [];
  const characters = o.array("characters", (v, p) => parseCharacter(r, v, p), { optional: true, max: LIMITS.charactersPerRoom }) ?? [];
  const pickups = o.array("pickups", (v, p) => parsePickup(r, v, p), { optional: true, max: LIMITS.pickupsPerRoom }) ?? [];

  if (o.failed || !id || !name || !grid || !size || !start || !walls || !floor) return undefined;
  return { id, name, outdoor, grid, size, start, baseLight, walls, floor, doors, props, characters, pickups };
}

function parseConnection(r: Reader, value: unknown, path: string): ConnectionSpec | undefined {
  const o = r.object(value, path, ["id", "rooms", "locked"]);
  if (!o) return undefined;
  const id = o.slug("id");
  const rooms = o.strings("rooms", { min: 2, max: 2 });
  const locked = o.bool("locked", { optional: true }) ?? false;
  if (o.failed || !id || !rooms) return undefined;
  return { id, rooms: [rooms[0], rooms[1]], locked };
}

function parseDoor(r: Reader, value: unknown, path: string): DoorSpec | undefined {
  const o = r.object(value, path, ["connection", "offset", "art"]);
  if (!o) return undefined;
  const connection = o.slug("connection");
  const offset = o.num("offset");
  const art = o.text("art", { optional: true });
  if (o.failed || !connection || offset === undefined) return undefined;
  return { connection, offset, ...(art && { art }) };
}

const PROP_FIELDS = ["id", "name", "position", "rotationY", "material", "parts", "light", "examine", "contains", "hazard", "ambient"];

function parseProp(r: Reader, value: unknown, path: string): PropSpec | undefined {
  const o = r.object(value, path, PROP_FIELDS);
  if (!o) return undefined;
  const id = o.slug("id");
  const name = o.text("name", { max: 160 });
  const position = o.vec3("position");
  const rotationY = o.num("rotationY", { optional: true }) ?? 0;
  const material = o.text("material", { optional: true });
  const parts = o.array("parts", (v, p) => parsePart(r, v, p), { min: 1, max: LIMITS.partsPerProp });
  const light = nested(o, "light", parseLight, r);
  const examine = o.array("examine", (v, p) => parseConversation(r, v, p), { optional: true, min: 1, max: LIMITS.conversations });
  const contains = nested(o, "contains", parseItem, r);
  const hazard = nested(o, "hazard", parseDamage, r);
  const ambient = nested(o, "ambient", parseAmbient, r);
  if (parts && !material && parts.some((part) => part.shape !== "panel" && !part.material)) {
    r.error(path, `${path} needs a "material" (what its box and wedge parts are made of), unless every box and wedge part has its own`);
  }
  if (o.failed || !id || !name || !position || !parts) return undefined;
  return {
    id, name, position, rotationY, ...(material && { material }), parts,
    ...(light && { light }), ...(examine && { examine }), ...(contains && { contains }), ...(hazard && { hazard }), ...(ambient && { ambient }),
  };
}

function parsePart(r: Reader, value: unknown, path: string): PartSpec | undefined {
  const o = r.object(value, path, ["shape", "position", "rotation", "size", "solid", "material", "art", "frames"]);
  if (!o) return undefined;
  const shape = o.oneOf("shape", SHAPES);
  const position = o.vec3("position");
  const rotation = o.vec3("rotation", { optional: true }) ?? [0, 0, 0];
  const size = o.vec3("size");
  const panel = shape === "panel";
  const solid = o.bool("solid", { optional: true }) ?? !panel;
  const material = o.text("material", { optional: true });
  const art = o.text("art", { optional: true });
  const frames = o.strings("frames", { optional: true, min: 1, max: LIMITS.framesPerState - 1 });
  if (shape && panel && material) o.error("material", `is only for box and wedge parts; a panel's picture comes from "art" (or the prop's name)`);
  if (shape && !panel && art) o.error("art", `is only for panels; box and wedge parts take a "material"`);
  if (shape && !panel && frames) o.error("frames", "is only for panels");
  if (size) {
    const [w, h, d] = size;
    if (w <= 0 || h <= 0 || d < 0 || (!panel && d <= 0)) o.error("size", `must be positive (panels use depth 0), got [${size.join(", ")}]`);
  }
  if (o.failed || !shape || !position || !size) return undefined;
  return { shape, position, rotation, size, solid, ...(material && { material }), ...(art && { art }), ...(frames && { frames }) };
}

function parsePickup(r: Reader, value: unknown, path: string): PickupSpec | undefined {
  const o = r.object(value, path, ["id", "item", "position"]);
  if (!o) return undefined;
  const id = o.slug("id");
  if (!o.has("item")) o.error("item", "is required");
  const item = nested(o, "item", parseItem, r);
  const position = o.vec3("position");
  if (o.failed || !id || !item || !position) return undefined;
  return { id, item, position };
}
