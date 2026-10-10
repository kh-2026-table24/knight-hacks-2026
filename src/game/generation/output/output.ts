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
    light?: Light
}

/**
 * Makes an object give off light. Rooms are dark, so light is what draws the eye: use it on the
 * focal point and a few accents, and leave corners in shadow.
 */
export interface Light {
    /**
     * "glow": shines in every direction from near the top of the object, which glows itself
     * (candles, lanterns, fireplaces, a ghost). "spot": a cone shining down onto the object from
     * above, leaving a pool of light around it (a hanging lamp, moonlight through a skylight).
     */
    type: "glow" | "spot"
    /** Hex color, e.g. "#ffb060" firelight, "#a8c0ff" moonlight, "#7dff9a" something wrong. */
    color: string
    /** 1 = a candle, 3 = a lantern, 6 = a fireplace or overhead lamp. */
    intensity: number
    /** Meters the glow reaches, or the radius of a spot's pool of light. */
    range: number
    /** Defaults to "steady". */
    effect?: "steady" | "flicker" | "pulse"
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
    /** After the player finishes this sprite's dialogue, e.g. an NPC handing over an item. */
    | { type: "dialogueEnd" }

/** How a sprite moves on its own. Speeds are meters per second; the player walks at 5. */
export type Movement =
    /** Drifts randomly within `radius` of where it was placed. */
    | { type: "wander", speed: number, radius: number }
    /** Walks between room-space points in order, looping. */
    | { type: "patrol", speed: number, points: Vector3Tuple[] }
    /** Heads for the player once they come within `detectRadius`. */
    | { type: "chase", speed: number, detectRadius: number }

/** What a sprite says when the player talks to it. */
export interface Dialogue {
    speaker: string
    /** Shown one at a time. */
    lines: string[]
}

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

/**
 * An animated and/or interactive object. Always a plane. `animations` overrides `textureId`.
 * NPCs are sprites: a hostile one typically has `movement` (chase) and a collision action that
 * damages "player"; a friendly one has `dialogue`, optionally emitting an item on "dialogueEnd".
 */
export interface Sprite extends Object {
    type: ObjectType.Plane
    animations?: Animations
    actions?: {
        collision?: CollisionAction
        emit?: EmitAction
    }
    /** Makes this sprite a pickup. Its texture doubles as the inventory icon. */
    item?: Item
    /** Moving sprites must be placed at room level, not inside a group. */
    movement?: Movement
    dialogue?: Dialogue
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
    /** Base brightness before any lights: 0 is pitch black, 1 fully lit. Defaults to 0.25. */
    lightLevel?: number
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

/** A game as the server saves and serves it. The id is assigned by the server, not generated. */
export interface SavedGame extends Game {
    /** server/games/<id>/ holds the game and its generated assets. */
    id: string
}
