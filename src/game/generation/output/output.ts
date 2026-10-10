import type { Vector3Tuple } from "three";

// Units are meters, rotations are Euler radians.
// Room space: x 0..width, z 0..depth (z = depth is nearest the camera), y up, floor top at y = 0.

export enum ObjectType {
    RectPrism = "rectPrism",
    RightTriPrism = "rightTriPrism",
    Plane = "plane",
}

/** An image generated once and referenced by id from anywhere in the game. */
export interface Texture {
    id: string
    prompt: string
}

/** Static geometry: walls, furniture, scenery. */
export interface Object {
    id: string
    type: ObjectType
    /** Bottom-center of the object. Relative to the parent group when inside one. */
    position: Vector3Tuple
    rotation: Vector3Tuple
    /** Size [width, height, depth]. Planes ignore depth. */
    scale: Vector3Tuple
    collisionsEnabled: boolean
    /** Falls back to a flat color when omitted. */
    textureId?: string
}

/** Each state is a list of texture ids played in order, looping. */
export interface Animations {
    idle: string[]
    moving?: string[]
    interacting?: string[]
    attack?: string[]
    death?: string[]
}

/** Damages anything in `hostileToIds` that touches it. Fires on touch even if collisionsEnabled is false. */
export interface CollisionAction {
    /** Object ids, or "player" for the protagonist. */
    hostileToIds: string[]
    damage: number
}

export type EmitTrigger =
    | { type: "interval", seconds: number }
    | { type: "collision" }
    | { type: "random", chancePerSecond: number }

/**
 * Spawns a new sprite at this sprite's position: projectiles, dripping blood, or an
 * item dropping out of a searched chest/body (trigger "collision", maxCount 1).
 */
export interface EmitAction {
    sprite: Omit<Sprite, "id" | "position">
    velocity: Vector3Tuple
    /** Omit to keep the spawned sprite forever (e.g. items). */
    lifetimeSeconds?: number
    /** Total spawns allowed. Omit for unlimited. */
    maxCount?: number
    when: EmitTrigger
}

/** An animated and/or interactive object. Always a plane. `animations` overrides `textureId`. */
export interface Sprite extends Object {
    type: ObjectType.Plane
    animations?: Animations
    actions?: {
        collision?: CollisionAction
        emit?: EmitAction
    }
    /** Makes this sprite a pickup. Its texture doubles as the inventory icon. */
    item?: Item
}

/** Moves and rotates its children together. */
export interface Group {
    id: string
    position: Vector3Tuple
    rotation: Vector3Tuple
    objects: (Object | Sprite)[]
    groups?: Group[]
}

export enum ItemType {
    Key = "key",
}

/** Picked up when the player touches the sprite carrying it. */
export interface Item {
    type: ItemType
    name: string
    /** Key: id of the locked Connection it opens. */
    unlocksId?: string
}

/** An edge in the room graph. The two rooms must be in adjacent grid cells. */
export interface Connection {
    id: string
    roomIds: [string, string]
    /** Needs a Key whose unlocksId is this connection's id. Unlocks both sides. */
    locked?: boolean
}

/**
 * One side of a Connection. Which wall it's on comes from the rooms' grid positions,
 * and the parser places it: north/east/west doors stand just in front of that wall
 * (leave room for walls up to 0.3 thick), south doors are drawn as an exit strip on the floor.
 */
export interface Door extends Omit<Object, "position" | "rotation"> {
    connectionId: string
    /** Position along the wall: x for north/south doors, z for east/west doors. */
    offset: number
}

export interface Room {
    id: string
    /** [x, z] cell on the map. North is -z, east is +x, same as inside a room. */
    gridPosition: [number, number]
    dimensions: Vector3Tuple
    startPosition: Vector3Tuple
    floorTextureId?: string
    objects: (Object | Sprite)[]
    groups?: Group[]
    doors?: Door[]
}

export interface Game {
    /** Shared by every room. */
    textures: Texture[]
    connections: Connection[]
    /** rooms[0] is where the game starts. */
    rooms: Room[]
}
