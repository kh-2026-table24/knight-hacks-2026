import { guessFootsteps } from "./footsteps";
import type { Issue } from "./issues";
import { nested, parseAmbient, parseCharacter, parseDamage, parseItem, parseLight, parseLines } from "./parseFeatures";
import { isFields, isNumber, Reader } from "./reader";
import {
  AMBIENCES,
  DEFAULTS,
  FOOTSTEPS,
  LIMITS,
  SHAPES,
  type ConnectionSpec,
  type DoorSpec,
  type GameSpec,
  type IntroSpec,
  type ObjectiveSpec,
  type PartSpec,
  type PickupSpec,
  type PropSpec,
  type RoomSpec,
  type Vec3,
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
  objectives: ObjectiveSpec[];
  /** Every room and connection parsed (other fields may still have errors). */
  complete: boolean;
}

export function parseGameSpec(value: unknown): ParsedGame {
  const r = new Reader();
  const parsedRooms: ParsedGame["rooms"] = [];
  const game = r.object(value, "", ["version", "title", "summary", "rooms", "connections", "objectives", "intro"]);
  if (!game) return { spec: undefined, issues: r.issues, rooms: parsedRooms, connections: [], objectives: [], complete: false };

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
  const objectives = game.array("objectives", (v, path) => parseObjective(r, v, path), { optional: true, max: LIMITS.objectives }) ?? [];
  const intro = game.has("intro") ? parseIntro(r, game.raw("intro"), game.at("intro")) : undefined;
  const [rawRooms, rawConnections] = [game.raw("rooms"), game.raw("connections") ?? []];
  const complete =
    Array.isArray(rawRooms) && parsedRooms.length === rawRooms.length && Array.isArray(rawConnections) && connections.length === rawConnections.length;

  const spec = r.errorCount === 0 && title && summary && rooms ? { version: 1 as const, title, summary, rooms, connections, objectives, ...(intro && { intro }) } : undefined;
  return { spec, issues: r.issues, rooms: parsedRooms, connections, objectives, complete };
}

/** Marks every issue found while parsing one room with that room's id, so it can be repaired on its own. */
function tagRoom<T>(r: Reader, value: unknown, parse: () => T): T {
  const before = r.issues.length;
  const result = parse();
  const id = isFields(value) && typeof value.id === "string" ? value.id : undefined;
  if (id) for (const issue of r.issues.slice(before)) issue.room = id;
  return result;
}

const ROOM_FIELDS = ["id", "name", "outdoor", "grid", "size", "start", "baseLight", "walls", "floor", "wallsTint", "floorTint", "footsteps", "ambience", "doors", "props", "characters", "pickups"];

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
  const wallsTint = o.color("wallsTint", { optional: true });
  const floorTint = o.color("floorTint", { optional: true });
  const footsteps = o.oneOf("footsteps", FOOTSTEPS, { optional: true }) ?? guessFootsteps(floor ?? "");
  const ambience = o.oneOf("ambience", AMBIENCES, { optional: true }) ?? DEFAULTS.ambience[outdoor ? "outdoor" : "indoor"];
  const doors = o.array("doors", (v, p) => parseDoor(r, v, p), { optional: true }) ?? [];
  const props = (o.array("props", (v, p) => parseProp(r, v, p), { optional: true }) ?? []).flat();
  if (props.length > LIMITS.propsPerRoom) o.error("props", `has ${props.length} props (counting copies); the limit is ${LIMITS.propsPerRoom}`);
  const characters = o.array("characters", (v, p) => parseCharacter(r, v, p), { optional: true, max: LIMITS.charactersPerRoom }) ?? [];
  const pickups = o.array("pickups", (v, p) => parsePickup(r, v, p), { optional: true, max: LIMITS.pickupsPerRoom }) ?? [];

  if (o.failed || !id || !name || !grid || !size || !start || !walls || !floor) return undefined;
  return {
    id, name, outdoor, grid, size, start, baseLight, walls, floor, ...(wallsTint && { wallsTint }), ...(floorTint && { floorTint }),
    footsteps, ambience, doors, props, characters, pickups,
  };
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

function parseObjective(r: Reader, value: unknown, path: string): ObjectiveSpec | undefined {
  const o = r.object(value, path, ["id", "text"]);
  if (!o) return undefined;
  const id = o.slug("id");
  const text = o.text("text", { max: LIMITS.objectiveLength });
  if (o.failed || !id || !text) return undefined;
  return { id, text };
}

function parseIntro(r: Reader, value: unknown, path: string): IntroSpec | undefined {
  const o = r.object(value, path, ["art", "text"]);
  if (!o) return undefined;
  const art = o.text("art", { max: LIMITS.introArtLength });
  const text = o.strings("text", { min: 1, max: LIMITS.introParagraphs, maxLength: LIMITS.introParagraphLength });
  if (o.failed || !art || !text) return undefined;
  return { art, text };
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

const PROP_FIELDS = ["id", "name", "position", "rotationY", "material", "parts", "copies", "light", "examine", "afterwards", "contains", "objective", "hazard", "ambient"];

/** A prop, followed by one prop per entry of its "copies". */
function parseProp(r: Reader, value: unknown, path: string): PropSpec[] | undefined {
  const o = r.object(value, path, PROP_FIELDS);
  if (!o) return undefined;
  const id = o.slug("id");
  // Not shown to the player; it doubles as the art prompt, so it gets the full text length.
  const name = o.text("name");
  const position = o.vec3("position");
  const rotationY = o.num("rotationY", { optional: true }) ?? 0;
  const material = o.text("material", { optional: true });
  const parts = o.array("parts", (v, p) => parsePart(r, v, p), { min: 1, max: LIMITS.partsPerProp });
  const copies = o.array("copies", (v, p) => parsePosition(r, v, p), { optional: true, min: 1 });
  const light = nested(o, "light", parseLight, r);
  const examine = parseLines(r, o, "examine", LIMITS.dialogueLines);
  const afterwards = parseLines(r, o, "afterwards", LIMITS.afterwardsLines);
  const contains = nested(o, "contains", parseItem, r);
  const objective = o.slug("objective", { optional: true });
  const hazard = nested(o, "hazard", parseDamage, r);
  const ambient = nested(o, "ambient", parseAmbient, r);
  if (parts && !material && parts.some((part) => part.shape !== "panel" && !part.material && !part.color)) {
    r.error(path, `${path} needs a "material" (what its box and wedge parts are made of), unless every box and wedge part has its own "material" or "color"`);
  }
  if (copies && (examine || contains)) o.error("copies", `can't be used on a prop with "examine" or "contains"; each thing the player can examine or search is its own prop`);
  if (objective && !examine && !contains) o.error("objective", `needs "examine" or "contains": the objective is set when the player examines or searches the prop`);
  if (o.failed || !id || !name || !position || !parts) return undefined;
  const prop: PropSpec = {
    id, name, position, rotationY, ...(material && { material }), parts,
    ...(light && { light }), ...(examine && { examine }), ...(afterwards && { afterwards }), ...(contains && { contains }), ...(objective && { objective }), ...(hazard && { hazard }), ...(ambient && { ambient }),
  };
  return [prop, ...(copies ?? []).map((at, i) => ({ ...prop, id: `${id}-copy-${i + 1}`, position: at }))];
}

function parsePosition(r: Reader, value: unknown, path: string): Vec3 | undefined {
  if (Array.isArray(value) && value.length === 3 && value.every(isNumber)) return [value[0], value[1], value[2]];
  r.error(path, `${path} must be an [x, y, z] position`);
  return undefined;
}

function parsePart(r: Reader, value: unknown, path: string): PartSpec | undefined {
  const o = r.object(value, path, ["shape", "position", "rotation", "size", "solid", "material", "color", "art", "frames", "tint"]);
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
  const tint = o.color("tint", { optional: true });
  const color = o.color("color", { optional: true });
  if (shape && panel && material) o.error("material", `is only for box and wedge parts; a panel's picture comes from "art" (or the prop's name)`);
  if (shape && panel && color) o.error("color", `is only for box and wedge parts; use "tint" to recolor a panel's picture`);
  if (shape && !panel && art) o.error("art", `is only for panels; box and wedge parts take a "material"`);
  if (shape && !panel && frames) o.error("frames", "is only for panels");
  if (size) {
    const [w, h, d] = size;
    if (w <= 0 || h <= 0 || d < 0 || (!panel && d <= 0)) o.error("size", `must be positive (panels use depth 0), got [${size.join(", ")}]`);
  }
  if (o.failed || !shape || !position || !size) return undefined;
  return {
    shape, position, rotation, size, solid,
    ...(material && { material }), ...(color && { color }), ...(art && { art }), ...(frames && { frames }), ...(tint && { tint }),
  };
}

function parsePickup(r: Reader, value: unknown, path: string): PickupSpec | undefined {
  const o = r.object(value, path, ["id", "item", "position", "objective"]);
  if (!o) return undefined;
  const id = o.slug("id");
  if (!o.has("item")) o.error("item", "is required");
  const item = nested(o, "item", parseItem, r);
  const position = o.vec3("position");
  const objective = o.slug("objective", { optional: true });
  if (o.failed || !id || !item || !position) return undefined;
  return { id, item, position, ...(objective && { objective }) };
}
