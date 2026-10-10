import { Quaternion, Vector3 } from "three";
import { ObjectType } from "./output/output";
import type { PlacedPart } from "./buildRoom";

// Keep in sync with Player.ts. The player is a capsule with gravity that auto-steps up to
// MAX_STEP and climbs slopes up to 50°; over one CELL a 50° slope rises ~0.3 m, under MAX_STEP.
export const PLAYER_RADIUS = 0.35;
export const PLAYER_HEIGHT = 1.8;
export const MAX_STEP = 0.35;
const CELL = 0.25;
const SAME_HEIGHT = 0.02;
const MAX_HEIGHTS_PER_CELL = 4;

/** How a solid part relates to one floor point. */
interface Sample {
  /** Horizontal distance from the point to the part's footprint (0 = directly over it). */
  dist: number;
  bottom: number;
  /** Top of the part at the footprint point nearest the query (the slope height, for wedges). */
  top: number;
  /** True when the part's top is something to stand on at this point. */
  surface: boolean;
}

const local = new Vector3();
const inverse = new Quaternion();

function sample(p: PlacedPart, x: number, z: number): Sample {
  const { quaternion: q, part, box } = p;
  // Only parts turned purely around Y keep a flat (or simply sloped) top; anything tilted is
  // treated as a plain obstacle using its bounding box.
  const upright = Math.abs(q.x) < 1e-3 && Math.abs(q.z) < 1e-3;
  if (!upright) {
    const dx = Math.max(box.min.x - x, 0, x - box.max.x);
    const dz = Math.max(box.min.z - z, 0, z - box.max.z);
    return { dist: Math.hypot(dx, dz), bottom: box.min.y, top: box.max.y, surface: false };
  }

  const [w, h, d] = part.scale;
  const depth = part.type === ObjectType.Plane ? 0 : d;
  local.set(x - p.position.x, 0, z - p.position.z).applyQuaternion(inverse.copy(q).invert());
  const cx = Math.min(Math.max(local.x, -w / 2), w / 2);
  const cz = Math.min(Math.max(local.z, -depth / 2), depth / 2);
  const dist = Math.hypot(local.x - cx, local.z - cz);
  const bottom = p.position.y;
  // A wedge is full height at its -z end and slopes to zero at +z (see Object.ts).
  const top = part.type === ObjectType.RightTriPrism ? bottom + h * (0.5 - cz / d) : bottom + h;
  return { dist, bottom, top, surface: part.type !== ObjectType.Plane };
}

export interface WalkGrid {
  /** True if the point is open ground at about floor level (y=0). */
  standableAtFloor(x: number, z: number): boolean;
  /** Labels of solids that keep the player from standing at floor level here. */
  blockersAt(x: number, z: number): string[];
  /** Flood fill from a floor-level start; false if the start isn't standable. */
  floodFrom(x: number, z: number): boolean;
  /** Whether any reached spot satisfies the test (floor-cell center x, z and standing height y). */
  someReached(test: (x: number, z: number, y: number) => boolean): boolean;
  standableCount: number;
  reachedCount: number;
}

/**
 * A grid over the floor where each cell lists every height the player can stand at: the floor,
 * the top of a platform, partway up a ramp. Moving to a neighboring cell means stepping up at most
 * MAX_STEP, or dropping off an edge.
 */
export function buildWalkGrid(solids: PlacedPart[], width: number, depth: number): WalkGrid {
  const cols = Math.max(1, Math.floor(width / CELL));
  const rows = Math.max(1, Math.floor(depth / CELL));
  const cellX = (c: number) => (c + 0.5) * CELL;
  const cellZ = (r: number) => (r + 0.5) * CELL;
  const near = (x: number, z: number) =>
    solids.map((p) => ({ p, s: sample(p, x, z) })).filter(({ s }) => s.dist < PLAYER_RADIUS);
  // Nearby solids may stick up by a step (the controller auto-steps onto them), but a solid
  // directly underfoot must be stood on, not stood inside: otherwise the bottom of a ramp would
  // count as floor and the climb would look like a wall once the slope passes MAX_STEP.
  const fits = (samples: { s: Sample }[], y: number) =>
    samples.every(({ s }) => s.bottom >= y + PLAYER_HEIGHT || s.top <= y + (s.dist === 0 ? SAME_HEIGHT : MAX_STEP));
  // The room has invisible boundaries at its edges (Room.ts), so the capsule can't get closer.
  const insideBounds = (x: number, z: number) =>
    x >= PLAYER_RADIUS && x <= width - PLAYER_RADIUS && z >= PLAYER_RADIUS && z <= depth - PLAYER_RADIUS;

  const heights: number[][] = [];
  let standableCount = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = cellX(c);
      const z = cellZ(r);
      const valid: number[] = [];
      if (insideBounds(x, z)) {
        const samples = near(x, z);
        const candidates = [0, ...samples.filter(({ s }) => s.surface && s.dist === 0).map(({ s }) => s.top)].sort((a, b) => a - b);
        for (const y of candidates) {
          if (valid.length < MAX_HEIGHTS_PER_CELL && !valid.some((v) => Math.abs(v - y) < SAME_HEIGHT) && fits(samples, y)) valid.push(y);
        }
      }
      heights.push(valid);
      standableCount += valid.length;
    }
  }

  const reached = heights.map((h) => new Array<boolean>(h.length).fill(false));
  let reachedCount = 0;
  const cellOf = (x: number, z: number) => {
    const c = Math.floor(x / CELL);
    const r = Math.floor(z / CELL);
    return c >= 0 && c < cols && r >= 0 && r < rows ? r * cols + c : -1;
  };

  return {
    standableAtFloor(x, z) {
      const cell = cellOf(x, z);
      return cell >= 0 && heights[cell].some((y) => y <= MAX_STEP);
    },
    blockersAt(x, z) {
      return [...new Set(near(x, z).filter(({ s }) => !(s.top <= MAX_STEP || s.bottom >= PLAYER_HEIGHT)).map(({ p }) => p.label))];
    },
    floodFrom(x, z) {
      const start = cellOf(x, z);
      const k = start >= 0 ? heights[start].findIndex((y) => y <= MAX_STEP) : -1;
      if (k < 0) return false;
      const stack: [number, number][] = [[start, k]];
      reached[start][k] = true;
      while (stack.length) {
        const [cell, i] = stack.pop()!;
        reachedCount++;
        const y = heights[cell][i];
        const r = Math.floor(cell / cols);
        const c = cell % cols;
        for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          const next = nr * cols + nc;
          const options = heights[next];
          // Walking on: the neighbor height closest to ours within a step. Otherwise fall to the
          // highest height below us (dropping off an edge). Never climb more than MAX_STEP.
          let j = -1;
          let best = Infinity;
          options.forEach((ny, idx) => {
            if (Math.abs(ny - y) <= MAX_STEP && Math.abs(ny - y) < best) [j, best] = [idx, Math.abs(ny - y)];
          });
          if (j < 0) {
            options.forEach((ny, idx) => {
              if (ny < y && (j < 0 || ny > options[j])) j = idx;
            });
          }
          if (j >= 0 && !reached[next][j]) {
            reached[next][j] = true;
            stack.push([next, j]);
          }
        }
      }
      return true;
    },
    someReached(test) {
      for (let cell = 0; cell < heights.length; cell++) {
        const x = cellX(cell % cols);
        const z = cellZ(Math.floor(cell / cols));
        for (let i = 0; i < heights[cell].length; i++) if (reached[cell][i] && test(x, z, heights[cell][i])) return true;
      }
      return false;
    },
    get standableCount() {
      return standableCount;
    },
    get reachedCount() {
      return reachedCount;
    },
  };
}
