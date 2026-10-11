import { PLAYER } from "./constants";

// GameSpec: the one JSON a game consists of. Claude writes it, the server validates and saves it, and
// the client plays it. These types are the normalized form: once parsed (parseSpec.ts), every field
// that has a default is filled in, so the engine never guesses. Claude's JSON may leave them out.
//
// Units are meters and rotations are radians. Room space: x 0..W (east +), z 0..D (south +; z = D is
// nearest the camera), y up, with the floor's top at y = 0.

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export interface GameSpec {
  version: 1;
  title: string;
  /** 2–5 sentences on what happened here. Nothing reads it at runtime yet; the story phase builds on it. */
  summary: string;
  /** rooms[0] is where the game starts. */
  rooms: RoomSpec[];
  connections: ConnectionSpec[];
}

export interface ConnectionSpec {
  id: string;
  /** Two rooms whose grid cells differ by 1 in exactly one coordinate. */
  rooms: [string, string];
  /** Opened by a key whose `unlocks` is this id; it then opens from both sides. */
  locked: boolean;
}

export interface RoomSpec {
  id: string;
  name: string;
  /** Outdoors only the north wall (the building's face) is built; indoors the north, west and east walls. The south side is always open to the camera. */
  outdoor: boolean;
  /** [x, z] map cell; north is -z, east is +x. One room per cell. */
  grid: Vec2;
  /** [W, H, D]. */
  size: Vec3;
  /** [x, z] floor spot where the game starts (rooms[0]) and where the player respawns. */
  start: Vec2;
  /** Brightness before any lights: 0 is pitch black, 1 fully lit. */
  baseLight: number;
  /** Material descriptions ("damp green-black fieldstone"); they become tiled surface textures. */
  walls: string;
  floor: string;
  /** "#rrggbb" multiplied over the walls' or floor's texture, so another room can reuse the same material in a different color. */
  wallsTint?: string;
  floorTint?: string;
  /** What walking on the floor sounds like. Defaults to a guess from `floor`. */
  footsteps: Footsteps;
  /** The room's background sound. Defaults to "wind" outdoors and "room" indoors. */
  ambience: Ambience;
  doors: DoorSpec[];
  props: PropSpec[];
  characters: CharacterSpec[];
  pickups: PickupSpec[];
}

/** wood: boards, planks. stone: stone, tile, concrete, metal. grass: grass, dirt, mud, leaves. carpet: rugs, fabric. snow: snow, ice. */
export const FOOTSTEPS = ["wood", "stone", "grass", "carpet", "snow"] as const;
export type Footsteps = (typeof FOOTSTEPS)[number];

/** wind: open air. rain: a storm outside, or on the roof. room: the low hum of a quiet building. drip: water dripping (cellars, caves, crypts). */
export const AMBIENCES = ["wind", "rain", "room", "drip"] as const;
export type Ambience = (typeof AMBIENCES)[number];

export interface DoorSpec {
  connection: string;
  /** Position along the wall: x for north/south doors, z for east/west doors. */
  offset: number;
  /** Cutout art; defaults to a door set into the room's walls. */
  art?: string;
}

export const SHAPES = ["box", "wedge", "panel"] as const;
export type Shape = (typeof SHAPES)[number];

export interface PartSpec {
  /**
   * box: a box. wedge: full height at its north (-z) end, sloping to nothing at its south end; the
   * player climbs it if its depth is at least its height. panel: a flat picture facing south (+z).
   */
  shape: Shape;
  /** Bottom-center of the part, in its prop's frame. */
  position: Vec3;
  rotation: Vec3;
  /** [width, height, depth]. Panels use depth 0. */
  size: Vec3;
  /** Blocks movement. Defaults to true for boxes and wedges, false for panels. */
  solid: boolean;
  /** Boxes and wedges only: overrides the prop's material for this part. */
  material?: string;
  /** Panels only: what the picture shows. Defaults to the prop's name. */
  art?: string;
  /**
   * Panels only: further animation frames after `art`, described as changes ("the rope swings left").
   * Played slowly (about 3 a second), looping. Only for things that move; a whole animation is 4 to 6 frames.
   */
  frames?: string[];
  /**
   * "#rrggbb" multiplied over the part's picture or material. The same image tinted differently reads
   * as a different object (a pale and a dark chair) without generating another image. Omit for none.
   */
  tint?: string;
}

export interface PropSpec {
  /** Unique within its room. */
  id: string;
  /** Specific and evocative ("iron-bound sea chest, lid forced open"); the default picture for its panels. */
  name: string;
  /** Room coordinates of the prop's origin (its bottom-center). y is above 0 for things on platforms or walls. */
  position: Vec3;
  /** Its front faces south (+z) at 0. */
  rotationY: number;
  /** What its boxes and wedges are made of. Required unless each of them has its own. */
  material?: string;
  parts: PartSpec[];
  /** Given off from its tallest part. */
  light?: LightSpec;
  /** [E] Examine: each press plays the next conversation, and the last one repeats. */
  examine?: Conversation[];
  /** Dropped once, when the player first finishes the last examine conversation (or straight away on [E] Search if there is none). */
  contains?: ItemSpec;
  /** Touching it hurts. */
  hazard?: Damage;
  /** Decorative particles it keeps giving off. */
  ambient?: AmbientSpec;
}

export interface CharacterSpec {
  /** Unique within its room. */
  id: string;
  /** The default speaker of its conversations. */
  name: string;
  /** Feet position; y is the floor or platform it stands on. Characters never fall. */
  position: Vec3;
  /** [width, height]. */
  size: Vec2;
  art: CharacterArt;
  /** Blocks the player. */
  solid: boolean;
  movement?: Movement;
  /** [E] Talk: each press plays the next conversation, and the last one repeats. */
  dialogue?: Conversation[];
  /** Dropped once, when the player first finishes the last conversation. */
  gives?: ItemSpec;
  hostile?: Damage;
  /** Without a light of its own, a character carries the standard soft glow. */
  light?: LightSpec;
}

export interface CharacterArt {
  /** The subject, drawn once as the reference for every frame ("hunched caretaker holding a dim lantern"). */
  description: string;
  /** One pose per frame, played slowly (about 3 a second). idle[0] is the reference image. A single pose is fine; an animation is 4 to 6. */
  idle: string[];
  moving?: string[];
}

export const MOVEMENT_TYPES = ["wander", "patrol", "chase"] as const;
export type Movement =
  /** Drifts around where it was placed. */
  | { type: "wander"; speed: number; radius: number }
  /** Walks between [x, z] points at its own height, in order, looping. */
  | { type: "patrol"; speed: number; points: Vec2[] }
  /** Locks on to the player within detectRadius, gives up beyond 1.5 times that, then walks home. */
  | { type: "chase"; speed: number; detectRadius: number };

export interface Conversation {
  /** Defaults to the character's name; examine text has no speaker. */
  speaker?: string;
  /** Shown one at a time. */
  lines: string[];
}

export const ITEM_KINDS = ["key"] as const;
export interface KeySpec {
  kind: "key";
  name: string;
  art: string;
  /** Id of the locked connection it opens. */
  unlocks: string;
}
export type ItemSpec = KeySpec;

/** An item lying in the room, collected by walking up to it. */
export interface PickupSpec {
  /** Unique within its room. */
  id: string;
  item: ItemSpec;
  position: Vec3;
}

export interface Damage {
  /** Hearts taken per hit. */
  damage: number;
}

export const LIGHT_TYPES = ["glow", "spot"] as const;
export const LIGHT_EFFECTS = ["steady", "flicker", "pulse"] as const;
export interface LightSpec {
  /** glow: shines every way from near the top, and the prop glows itself. spot: a cone down onto it from above. */
  type: (typeof LIGHT_TYPES)[number];
  /** "#rrggbb". */
  color: string;
  /** 1 a candle, 3 a lantern, 6 a fireplace or overhead lamp. */
  intensity: number;
  /** How far a glow reaches, or the radius of a spot's pool of light. */
  range: number;
  effect: (typeof LIGHT_EFFECTS)[number];
}

export interface AmbientSpec {
  art: string;
  size: Vec2;
  /** Average gap between particles; the engine adds ±50% jitter. */
  everySeconds: number;
  lifetimeSeconds: number;
  velocity: Vec3;
  /** False for things that float (embers, motes). */
  gravity: boolean;
}

/** Hard limits the parser enforces. Deliberately looser than what the prompts ask for. */
export const LIMITS = {
  rooms: 12,
  roomSide: [6, 30],
  roomHeight: [3, 10],
  propsPerRoom: 80,
  partsPerProp: 16,
  charactersPerRoom: 4,
  pickupsPerRoom: 6,
  propLightsPerRoom: 8,
  /** Prop lights plus character lights and glows; each is a real light, and they cost shader time. */
  lightsPerRoom: 12,
  conversations: 6,
  linesPerConversation: 8,
  lineLength: 220,
  lightIntensity: 10,
  lightRange: 20,
  /** Every mover stays slower than the player, so a chase can always be escaped. */
  maxSpeed: 0.8 * PLAYER.speed,
  detectRadius: 12,
  wanderRadius: [0.5, 8],
  patrolPoints: 8,
  framesPerState: 6,
  characterWidth: [0.2, 3],
  characterHeight: [0.2, 4],
  ambientEvery: 0.5,
  ambientLifetime: 10,
  artJobsWarning: 120,
  artJobs: 200,
} as const;

export const DEFAULTS = {
  baseLight: 0.25,
  ambience: { outdoor: "wind", indoor: "room" },
  idle: ["standing still"],
} as const;
