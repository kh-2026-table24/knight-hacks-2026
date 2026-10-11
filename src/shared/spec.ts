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
  /**
   * The player's goals, in the order she meets them, shown one at a time on screen so she never gets
   * stuck. objectives[0] is shown from the start. Each later one becomes current when she finishes
   * interacting with a prop, character or pickup whose `objective` is its id. It never goes back to an
   * earlier one.
   */
  objectives: ObjectiveSpec[];
  /** Shown before play starts: a picture with the story so far. */
  intro?: IntroSpec;
}

export interface IntroSpec {
  /** What the opening picture shows: one wide scene that sets up the story ("the farmhouse at dusk, one window lit"). */
  art: string;
  /** The story so far, shown over the picture one paragraph at a time. */
  text: string[];
}

export interface ObjectiveSpec {
  id: string;
  /** One short instruction that names what to do and where ("Search the keeper's desk for his logbook"). */
  text: string;
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
   * Boxes and wedges only: a base color, "#rrggbb". With a material, its texture is recolored to this
   * color and keeps its pattern (unlike tint, it can lighten as well as darken). Without one, the part
   * is plain color and needs no image: painted trim, a plain beam, a dark plinth.
   */
  color?: string;
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
  /** Specific and visual ("iron-bound oak sea chest, lid forced open, front view"); the default picture for its panels. */
  name: string;
  /** Room coordinates of the prop's origin (its bottom-center). y is above 0 for things on platforms or walls. */
  position: Vec3;
  /** Its front faces south (+z) at 0. */
  rotationY: number;
  /** What its boxes and wedges are made of. Required unless each of them has its own material or color. */
  material?: string;
  parts: PartSpec[];
  /**
   * More of the same prop at these positions, each with the same parts, rotation and look: a row of
   * gravestones, scattered tussocks, a stack of crates. Not for props with examine or contains. The
   * parser turns each into its own prop (id "<id>-copy-1" and so on).
   */
  copies?: Vec3[];
  /** Given off from its tallest part. */
  light?: LightSpec;
  /** [E] Examine: what the player notices, shown one line at a time. The first look also drops `contains`. */
  examine?: string[];
  /** Shown on every later [E] instead of `examine`. Without it, `examine` repeats, unless the prop held an item. */
  afterwards?: string[];
  /** Dropped once, at the end of the first examine (or straight away on [E] Search if there is no examine). */
  contains?: ItemSpec;
  /** Id of the objective that becomes current at the end of the first examine or search. */
  objective?: string;
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
  /**
   * [E] Talk: its one conversation, shown one line at a time the first time the player talks to it.
   * Required unless the character is hostile; a character the player can't talk to is left out of the
   * game. The conversation ends in an outcome: it `gives` a key, sets an `objective`, or both.
   */
  dialogue?: string[];
  /**
   * What it says on every later talk, the same every time: a brush-off that gives no further help
   * ("I've told you all I know, miss."). The dialogue is never repeated.
   */
  afterwards?: string[];
  /** Handed over once, at the end of the first conversation. */
  gives?: ItemSpec;
  /** Id of the objective that becomes current at the end of the first conversation. */
  objective?: string;
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
  /** Id of the objective that becomes current when the player picks it up. */
  objective?: string;
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
  objectives: 20,
  objectiveLength: 80,
  introParagraphs: 5,
  introParagraphLength: 400,
  roomSide: [6, 30],
  roomHeight: [3, 10],
  propsPerRoom: 250,
  partsPerProp: 24,
  charactersPerRoom: 4,
  pickupsPerRoom: 6,
  propLightsPerRoom: 8,
  /** Prop lights plus character lights and glows; each is a real light, and they cost shader time. */
  lightsPerRoom: 12,
  /** The prompts ask for 8 at most; this is the old 6 conversations of 8 lines, which saved games play as one. */
  dialogueLines: 48,
  afterwardsLines: 3,
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
  /** Generation keeps a game to this many images; rooms over their share are asked to reuse more. */
  artJobsWarning: 100,
  artJobs: 300,
} as const;

export const DEFAULTS = {
  baseLight: 0.25,
  ambience: { outdoor: "wind", indoor: "room" },
  idle: ["standing still"],
} as const;
