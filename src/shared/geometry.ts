import { Box3, Euler, Quaternion, Vector3 } from "three";
import { DOOR, WALL_THICKNESS } from "./constants";
import type { DoorSpec, PartSpec, PropSpec, RoomSpec, Vec2, Vec3 } from "./spec";

// Everything the engine derives from a GameSpec rather than reading from it: where walls go, which wall
// a door is on, where a door stands and where the player arrives through it, and where each part of a
// prop ends up in the room. The validator and the engine both call these, so they can't disagree.

export type Side = "north" | "south" | "east" | "west";
export const OPPOSITE: Record<Side, Side> = { north: "south", south: "north", east: "west", west: "east" };

/** The wall of the room in cell `from` that leads to cell `to`, or undefined if they aren't neighbors. */
export function sideToward(from: Vec2, to: Vec2): Side | undefined {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  if (Math.abs(dx) + Math.abs(dz) !== 1) return undefined;
  return dx === 1 ? "east" : dx === -1 ? "west" : dz === -1 ? "north" : "south";
}

export interface PlacedPart {
  part: PartSpec;
  /** The prop (or wall) it belongs to, for messages. */
  label: string;
  /** Room-space bottom-center and rotation. */
  position: Vector3;
  quaternion: Quaternion;
  /** Room-space bounding box. */
  box: Box3;
}

const UP = new Vector3(0, 1, 0);

/** A prop's parts moved from its own frame into room coordinates. */
export function placeProp(prop: Pick<PropSpec, "position" | "rotationY" | "parts">, label: string): PlacedPart[] {
  const propQuat = new Quaternion().setFromAxisAngle(UP, prop.rotationY);
  const propPos = new Vector3().fromArray(prop.position);
  const corner = new Vector3();

  return prop.parts.map((part) => {
    const quaternion = propQuat.clone().multiply(new Quaternion().setFromEuler(new Euler().fromArray(part.rotation)));
    const position = new Vector3().fromArray(part.position).applyQuaternion(propQuat).add(propPos);

    // Origin at bottom-center; panels have no depth.
    const [w, h, d] = part.size;
    const depth = part.shape === "panel" ? 0 : d;
    const box = new Box3();
    for (const x of [-w / 2, w / 2])
      for (const y of [0, h])
        for (const z of [-depth / 2, depth / 2]) box.expandByPoint(corner.set(x, y, z).applyQuaternion(quaternion).add(position));

    return { part, label, position, quaternion, box };
  });
}

/** Horizontal distance from a point to a box's footprint; 0 when the point is over it. */
export function distanceXZ(box: Box3, x: number, z: number) {
  return Math.hypot(Math.max(box.min.x - x, 0, x - box.max.x), Math.max(box.min.z - z, 0, z - box.max.z));
}

/** The room-space box around a placed prop. */
export function boundsOf(parts: PlacedPart[]) {
  const box = new Box3();
  for (const p of parts) box.union(p.box);
  return box;
}

/** A prop's light comes from its tallest part: the lamp on a lamp post, the flame on a candlestick. */
export function lightPartIndex(prop: Pick<PropSpec, "parts">) {
  const top = (part: PartSpec) => part.position[1] + part.size[1];
  return prop.parts.reduce((best, part, i) => (top(part) > top(prop.parts[best]) ? i : best), 0);
}

/**
 * The walls the engine builds, as props made of one box each. Indoors: the north wall along z = 0 plus
 * the west and east walls. Outdoors: only the north wall, the building's face. The south side, nearest
 * the camera, is always open so the camera can see in.
 */
export function roomWalls(room: Pick<RoomSpec, "size" | "outdoor" | "walls" | "wallsTint">): PropSpec[] {
  const [w, h, d] = room.size;
  const t = WALL_THICKNESS;
  const wall = (id: string, position: Vec3, size: Vec3): PropSpec => ({
    id,
    name: id.replace("-", " "),
    position: [0, 0, 0],
    rotationY: 0,
    material: room.walls,
    parts: [{ shape: "box", position, rotation: [0, 0, 0], size, solid: true, ...(room.wallsTint && { tint: room.wallsTint }) }],
  });
  const north = wall("north-wall", [w / 2, 0, t / 2], [w, h, t]);
  if (room.outdoor) return [north];
  return [north, wall("west-wall", [t / 2, 0, d / 2], [t, h, d]), wall("east-wall", [w - t / 2, 0, d / 2], [t, h, d])];
}

export interface DoorPlacement {
  /** standing: a door against its wall. exitStrip: a dark strip on the floor along the open south edge. */
  kind: "standing" | "exitStrip";
  /** Bottom-center, room space. */
  position: Vec3;
  rotation: Vec3;
  /** [width, height, depth]; an exit strip lies flat, so its "height" runs north from the edge. */
  size: Vec3;
}

/**
 * Doors stand just in front of their wall (leaving room for walls up to 0.3 m thick). A south door would
 * block the camera, so it's drawn as an exit strip on the floor instead.
 */
export function placeDoor(room: Pick<RoomSpec, "size">, door: Pick<DoorSpec, "offset">, side: Side): DoorPlacement {
  const [w, , d] = room.size;
  const size: Vec3 = [DOOR.width, DOOR.height, 0];
  switch (side) {
    case "north":
      return { kind: "standing", position: [door.offset, 0, DOOR.inset], rotation: [0, 0, 0], size };
    case "east":
      return { kind: "standing", position: [w - DOOR.inset, 0, door.offset], rotation: [0, -Math.PI / 2, 0], size };
    case "west":
      return { kind: "standing", position: [DOOR.inset, 0, door.offset], rotation: [0, Math.PI / 2, 0], size };
    case "south":
      return { kind: "exitStrip", position: [door.offset, 0.01, d], rotation: [-Math.PI / 2, 0, 0], size: [DOOR.width, DOOR.exitDepth, 0] };
  }
}

/** Where the player appears when arriving through a door: on the floor just inside the room, in front of it. */
export function arrivalPoint(room: Pick<RoomSpec, "size">, door: Pick<DoorSpec, "offset">, side: Side): Vec2 {
  const [w, , d] = room.size;
  const ahead = DOOR.arrivalDistance;
  switch (side) {
    case "north":
      return [door.offset, DOOR.inset + ahead];
    case "south":
      return [door.offset, d - DOOR.exitDepth - ahead];
    case "east":
      return [w - DOOR.inset - ahead, door.offset];
    case "west":
      return [DOOR.inset + ahead, door.offset];
  }
}

/** Length of the wall a door on `side` runs along: doors' offsets are measured along it. */
export function wallLength(room: Pick<RoomSpec, "size">, side: Side) {
  return side === "north" || side === "south" ? room.size[0] : room.size[2];
}
