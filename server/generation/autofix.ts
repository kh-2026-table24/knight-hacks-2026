import { Box3, Vector3 } from "three";
import { overlaps } from "../../src/shared/checkRoom";
import { DOOR, INTERACT, PICKUP, PLAYER, WALL_THICKNESS } from "../../src/shared/constants";
import { arrivalPoint, boundsOf, distanceXZ, placeProp, roomWalls, wallLength, type PlacedPart, type Side } from "../../src/shared/geometry";
import { LIMITS, type PropSpec, type RoomSpec, type Vec2 } from "../../src/shared/spec";
import { buildWalkGrid, type WalkGrid } from "../../src/shared/walkGrid";

// Mechanical fixes made in code before a room is checked, so Claude is only asked about problems that
// need judgment. Each fix is the smallest change that makes the problem go away: things are moved to the
// nearest spot that works, and only scenery is ever pushed aside or removed. Rooms are changed in place.

const TOLERANCE = 0.05;
/** Spacing of the spots tried when looking for open floor, and how far to look. */
const SEARCH_STEP = 0.25;
const SEARCH_RADIUS = 8;
/** A sprite this close to a wall, or reaching this close to the ceiling, may be hanging on it. */
const HANGING_MARGIN = 0.3;
/** A sprite may hang from something whose top reaches its own, within this distance. */
const HANG_REACH = 1;
/** How far a nudge clears what it moves away from. */
const NUDGE_GAP = 0.02;

/** Each room has 1 to this many things to examine or search (characters don't count). */
export const MAX_INTERACTABLES = 4;

const isScenery = (prop: PropSpec) => !prop.examine && !prop.contains && !prop.hazard;
const interactable = (prop: PropSpec) => !!(prop.examine || prop.contains);
const fmt = (n: number) => String(Math.round(n * 100) / 100);

/**
 * Fixes what code can in a parsed room. `sides` gives the wall each of its connections leaves through;
 * `doorArt` the storyboard's look for each door. Returns a line for each change, for the log.
 */
export function autofixRoom(room: RoomSpec, sides: Map<string, Side>, doorArt: Map<string, string>): string[] {
  const fixes: string[] = [];
  fixDoors(room, sides, doorArt, fixes);
  trimInteractables(room, fixes);
  trimLights(room, fixes);
  dropFloatingSprites(room, fixes);
  pullInside(room, fixes);
  separateScenery(room, fixes);
  fixPlacements(room, sides, fixes);
  return fixes;
}

/** Exactly one door per connection, on its wall and not too near the wall's ends. */
function fixDoors(room: RoomSpec, sides: Map<string, Side>, doorArt: Map<string, string>, fixes: string[]) {
  const stray = room.doors.filter((door) => !sides.has(door.connection));
  if (stray.length) {
    room.doors = room.doors.filter((door) => sides.has(door.connection));
    fixes.push(`removed doors to connections that don't touch this room: ${stray.map((d) => d.connection).join(", ")}`);
  }
  for (const [connection, side] of sides) {
    const along = wallLength(room, side);
    const matching = room.doors.filter((door) => door.connection === connection);
    if (matching.length === 0) {
      const art = side === "south" ? undefined : doorArt.get(connection);
      room.doors.push({ connection, offset: along / 2, ...(art && { art }) });
      fixes.push(`added the missing ${side} door "${connection}"`);
      continue;
    }
    if (matching.length > 1) {
      room.doors = room.doors.filter((door) => door.connection !== connection || door === matching[0]);
      fixes.push(`kept one of ${matching.length} doors for "${connection}"`);
    }
    const door = matching[0];
    const offset = clamp(door.offset, DOOR.edgeMargin, along - DOOR.edgeMargin);
    if (offset !== door.offset) {
      fixes.push(`moved the ${side} door "${connection}" from offset ${fmt(door.offset)} to ${fmt(offset)}`);
      door.offset = offset;
    }
  }
}

/** Keeps every prop that holds an item, then the first ones written, until there are MAX_INTERACTABLES. */
function trimInteractables(room: RoomSpec, fixes: string[]) {
  const all = room.props.filter(interactable);
  if (all.length <= MAX_INTERACTABLES) return;
  const holders = all.filter((prop) => prop.contains);
  const others = all.filter((prop) => !prop.contains).slice(0, Math.max(0, MAX_INTERACTABLES - holders.length));
  const keep = new Set([...holders, ...others]);
  const dropped = all.filter((prop) => !keep.has(prop));
  for (const prop of dropped) {
    delete prop.examine;
    delete prop.afterwards;
  }
  fixes.push(`left ${keep.size} things to examine; ${dropped.map((p) => p.id).join(", ")} became scenery`);
}

function trimLights(room: RoomSpec, fixes: string[]) {
  const lit = room.props.filter((prop) => prop.light);
  const budget = Math.max(0, Math.min(LIMITS.propLightsPerRoom, LIMITS.lightsPerRoom - room.characters.length));
  if (lit.length <= budget) return;
  // Story objects keep their light first, so the eye is still drawn to them.
  const order = [...lit.filter((p) => !isScenery(p)), ...lit.filter(isScenery)];
  const dark = order.slice(budget);
  for (const prop of dark) delete prop.light;
  fixes.push(`removed the lights of ${dark.map((p) => p.id).join(", ")} (${lit.length} props gave off light; the limit is ${budget})`);
}

/**
 * Drops sprites hanging in mid-air onto whatever is under them, or the floor. A sprite counts as held up
 * when it rests on something, hangs on a wall or from the ceiling, or hangs from something reaching as
 * high as it does just behind or above it (a hook, a branch, a crane's jib).
 */
function dropFloatingSprites(room: RoomSpec, fixes: string[]) {
  const [w, h] = room.size;
  const placed = room.props.map((prop) => ({ prop, parts: placeProp(prop, prop.id) }));
  const blocks = placed.flatMap(({ parts }) => parts.filter((p) => p.part.shape !== "panel"));
  for (const { prop, parts } of placed) {
    if (parts.some((p) => p.part.shape !== "panel")) continue;
    const b = boundsOf(parts);
    if (b.min.y <= TOLERANCE) continue;
    if (b.min.z <= WALL_THICKNESS + HANGING_MARGIN) continue;
    if (!room.outdoor && (b.min.x <= WALL_THICKNESS + HANGING_MARGIN || b.max.x >= w - WALL_THICKNESS - HANGING_MARGIN || b.max.y >= h - HANGING_MARGIN)) continue;
    const x = (b.min.x + b.max.x) / 2;
    const z = (b.min.z + b.max.z) / 2;
    if (blocks.some(({ box }) => Math.abs(box.max.y - b.min.y) <= TOLERANCE && distanceXZ(box, x, z) <= 0.1)) continue;
    const hangsFrom = placed.some(
      (other) => other.prop !== prop && other.parts.some(({ box }) => box.max.y >= b.max.y - TOLERANCE && box.min.y <= b.max.y + HANG_REACH && distanceXZ(box, x, z) <= HANG_REACH),
    );
    if (hangsFrom) continue;

    const support = Math.max(0, ...blocks.filter(({ box }) => distanceXZ(box, x, z) === 0 && box.max.y <= b.min.y + TOLERANCE).map(({ box }) => box.max.y));
    prop.position = [prop.position[0], prop.position[1] - (b.min.y - support), prop.position[2]];
    fixes.push(`dropped ${prop.id}, which floated at y=${fmt(b.min.y)}, onto ${support > 0 ? `what's under it (y=${fmt(support)})` : "the floor"}`);
  }
}

/** Moves props that stick out of the room back inside, if they fit. */
function pullInside(room: RoomSpec, fixes: string[]) {
  const inside = interior(room);
  for (const prop of room.props) {
    const b = boundsOf(placeProp(prop, prop.id));
    const shift = [axisShift(b.min.x, b.max.x, inside.min.x, inside.max.x), axisShift(b.min.y, b.max.y, 0, inside.max.y), axisShift(b.min.z, b.max.z, inside.min.z, inside.max.z)];
    if (shift.every((s) => s === 0)) continue;
    prop.position = [prop.position[0] + shift[0], prop.position[1] + shift[1], prop.position[2] + shift[2]];
    fixes.push(`moved ${prop.id} by [${shift.map(fmt).join(", ")}] to bring it inside the room`);
  }
}

/** How far to move [min, max] to fit inside [low, high]: 0 if it's already inside or can't fit. */
function axisShift(min: number, max: number, low: number, high: number) {
  if (max - min > high - low) return 0;
  if (min < low - TOLERANCE) return low - min;
  if (max > high + TOLERANCE) return high - max;
  return 0;
}

/**
 * Where scenery passes through something else, moves it the shortest way out. When there's no room for
 * that, a flat sprite stops being solid (sprites can overlap on screen) and anything else is removed.
 */
function separateScenery(room: RoomSpec, fixes: string[]) {
  const inside = interior(room);
  const solidsOf = (prop: PropSpec) => placeProp(prop, prop.id).filter((p) => p.part.solid);
  const hits = (a: PlacedPart[], b: PlacedPart[]) => a.some((x) => b.some((y) => overlaps(x.box, y.box)));

  for (let changed = true; changed; ) {
    changed = false;
    const solids = room.props.map(solidsOf);
    for (let i = 0; i < room.props.length && !changed; i++) {
      for (let j = i + 1; j < room.props.length && !changed; j++) {
        if (!hits(solids[i], solids[j])) continue;
        const [a, b] = [room.props[i], room.props[j]];
        // Move scenery rather than a story object; of two pieces of scenery, the smaller one.
        const moveA = isScenery(a) && (!isScenery(b) || size(solids[i]) <= size(solids[j]));
        const mover = moveA ? a : isScenery(b) ? b : undefined;
        if (!mover) continue;
        const [m, other] = moveA ? [i, j] : [j, i];
        const others = solids.filter((_, k) => k !== m).flat();
        const nudge = nudges(boundsOf(solids[m]), boundsOf(solids[other])).find((offset) => {
          const moved = solids[m].map((p) => p.box.clone().translate(offset));
          const bounds = moved.reduce((all, box) => all.union(box), new Box3());
          return within(bounds, inside) && !moved.some((box) => others.some((o) => overlaps(box, o.box)));
        });
        if (nudge) {
          mover.position = [mover.position[0] + nudge.x, mover.position[1], mover.position[2] + nudge.z];
          fixes.push(`moved ${mover.id} by [${fmt(nudge.x)}, 0, ${fmt(nudge.z)}] out of ${room.props[other].id}`);
        } else if (mover.parts.every((p) => p.shape === "panel")) {
          mover.parts = mover.parts.map((p) => ({ ...p, solid: false }));
          fixes.push(`made ${mover.id} walk-through, since it overlapped ${room.props[other].id} with nowhere to move`);
        } else {
          fixes.push(`removed ${mover.id}, which passed through ${room.props[other].id} with nowhere to move`);
          room.props = room.props.filter((p) => p !== mover);
        }
        changed = true;
      }
    }
  }
}

const size = (parts: PlacedPart[]) => parts.reduce((sum, { box }) => sum + (box.max.x - box.min.x) * (box.max.y - box.min.y) * (box.max.z - box.min.z), 0);

/** The four ways to push `box` clear of `from` along x or z, shortest first. */
function nudges(box: Box3, from: Box3): Vector3[] {
  return [
    new Vector3(from.max.x - box.min.x + NUDGE_GAP, 0, 0),
    new Vector3(from.min.x - box.max.x - NUDGE_GAP, 0, 0),
    new Vector3(0, 0, from.max.z - box.min.z + NUDGE_GAP),
    new Vector3(0, 0, from.min.z - box.max.z - NUDGE_GAP),
  ].sort((p, q) => p.length() - q.length());
}

/**
 * Puts the start, door arrivals, characters and pickups where the player can get to them: each one that
 * can't be used where it is moves to the nearest open floor the player can reach.
 */
function fixPlacements(room: RoomSpec, sides: Map<string, Side>, fixes: string[]) {
  const [w, , d] = room.size;
  const walls = roomWalls(room).flatMap((wall) => placeProp(wall, wall.id));
  const grid = buildWalkGrid([...walls, ...room.props.flatMap((prop) => placeProp(prop, prop.id).filter((p) => p.part.solid))], w, d);

  if (!grid.floodFrom(...room.start)) {
    // The start should be near the camera side, so look there first.
    const open = (x: number, z: number) => grid.standableAtFloor(x, z);
    const spot = nearestSpot(room.start, (x, z) => open(x, z) && z >= d / 2) ?? nearestSpot(room.start, open);
    if (!spot) return;
    fixes.push(`moved the start from [${room.start.map(fmt).join(", ")}] to open floor at [${spot.map(fmt).join(", ")}]`);
    room.start = spot;
    if (!grid.floodFrom(...spot)) return;
  }
  const reachedFloor = (x: number, z: number) => grid.reachedHeightsAt(x, z).some((y) => y <= TOLERANCE);

  for (const door of room.doors) {
    const side = sides.get(door.connection);
    if (!side) continue;
    const arrives = (offset: number) => {
      const [x, z] = arrivalPoint(room, { offset }, side);
      return grid.reachedHeightsAt(x, z).some((y) => y <= PLAYER.stepHeight);
    };
    if (arrives(door.offset)) continue;
    const along = wallLength(room, side);
    const offsets: number[] = [];
    for (let o = DOOR.edgeMargin; o <= along - DOOR.edgeMargin + 1e-6; o += SEARCH_STEP) offsets.push(o);
    const offset = offsets.sort((p, q) => Math.abs(p - door.offset) - Math.abs(q - door.offset)).find(arrives);
    if (offset === undefined) continue;
    fixes.push(`moved the ${side} door "${door.connection}" from offset ${fmt(door.offset)} to ${fmt(offset)}, where the floor in front of it is open`);
    door.offset = offset;
  }

  for (const c of room.characters) {
    const [x, y, z] = c.position;
    const stands = grid.reachedHeightsAt(x, z).some((height) => Math.abs(height - y) <= TOLERANCE);
    if (!stands || ((c.dialogue || c.gives) && !canTalkTo(grid, x, z, c.size[0]))) {
      const spot = nearestSpot([x, z], reachedFloor);
      if (spot) {
        c.position = [spot[0], 0, spot[1]];
        fixes.push(`moved ${c.id} from [${[x, y, z].map(fmt).join(", ")}] to open floor at [${fmt(spot[0])}, 0, ${fmt(spot[1])}]`);
      }
    }
    if (c.movement?.type === "patrol") {
      const [cx, cy, cz] = c.position;
      const points = c.movement.points.filter((point) => grid.levelPath([cx, cz], point, cy));
      if (points.length === c.movement.points.length) continue;
      if (points.length >= 2) {
        c.movement = { ...c.movement, points };
        fixes.push(`dropped ${c.id}'s patrol points it couldn't walk to`);
      } else {
        c.movement = { type: "wander", speed: c.movement.speed, radius: 1.5 };
        fixes.push(`made ${c.id} wander instead of patrol, since it couldn't walk its route`);
      }
    }
  }

  for (const p of room.pickups) {
    const [px, py, pz] = p.position;
    const reachable = grid.someReached((x, z, y) => Math.hypot(x - px, z - pz) <= PICKUP.range && py >= y - PICKUP.below && py <= y + PLAYER.height);
    if (reachable) continue;
    const spot = nearestSpot([px, pz], reachedFloor);
    if (!spot) continue;
    p.position = [spot[0], 0, spot[1]];
    fixes.push(`moved the pickup ${p.id} to open floor at [${fmt(spot[0])}, 0, ${fmt(spot[1])}]`);
  }
}

const canTalkTo = (grid: WalkGrid, x: number, z: number, width: number) =>
  grid.someReached((px, pz) => Math.hypot(px - x, pz - z) - width / 2 <= INTERACT.range);

/** The nearest spot (on a SEARCH_STEP grid around `from`) that passes `ok`, or undefined within SEARCH_RADIUS. */
function nearestSpot(from: Vec2, ok: (x: number, z: number) => boolean): Vec2 | undefined {
  const rings = Math.ceil(SEARCH_RADIUS / SEARCH_STEP);
  for (let k = 0; k <= rings; k++) {
    let best: Vec2 | undefined;
    let bestDistance = Infinity;
    for (let i = -k; i <= k; i++) {
      for (let j = -k; j <= k; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== k) continue;
        const x = from[0] + i * SEARCH_STEP;
        const z = from[1] + j * SEARCH_STEP;
        const distance = Math.hypot(i, j);
        if (distance < bestDistance && ok(x, z)) [best, bestDistance] = [[x, z], distance];
      }
    }
    if (best) return best;
  }
  return undefined;
}

/** The usable space inside the walls, as checkRoom measures it. */
function interior(room: RoomSpec) {
  const [w, h, d] = room.size;
  const side = room.outdoor ? 0 : WALL_THICKNESS;
  return new Box3(new Vector3(side, 0, WALL_THICKNESS), new Vector3(w - side, h, d));
}

const within = (b: Box3, room: Box3) =>
  b.min.x >= room.min.x - TOLERANCE && b.max.x <= room.max.x + TOLERANCE && b.min.z >= room.min.z - TOLERANCE && b.max.z <= room.max.z + TOLERANCE && b.max.y <= room.max.y + TOLERANCE;

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
