import { Box3, Vector3 } from "three";
import type { Side } from "../Connection";
import { placeItem, wallItems, WALL_THICKNESS, type PlacedPart } from "./buildRoom";
import type { DoorSlot } from "./output/housePlan";
import type { RoomPlan } from "./output/roomPlan";
import { buildWalkGrid, MAX_STEP } from "./walkGrid";

const REACH = 1.5; // how close the player must get to an item for it to count as reachable
const TOLERANCE = 0.05; // ignore tiny overhangs from rounding
const MIN_OVERLAP = 0.2; // parts must interpenetrate this deep on every axis to count as overlapping
const MAX_OVERLAP_ERRORS = 8;
// Matches Door.ts: doors stand 0.31 m in from their wall, south exits are a 0.8 m floor strip,
// and the player arrives 1 m in front of the door.
const DOOR_INSET = 0.31;
const EXIT_DEPTH = 0.8;
const ARRIVAL_DISTANCE = 1;
const DOOR_EDGE_MARGIN = 1;

export interface LayoutReport {
  /** Must be fixed; sent back to Claude for repair. */
  errors: string[];
  /** Worth knowing, not worth a retry. */
  warnings: string[];
}

export interface LayoutContext {
  outdoor: boolean;
  doors: DoorSlot[];
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

function distanceXZ(box: Box3, x: number, z: number) {
  return Math.hypot(Math.max(box.min.x - x, 0, x - box.max.x), Math.max(box.min.z - z, 0, z - box.max.z));
}

// A fixed depth would never flag thin parts (a 6 cm tabletop), so the threshold shrinks to half
// the thinner part on each axis. Touching or resting (zero penetration) never counts.
function penetratesOnAxis(aMin: number, aMax: number, bMin: number, bMax: number) {
  const depth = Math.min(aMax, bMax) - Math.max(aMin, bMin);
  return depth > Math.min(MIN_OVERLAP, 0.5 * Math.min(aMax - aMin, bMax - bMin));
}

function overlaps(a: Box3, b: Box3) {
  return (
    penetratesOnAxis(a.min.x, a.max.x, b.min.x, b.max.x) &&
    penetratesOnAxis(a.min.y, a.max.y, b.min.y, b.max.y) &&
    penetratesOnAxis(a.min.z, a.max.z, b.min.z, b.max.z)
  );
}

function describeOutside(b: Box3, room: Box3): string[] {
  const out: string[] = [];
  if (b.min.x < room.min.x - TOLERANCE) out.push(`reaches x=${fmt(b.min.x)} but the floor starts at x=${fmt(room.min.x)}`);
  if (b.max.x > room.max.x + TOLERANCE) out.push(`reaches x=${fmt(b.max.x)} but the floor ends at x=${fmt(room.max.x)}`);
  if (b.min.z < room.min.z - TOLERANCE) out.push(`reaches z=${fmt(b.min.z)} but the floor starts at z=${fmt(room.min.z)}`);
  if (b.max.z > room.max.z + TOLERANCE) out.push(`reaches z=${fmt(b.max.z)} but the floor ends at z=${fmt(room.max.z)}`);
  if (b.min.y < -TOLERANCE) out.push(`goes below the floor (y=${fmt(b.min.y)})`);
  if (b.max.y > room.max.y + TOLERANCE) out.push(`reaches y=${fmt(b.max.y)}, above the ceiling at ${fmt(room.max.y)}`);
  return out;
}

/** Where the player appears when arriving through a door, mirroring Door.arrivalPoint. */
function arrivalPoint(side: Side, offset: number, w: number, d: number): [number, number] {
  switch (side) {
    case "north":
      return [offset, DOOR_INSET + ARRIVAL_DISTANCE];
    case "south":
      return [offset, d - EXIT_DEPTH - ARRIVAL_DISTANCE];
    case "east":
      return [w - DOOR_INSET - ARRIVAL_DISTANCE, offset];
    case "west":
      return [DOOR_INSET + ARRIVAL_DISTANCE, offset];
  }
}

/** Checks that a parsed plan is a playable room. Error messages are written for Claude to act on. */
export function checkLayout(plan: RoomPlan, context: LayoutContext): LayoutReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const [w, h, d] = plan.dimensions;
  const side = context.outdoor ? 0 : WALL_THICKNESS;
  const interior = new Box3(new Vector3(side, 0, WALL_THICKNESS), new Vector3(w - side, h, d));

  const items = plan.items.map((item, i) => {
    const label = `items[${i}] "${item.name}"`;
    const parts = placeItem(item, label);
    const bounds = new Box3();
    for (const p of parts) bounds.union(p.box);
    return { label, bounds, solids: parts.filter((p) => p.part.collisionsEnabled) };
  });
  const walls: PlacedPart[] = wallItems(plan, context.outdoor).flatMap((wall) => placeItem(wall, `the ${wall.name}`));

  for (const item of items) {
    const outside = describeOutside(item.bounds, interior);
    if (outside.length) errors.push(`${item.label} sticks out of the room: it ${outside.join("; ")}`);
    if (item.bounds.max.y > 2.5 && item.bounds.min.z > d - 3) {
      warnings.push(`${item.label} is tall and close to the camera side, so it may block the view`);
    }
  }

  const overlapErrors: string[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (items[i].solids.some((a) => items[j].solids.some((b) => overlaps(a.box, b.box)))) {
        overlapErrors.push(`${items[i].label} and ${items[j].label} intersect; move them apart or make them smaller`);
      }
    }
  }
  errors.push(...overlapErrors.slice(0, MAX_OVERLAP_ERRORS));
  if (overlapErrors.length > MAX_OVERLAP_ERRORS) errors.push(`...and ${overlapErrors.length - MAX_OVERLAP_ERRORS} more intersecting pairs`);

  // Each required connection gets exactly one door, at a sensible place along its wall.
  const doors = context.doors.flatMap((slot) => {
    const placed = plan.doors.filter((door) => door.connectionId === slot.connectionId);
    if (placed.length !== 1) {
      errors.push(`doors must contain exactly one entry with connectionId "${slot.connectionId}" (the ${slot.side} door to ${slot.leadsTo}), found ${placed.length}`);
      return [];
    }
    const along = slot.side === "north" || slot.side === "south" ? w : d;
    const { offset } = placed[0];
    if (offset < DOOR_EDGE_MARGIN || offset > along - DOOR_EDGE_MARGIN) {
      errors.push(`The ${slot.side} door to ${slot.leadsTo} has offset ${fmt(offset)}; it must be between ${DOOR_EDGE_MARGIN} and ${fmt(along - DOOR_EDGE_MARGIN)}`);
      return [];
    }
    return [{ slot, offset }];
  });
  for (const door of plan.doors) {
    if (!context.doors.some((slot) => slot.connectionId === door.connectionId)) errors.push(`doors has unknown connectionId "${door.connectionId}"; remove it`);
  }

  const grid = buildWalkGrid([...walls, ...items.flatMap((item) => item.solids)], w, d);
  const [sx, sy, sz] = plan.startPosition;
  if (Math.abs(sy) > TOLERANCE) errors.push(`startPosition y must be 0 (the floor), got ${fmt(sy)}`);
  if (sz < d / 2) warnings.push("startPosition is in the north half of the room; the south (camera) side is better");

  if (!grid.floodFrom(sx, sz)) {
    const blockers = grid.blockersAt(sx, sz);
    const reason = blockers.length ? `it is inside or touching ${blockers.join(", ")}` : "it is outside the room or too close to its edge";
    errors.push(`startPosition [${plan.startPosition.map(fmt).join(", ")}] is not open floor: ${reason}. Move it to open floor near the south side.`);
    // Reachability can't be judged without a valid start.
    return { errors, warnings };
  }

  for (const item of items) {
    if (!grid.someReached((x, z) => distanceXZ(item.bounds, x, z) <= REACH)) {
      errors.push(`${item.label} can't be reached: nowhere the player can walk comes within ${REACH} m of it. Open a path at least 1.2 m wide, or add stairs (steps up to ${MAX_STEP} m, slopes up to 50°).`);
    }
  }

  for (const { slot, offset } of doors) {
    const [ax, az] = arrivalPoint(slot.side, offset, w, d);
    const near = (x: number, z: number, y: number) => y <= MAX_STEP && Math.hypot(x - ax, z - az) <= 0.3;
    if (!grid.standableAtFloor(ax, az) || !grid.someReached(near)) {
      const blockers = grid.blockersAt(ax, az);
      errors.push(
        `The ${slot.side} door to ${slot.leadsTo} (offset ${fmt(offset)}) is blocked: the player arrives at x=${fmt(ax)}, z=${fmt(az)}, ` +
          `which must be open floor reachable from the start${blockers.length ? `, but ${blockers.join(", ")} is in the way` : ""}. Clear the floor in front of the door or move the door.`,
      );
    }
  }

  if (grid.reachedCount < grid.standableCount * 0.6) {
    warnings.push(`Only ${Math.round((grid.reachedCount / grid.standableCount) * 100)}% of the walkable area is reachable from the start; parts of the room are cut off`);
  }
  if (plan.items.length < 5) warnings.push(`Only ${plan.items.length} items; the room may feel empty`);

  return { errors, warnings };
}
