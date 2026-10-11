import { Box3, Vector3 } from "three";
import { DOOR, INTERACT, PICKUP, PLAYER, REACH, WALL_THICKNESS } from "./constants";
import { arrivalPoint, boundsOf, distanceXZ, placeProp, roomWalls, wallLength, type Side } from "./geometry";
import type { Issue } from "./issues";
import { LIMITS, type DoorSpec, type RoomSpec, type Vec2 } from "./spec";
import { buildWalkGrid, type WalkGrid } from "./walkGrid";

// Checks that a parsed room is playable: everything fits, nothing passes through anything else, and the
// player can reach the start, every door, every prop, every character they can talk to and every
// pickup. Messages are written for Claude to act on, starting with the path of what to fix.

const TOLERANCE = 0.05; // ignore tiny overhangs from rounding
const MIN_OVERLAP = 0.2; // solids must interpenetrate this deep on every axis to count as overlapping
const MAX_OVERLAP_ERRORS = 8;
const MIN_PROPS = 5;
// Hostile characters that don't chase still shouldn't start this close to where the player appears.
const HOSTILE_MARGIN = 2;
const HAZARD_MARGIN = 0.5;
const MAX_STEP = PLAYER.stepHeight;

export interface RoomContext {
  /** Where the room sits in the game, e.g. rooms[2](study). Every message starts with it. */
  path: string;
  /** The wall each connection touching this room leaves through. */
  sides: Map<string, Side>;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);
const fmtPoint = (p: number[]) => `[${p.map(fmt).join(", ")}]`;

// A fixed depth would never flag thin parts (a 6 cm tabletop), so the threshold shrinks to half the
// thinner part on each axis. Touching or resting (zero penetration) never counts.
function penetratesOnAxis(aMin: number, aMax: number, bMin: number, bMax: number) {
  const depth = Math.min(aMax, bMax) - Math.max(aMin, bMin);
  return depth > Math.min(MIN_OVERLAP, 0.5 * Math.min(aMax - aMin, bMax - bMin));
}

/** Whether two solids pass through each other (resting on or touching doesn't count). */
export function overlaps(a: Box3, b: Box3) {
  return (
    penetratesOnAxis(a.min.x, a.max.x, b.min.x, b.max.x) &&
    penetratesOnAxis(a.min.y, a.max.y, b.min.y, b.max.y) &&
    penetratesOnAxis(a.min.z, a.max.z, b.min.z, b.max.z)
  );
}

function describeOutside(b: Box3, room: Box3): string[] {
  const out: string[] = [];
  if (b.min.x < room.min.x - TOLERANCE) out.push(`reaches x=${fmt(b.min.x)} but the usable floor starts at x=${fmt(room.min.x)}`);
  if (b.max.x > room.max.x + TOLERANCE) out.push(`reaches x=${fmt(b.max.x)} but the usable floor ends at x=${fmt(room.max.x)}`);
  if (b.min.z < room.min.z - TOLERANCE) out.push(`reaches z=${fmt(b.min.z)} but the usable floor starts at z=${fmt(room.min.z)}`);
  if (b.max.z > room.max.z + TOLERANCE) out.push(`reaches z=${fmt(b.max.z)} but the usable floor ends at z=${fmt(room.max.z)}`);
  if (b.min.y < -TOLERANCE) out.push(`goes below the floor (y=${fmt(b.min.y)})`);
  if (b.max.y > room.max.y + TOLERANCE) out.push(`reaches y=${fmt(b.max.y)}, above the ceiling at ${fmt(room.max.y)}`);
  return out;
}

/** The engine's [E] rule: within INTERACT.range horizontally, and not too far above the player's feet. */
const canInteract = (grid: WalkGrid, box: Box3) =>
  grid.someReached((x, z, y) => distanceXZ(box, x, z) <= INTERACT.range && box.min.y <= y + INTERACT.maxHeightAboveFeet + TOLERANCE);

export function checkRoom(room: RoomSpec, ctx: RoomContext): Issue[] {
  const issues: Issue[] = [];
  const error = (path: string, message: string) => issues.push({ severity: "error", room: room.id, path, message });
  const warn = (path: string, message: string) => issues.push({ severity: "warning", room: room.id, path, message });
  const at = (sub: string) => `${ctx.path}.${sub}`;
  const [w, h, d] = room.size;
  const sideWall = room.outdoor ? 0 : WALL_THICKNESS;
  const interior = new Box3(new Vector3(sideWall, 0, WALL_THICKNESS), new Vector3(w - sideWall, h, d));
  const onFloorPlan = (x: number, y: number, z: number) =>
    x >= interior.min.x - TOLERANCE && x <= interior.max.x + TOLERANCE && z >= interior.min.z - TOLERANCE && z <= interior.max.z + TOLERANCE && y >= -TOLERANCE && y <= h;
  const floorPlan = `x ${fmt(interior.min.x)} to ${fmt(interior.max.x)}, z ${fmt(interior.min.z)} to ${fmt(interior.max.z)}`;

  const props = room.props.map((prop, i) => {
    const label = at(`props[${i}](${prop.id})`);
    const parts = placeProp(prop, label);
    return { prop, label, bounds: boundsOf(parts), solids: parts.filter((p) => p.part.solid) };
  });
  const walls = roomWalls(room).flatMap((wall) => placeProp(wall, `the ${wall.name}`));

  for (const p of props) {
    const outside = describeOutside(p.bounds, interior);
    if (outside.length) error(p.label, `${p.label} sticks out of the room: it ${outside.join("; ")}`);
    if (p.bounds.max.y > 2.5 && p.bounds.min.z > d - 3) warn(p.label, `${p.label} is tall and close to the camera side, so it may block the view`);
  }
  room.characters.forEach((c, i) => {
    if (!onFloorPlan(...c.position)) error(at(`characters[${i}](${c.id})`), `${at(`characters[${i}](${c.id})`)} stands at ${fmtPoint(c.position)}, outside the usable floor (${floorPlan})`);
  });
  room.pickups.forEach((p, i) => {
    if (!onFloorPlan(...p.position)) error(at(`pickups[${i}](${p.id})`), `${at(`pickups[${i}](${p.id})`)} is at ${fmtPoint(p.position)}, outside the usable floor (${floorPlan})`);
  });

  const overlapErrors: [string, string][] = [];
  for (let i = 0; i < props.length; i++) {
    for (let j = i + 1; j < props.length; j++) {
      if (props[i].solids.some((a) => props[j].solids.some((b) => overlaps(a.box, b.box)))) {
        overlapErrors.push([props[i].label, `${props[i].label} and ${props[j].label} intersect; move them apart or make them smaller`]);
      }
    }
  }
  for (const [path, message] of overlapErrors.slice(0, MAX_OVERLAP_ERRORS)) error(path, message);
  if (overlapErrors.length > MAX_OVERLAP_ERRORS) error(at("props"), `...and ${overlapErrors.length - MAX_OVERLAP_ERRORS} more intersecting pairs`);

  // Each connection touching the room gets exactly one door, at a sensible place along its wall.
  const doors: { door: DoorSpec; side: Side; label: string }[] = [];
  for (const [connection, side] of ctx.sides) {
    const matching = room.doors.filter((door) => door.connection === connection);
    if (matching.length !== 1) {
      error(at("doors"), `${at("doors")} must contain exactly one door with connection "${connection}" (on the ${side} wall), found ${matching.length}`);
      continue;
    }
    const door = matching[0];
    const label = at(`doors[${room.doors.indexOf(door)}]`);
    const along = wallLength(room, side);
    if (door.offset < DOOR.edgeMargin || door.offset > along - DOOR.edgeMargin) {
      error(label, `${label} (the ${side} door, connection "${connection}") has offset ${fmt(door.offset)}; it must be from ${DOOR.edgeMargin} to ${fmt(along - DOOR.edgeMargin)}`);
      continue;
    }
    doors.push({ door, side, label });
  }
  room.doors.forEach((door, i) => {
    if (!ctx.sides.has(door.connection)) error(at(`doors[${i}]`), `${at(`doors[${i}]`)} uses connection "${door.connection}", which doesn't join this room; remove it`);
  });

  const grid = buildWalkGrid([...walls, ...props.flatMap((p) => p.solids)], w, d);
  const [sx, sz] = room.start;
  if (sz < d / 2) warn(at("start"), `${at("start")} is in the north half of the room; the south (camera) side is better`);
  if (!grid.floodFrom(sx, sz)) {
    const blockers = grid.blockersAt(sx, sz);
    const reason = blockers.length ? `it is inside or touching ${blockers.join(", ")}` : "it is outside the room or too close to its edge";
    error(at("start"), `${at("start")} ${fmtPoint(room.start)} is not open floor: ${reason}. Move it to open floor near the south side.`);
    // Reachability can't be judged without a valid start.
    return issues;
  }

  for (const p of props) {
    if (p.prop.examine || p.prop.contains) {
      if (!canInteract(grid, p.bounds)) {
        const verb = p.prop.examine ? "examined" : "searched";
        error(p.label, `${p.label} can't be ${verb}: the player must be able to stand within ${INTERACT.range} m of it, with its bottom no more than ${INTERACT.maxHeightAboveFeet} m above their feet. Open a path to it, or lower it.`);
      }
    } else if (!grid.someReached((x, z) => distanceXZ(p.bounds, x, z) <= REACH)) {
      // Scenery the player can't walk up to doesn't stop the game, so it's only worth a mention.
      warn(p.label, `${p.label} can't be reached: nowhere the player can walk comes within ${REACH} m of it. Open a path at least 1.2 m wide, or add stairs (steps up to ${MAX_STEP} m, slopes up to ${PLAYER.maxSlopeDeg}°).`);
    }
  }

  for (const { door, side, label } of doors) {
    const [ax, az] = arrivalPoint(room, door, side);
    const near = (x: number, z: number, y: number) => y <= MAX_STEP && Math.hypot(x - ax, z - az) <= 0.3;
    if (!grid.standableAtFloor(ax, az) || !grid.someReached(near)) {
      const blockers = grid.blockersAt(ax, az);
      error(
        label,
        `${label} (the ${side} door, connection "${door.connection}", offset ${fmt(door.offset)}) is blocked: the player arrives at x=${fmt(ax)}, z=${fmt(az)}, ` +
          `which must be open floor reachable from the start${blockers.length ? `, but ${blockers.join(", ")} is in the way` : ""}. Clear the floor in front of the door or move the door.`,
      );
    }
  }

  room.characters.forEach((c, i) => {
    const label = at(`characters[${i}](${c.id})`);
    const [x, y, z] = c.position;
    if (!grid.heightsAt(x, z).some((height) => Math.abs(height - y) <= TOLERANCE)) {
      const blockers = grid.blockersAt(x, z);
      error(label, `${label} can't stand at ${fmtPoint(c.position)}: there is no open ${y > TOLERANCE ? "platform" : "floor"} at that height${blockers.length ? ` (${blockers.join(", ")} is in the way)` : ""}. Move it to open ground, with y at the floor (0) or the top of what it stands on.`);
      return;
    }
    const footprint = new Box3(new Vector3(x - c.size[0] / 2, y, z - c.size[0] / 2), new Vector3(x + c.size[0] / 2, y + c.size[1], z + c.size[0] / 2));
    if ((c.dialogue || c.gives) && !canInteract(grid, footprint)) {
      error(label, `${label} can't be talked to: the player must be able to stand within ${INTERACT.range} m of it. Move it somewhere the player can walk up to.`);
    }
    if (c.movement?.type === "patrol") {
      c.movement.points.forEach((point, j) => {
        if (!grid.levelPath([x, z], point, y)) {
          error(`${label}.movement.points[${j}]`, `${label}.movement.points[${j}] ${fmtPoint(point)} can't be walked to: characters only walk on level ground at their own height (y=${fmt(y)}) and go around solid things. Move the point onto open ground that ${c.id} can reach.`);
        }
      });
    } else if (c.movement?.type === "wander") {
      const r = c.movement.radius;
      if (x - r < interior.min.x || x + r > interior.max.x || z - r < interior.min.z || z + r > interior.max.z) {
        warn(label, `${label} wanders ${fmt(r)} m from ${fmtPoint([x, z])}, past the edge of the room; it will bump along the walls`);
      }
    }
  });

  room.pickups.forEach((p, i) => {
    const label = at(`pickups[${i}](${p.id})`);
    const [px, py, pz] = p.position;
    if (!grid.someReached((x, z, y) => Math.hypot(x - px, z - pz) <= PICKUP.range && py >= y - PICKUP.below && py <= y + PLAYER.height)) {
      error(label, `${label} can't be picked up: the player must be able to stand within ${PICKUP.range} m of it. Put it on open floor, or near the front edge of what it lies on.`);
    }
    const resting = Math.abs(py) <= TOLERANCE || props.some((q) => q.solids.some(({ box }) => distanceXZ(box, px, pz) === 0 && Math.abs(box.max.y - py) <= TOLERANCE));
    if (!resting) warn(label, `${label} floats at y=${fmt(py)}; set y to the floor (0) or the top of what it lies on`);
  });

  const arrivals: { name: string; at: Vec2 }[] = [
    { name: "the start", at: room.start },
    ...doors.map(({ door, side }) => ({ name: `the ${side} door's arrival spot`, at: arrivalPoint(room, door, side) })),
  ];
  room.characters.forEach((c, i) => {
    if (!c.hostile) return;
    const radius = c.movement?.type === "chase" ? c.movement.detectRadius : HOSTILE_MARGIN;
    for (const spot of arrivals) {
      if (Math.hypot(c.position[0] - spot.at[0], c.position[2] - spot.at[1]) < radius) {
        warn(at(`characters[${i}](${c.id})`), `${at(`characters[${i}](${c.id})`)} is hostile and starts within ${fmt(radius)} m of ${spot.name}, so the player may be hurt the moment they arrive`);
      }
    }
  });
  for (const p of props) {
    if (!p.prop.hazard) continue;
    for (const spot of arrivals) {
      if (distanceXZ(p.bounds, spot.at[0], spot.at[1]) < HAZARD_MARGIN) warn(p.label, `${p.label} is a hazard right next to ${spot.name}`);
    }
  }

  const propLights = room.props.filter((p) => p.light).length;
  if (propLights > LIMITS.propLightsPerRoom) error(at("props"), `${propLights} props give off light; the limit is ${LIMITS.propLightsPerRoom} per room`);
  // Every character carries a light: its own, or the standard glow.
  const lights = propLights + room.characters.length;
  if (lights > LIMITS.lightsPerRoom) {
    error(at("props"), `the room has ${lights} lights (${propLights} props plus ${room.characters.length} characters, who each carry one); the limit is ${LIMITS.lightsPerRoom}`);
  }

  if (grid.reachedCount < grid.standableCount * 0.6) {
    warn(ctx.path, `Only ${Math.round((grid.reachedCount / grid.standableCount) * 100)}% of ${room.id}'s walkable area is reachable from the start; parts of the room are cut off`);
  }
  if (room.props.length < MIN_PROPS) warn(at("props"), `${room.id} has only ${room.props.length} props; the room may feel empty`);

  return issues;
}
