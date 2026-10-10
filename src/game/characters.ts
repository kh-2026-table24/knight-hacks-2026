import { PointLight } from "three";
import { CAMERA_OFFSET } from "./camera";

// Characters (the player and NPCs) are drawn as flat 2D sprites: their own picture at a brightness
// set by the room, not shaded by nearby lights (which makes them look like lit sheets of cardboard),
// plus a soft glow they carry that lights the floor around them.

/**
 * The camera looks down at an angle, which squashes anything standing upright. Stretching
 * characters by this much makes them show on screen at their real proportions.
 */
export const CHARACTER_STRETCH = CAMERA_OFFSET.length() / Math.hypot(CAMERA_OFFSET.x, CAMERA_OFFSET.z);

/** How bright characters are drawn in a room with this lightLevel: dimmer in the dark, never invisible. */
export const characterBrightness = (lightLevel: number) => Math.min(1, 0.7 + 0.6 * lightLevel);

const GLOW_COLOR = 0xffe2c4;
const GLOW_INTENSITY = 10;
const GLOW_RANGE = 6;

/** The glow a character carries, placed for a character `height` tall whose origin is at its feet. */
export function createCharacterGlow(height: number) {
  const glow = new PointLight(GLOW_COLOR, GLOW_INTENSITY, GLOW_RANGE, 2);
  // Chest height and a little toward the camera, so it lights the floor in front as well as behind.
  glow.position.set(0, height * 0.6, 0.4);
  return glow;
}
