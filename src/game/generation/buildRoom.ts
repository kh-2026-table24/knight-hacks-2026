import { Box3, Euler, Quaternion, Vector3 } from "three";
import { ObjectType, type Door, type Group, type Object as ObjectOutput, type Room, type Texture } from "./output/output";
import type { RoomBrief } from "./output/housePlan";
import type { ItemPlan, PartPlan, RoomPlan } from "./output/roomPlan";

/** Walls are added here rather than by Claude: one less thing to get wrong, and always the same. */
export const WALL_THICKNESS = 0.3;
const DOOR_SCALE: [number, number, number] = [1.6, 3, 0];

export interface PlacedPart {
  part: PartPlan;
  /** Label of the item (or wall) it belongs to, for error messages. */
  label: string;
  /** World-space bottom-center and rotation. */
  position: Vector3;
  quaternion: Quaternion;
  /** World-space bounding box. */
  box: Box3;
}

const UP = new Vector3(0, 1, 0);

/** Moves an item's parts from its local frame into room coordinates. */
export function placeItem(item: ItemPlan, label: string): PlacedPart[] {
  const itemQuat = new Quaternion().setFromAxisAngle(UP, item.rotationY);
  const itemPos = new Vector3().fromArray(item.position);
  const corner = new Vector3();

  return item.parts.map((part) => {
    const quaternion = itemQuat.clone().multiply(new Quaternion().setFromEuler(new Euler().fromArray(part.rotation)));
    const position = new Vector3().fromArray(part.position).applyQuaternion(itemQuat).add(itemPos);

    // Same shape conventions as Object.ts: origin at bottom-center; planes have no depth.
    const [w, h, d] = part.scale;
    const depth = part.type === ObjectType.Plane ? 0 : d;
    const box = new Box3();
    for (const x of [-w / 2, w / 2])
      for (const y of [0, h])
        for (const z of [-depth / 2, depth / 2]) box.expandByPoint(corner.set(x, y, z).applyQuaternion(quaternion).add(position));

    return { part, label, position, quaternion, box };
  });
}

/**
 * Indoors: north wall along z=0 plus west and east walls. Outdoors: only the north wall, which is
 * the building's front face. The south (camera) side is always open.
 */
export function wallItems(plan: RoomPlan, outdoor: boolean): ItemPlan[] {
  const [w, h, d] = plan.dimensions;
  const t = WALL_THICKNESS;
  const wall = (name: string, position: [number, number, number], scale: [number, number, number]): ItemPlan => ({
    name,
    position: [0, 0, 0],
    rotationY: 0,
    parts: [{ type: ObjectType.RectPrism, position, rotation: [0, 0, 0], scale, collisionsEnabled: true }],
  });
  const north = wall("north wall", [w / 2, 0, t / 2], [w, h, t]);
  if (outdoor) return [north];
  return [north, wall("west wall", [t / 2, 0, d / 2], [t, h, d]), wall("east wall", [w - t / 2, 0, d / 2], [t, h, d])];
}

function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "item";
}

function toObject(part: PartPlan, id: string, textureId: string): ObjectOutput {
  return {
    id,
    type: part.type,
    position: [...part.position],
    rotation: [...part.rotation],
    scale: [...part.scale],
    collisionsEnabled: part.collisionsEnabled,
    textureId,
  };
}

/**
 * Turns a checked plan into the engine's Room, plus the textures it references. Every id is
 * prefixed with the room id so ids stay unique across the whole game.
 */
export function buildRoom(plan: RoomPlan, brief: RoomBrief): { room: Room; textures: Texture[] } {
  const id = brief.id;
  const textures: Texture[] = [];
  const texture = (key: string, prompt: string) => {
    const textureId = `${id}-${key}`;
    textures.push({ id: textureId, prompt });
    return textureId;
  };

  const wallTexture = texture("walls", plan.wallDescription || `${brief.name} walls`);
  const floorTextureId = texture("floor", plan.floorDescription || `${brief.name} floor`);
  const doorTexture = texture("door", `door set into ${plan.wallDescription || brief.name}, front view`);

  const objects = wallItems(plan, brief.outdoor).map((wall) => toObject(wall.parts[0], `${id}-${slug(wall.name)}`, wallTexture));

  // Boxes and wedges are tiled with a material texture (assets.ts draws them as surfaces), so they
  // need what they're made of, not the item's name: a tiled picture of a whole workbench is noise.
  // Items made of the same material share one texture. Flat panels are drawn as cutouts of the item.
  const materials = new Map<string, string>();
  const materialTexture = (material: string) => {
    let textureId = materials.get(material);
    if (!textureId) {
      textureId = texture(`material-${materials.size}-${slug(material)}`, material);
      materials.set(material, textureId);
    }
    return textureId;
  };

  const groups: Group[] = plan.items.map((item, i) => {
    const groupId = `${id}-${i}-${slug(item.name)}`;
    let cutoutTexture: string | undefined;
    const textureFor = (part: PartPlan) => {
      if (part.type !== ObjectType.Plane) return materialTexture(part.material ?? item.material ?? item.name);
      cutoutTexture ??= texture(`${i}-${slug(item.name)}`, item.name);
      return cutoutTexture;
    };
    return {
      id: groupId,
      position: [...item.position],
      rotation: [0, item.rotationY, 0],
      objects: item.parts.map((part, j) => toObject(part, `${groupId}-${j}`, textureFor(part))),
    };
  });

  const doors: Door[] = plan.doors.map((door) => ({
    id: `${id}-door-${door.connectionId}`,
    connectionId: door.connectionId,
    offset: door.offset,
    type: ObjectType.Plane,
    scale: DOOR_SCALE,
    collisionsEnabled: true,
    textureId: doorTexture,
  }));

  return {
    room: {
      id,
      gridPosition: brief.gridPosition,
      dimensions: plan.dimensions,
      startPosition: plan.startPosition,
      floorTextureId,
      objects,
      groups,
      doors,
    },
    textures,
  };
}
