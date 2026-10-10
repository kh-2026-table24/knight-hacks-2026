import type { Vector3Tuple } from "three";
import { ObjectType } from "./output";

// What Claude writes for one room: named items, each built from primitives in the item's own
// local frame. buildRoom.ts turns each item into a Group in the engine's Room format. Keeping
// local and room coordinates separate is what makes the layout math tractable for an LLM.

export interface PartPlan {
  type: ObjectType;
  /** Bottom-center of the part, relative to the item's origin. */
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: Vector3Tuple;
  collisionsEnabled: boolean;
  /** Overrides the item's material for this part (the cake on a workbench). */
  material?: string;
}

export interface ItemPlan {
  name: string;
  /** Where the item's origin sits in room coordinates. */
  position: Vector3Tuple;
  rotationY: number;
  parts: PartPlan[];
  /** What its box and wedge surfaces are made of; becomes their tileable texture. */
  material?: string;
}

/** Where along its wall a door goes; the wall itself comes from the map grid. */
export interface DoorPlan {
  connectionId: string;
  offset: number;
}

export interface RoomPlan {
  title: string;
  wallDescription: string;
  floorDescription: string;
  dimensions: Vector3Tuple;
  startPosition: Vector3Tuple;
  items: ItemPlan[];
  doors: DoorPlan[];
}

// Looser than what the prompt asks for, so reasonable output isn't rejected over small misses.
export const PLAN_LIMITS = { minSide: 6, maxSide: 30, minHeight: 3, maxHeight: 10, maxItems: 40, maxParts: 16 };

const TYPES = new Set<unknown>(Object.values(ObjectType));

type Fields = Record<string, unknown>;
const isFields = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const optionalText = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function vec3(value: unknown, path: string, errors: string[]): Vector3Tuple | null {
  if (Array.isArray(value) && value.length === 3 && value.every(isNumber)) return [value[0], value[1], value[2]];
  errors.push(`${path} must be an array of 3 numbers`);
  return null;
}

function parsePart(value: unknown, path: string, errors: string[]): PartPlan | null {
  if (!isFields(value)) {
    errors.push(`${path} must be an object`);
    return null;
  }
  const before = errors.length;

  const type = value.type;
  if (!TYPES.has(type)) errors.push(`${path}.type must be "rectPrism", "rightTriPrism" or "plane"`);
  const position = vec3(value.position, `${path}.position`, errors);
  const scale = vec3(value.scale, `${path}.scale`, errors);
  const rotation = value.rotation === undefined ? [0, 0, 0] : vec3(value.rotation, `${path}.rotation`, errors);
  const collisions = value.collisions ?? true;
  if (typeof collisions !== "boolean") errors.push(`${path}.collisions must be true or false`);

  if (scale) {
    const [w, h, d] = scale;
    const flat = type === ObjectType.Plane;
    if (w <= 0 || h <= 0 || d < 0 || (!flat && d <= 0)) {
      errors.push(`${path}.scale must be positive (planes may have depth 0), got [${scale.join(", ")}]`);
    }
  }

  if (errors.length > before || !position || !scale || !rotation) return null;
  return { type: type as ObjectType, position, rotation: rotation as Vector3Tuple, scale, collisionsEnabled: collisions as boolean, material: optionalText(value.material) };
}

function parseItem(value: unknown, index: number, errors: string[]): ItemPlan | null {
  if (!isFields(value)) {
    errors.push(`items[${index}] must be an object`);
    return null;
  }
  const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : null;
  // Name the item in every message so Claude can find it when repairing.
  const path = name ? `items[${index}] "${name}"` : `items[${index}]`;
  const before = errors.length;

  if (!name) errors.push(`${path}.name must be a non-empty string`);
  const position = vec3(value.position, `${path}.position`, errors);
  const rotationY = value.rotationY ?? 0;
  if (!isNumber(rotationY)) errors.push(`${path}.rotationY must be a number`);

  const parts: PartPlan[] = [];
  if (!Array.isArray(value.parts) || value.parts.length === 0) {
    errors.push(`${path}.parts must be a non-empty array`);
  } else if (value.parts.length > PLAN_LIMITS.maxParts) {
    errors.push(`${path} has ${value.parts.length} parts; the limit is ${PLAN_LIMITS.maxParts}`);
  } else {
    value.parts.forEach((p, i) => {
      const part = parsePart(p, `${path}.parts[${i}]`, errors);
      if (part) parts.push(part);
    });
  }

  if (errors.length > before || !name || !position) return null;
  return { name, position, rotationY: rotationY as number, parts, material: optionalText(value.material) };
}

function parseDoors(value: unknown, errors: string[]): DoorPlan[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push("doors must be an array");
    return [];
  }
  return value.flatMap((d, i) => {
    if (isFields(d) && typeof d.connectionId === "string" && isNumber(d.offset)) return [{ connectionId: d.connectionId, offset: d.offset }];
    errors.push(`doors[${i}] must be {"connectionId": string, "offset": number}`);
    return [];
  });
}

/** Checks the shape of Claude's JSON. Geometry and doors are checkLayout's job. */
export function parseRoomPlan(value: unknown): { plan: RoomPlan | null; errors: string[] } {
  const errors: string[] = [];
  if (!isFields(value)) return { plan: null, errors: ["The room must be a JSON object"] };

  const text = (key: string, required: boolean) => {
    const v = value[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (required) errors.push(`${key} must be a non-empty string`);
    return "";
  };
  const title = text("title", true);
  const wallDescription = text("wallDescription", false);
  const floorDescription = text("floorDescription", false);

  const dimensions = vec3(value.dimensions, "dimensions", errors);
  if (dimensions) {
    const [w, h, d] = dimensions;
    const { minSide, maxSide, minHeight, maxHeight } = PLAN_LIMITS;
    if (w < minSide || w > maxSide || d < minSide || d > maxSide) {
      errors.push(`dimensions [W, H, D]: W and D must be between ${minSide} and ${maxSide}, got W=${w}, D=${d}`);
    }
    if (h < minHeight || h > maxHeight) errors.push(`dimensions [W, H, D]: H must be between ${minHeight} and ${maxHeight}, got ${h}`);
  }
  const startPosition = vec3(value.startPosition, "startPosition", errors);

  const items: ItemPlan[] = [];
  if (!Array.isArray(value.items) || value.items.length === 0) {
    errors.push("items must be a non-empty array");
  } else if (value.items.length > PLAN_LIMITS.maxItems) {
    errors.push(`There are ${value.items.length} items; the limit is ${PLAN_LIMITS.maxItems}`);
  } else {
    value.items.forEach((item, i) => {
      const parsed = parseItem(item, i, errors);
      if (parsed) items.push(parsed);
    });
  }
  const doors = parseDoors(value.doors, errors);

  if (errors.length > 0 || !dimensions || !startPosition) return { plan: null, errors };
  return { plan: { title, wallDescription, floorDescription, dimensions, startPosition, items, doors }, errors };
}
