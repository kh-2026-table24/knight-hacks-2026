// Every number the engine, the validator and the generation prompts must agree on lives here, so a
// change in one place can't leave the others describing a different game.

/** The protagonist: a capsule moved by a kinematic character controller. */
export const PLAYER = {
  radius: 0.35,
  height: 1.8,
  /** Highest ledge the controller steps up onto. */
  stepHeight: 0.35,
  /** Steepest slope it walks up. */
  maxSlopeDeg: 50,
  /** Meters per second. */
  speed: 5,
  maxHearts: 4,
  /** After a hit the player can't be hurt again for this long. */
  invulnerableSeconds: 1.2,
  /** How far beyond the collider still counts as touching something. */
  touchMargin: 0.1,
  gravity: 20,
} as const;

/** After respawning, a grace period so whatever killed the player can't do it again at once. */
export const RESPAWN_INVULNERABLE_SECONDS = 2;

/** Doors stand in front of their wall; south doors are an exit strip on the floor instead. */
export const DOOR = {
  width: 1.6,
  height: 3,
  /** Distance from the room's edge, so doors show in front of walls up to 0.3 m thick. */
  inset: 0.31,
  /** Depth of a south exit strip along the front edge of the floor. */
  exitDepth: 0.8,
  /** How far in front of a door the player appears when arriving through it. */
  arrivalDistance: 1,
  /** Closest a door's center may be to the end of its wall. */
  edgeMargin: 1,
} as const;

/**
 * The biggest room generation asks for: three quarters of what the parser accepts (spec.ts LIMITS), so
 * rooms stay compact and full. Games saved with bigger rooms still load.
 */
export const GENERATED_ROOM = { maxSide: 22.5, maxHeight: 7.5 } as const;

/** The engine builds walls itself, always this thick. */
export const WALL_THICKNESS = 0.3;

/** [E] reaches things this close (horizontal distance from the player's center to the target's footprint). */
export const INTERACT = {
  range: 1.0,
  /** A target's bottom can be at most this far above the player's feet (a painting on a wall). */
  maxHeightAboveFeet: 2.0,
} as const;

/** Pickups are collected by walking up to them. */
export const PICKUP = {
  /** Horizontal distance from the player's center. */
  range: 0.6,
  /** How far below the player's feet a pickup can be and still be reached. */
  below: 0.3,
  /** Seconds before a dropped item can be picked up, so it's seen falling out first. */
  delaySeconds: 0.75,
} as const;

/** The validator requires every prop to come within this distance of somewhere the player can walk. */
export const REACH = 1.5;

/** Animation speed of the player's sprite: 6 frames a second. */
export const FRAME_SECONDS = 1 / 6;
/** Animation speed of generated sprites (props and characters): slow, about 3 frames a second. */
export const ART_FRAME_SECONDS = 1 / 3;

/** Physics runs at a fixed 60 Hz, decoupled from the display's frame rate. */
export const PHYSICS_STEP = 1 / 60;
/** Longest frame the simulation catches up on, so a stall doesn't snowball. */
export const MAX_FRAME_DT = 0.25;
