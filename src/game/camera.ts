import { Vector3 } from "three";

// Fixed camera offset from the player. The camera's orientation is set once
// from this and never changes; only its position follows the player.
export const CAMERA_OFFSET = new Vector3(0, 6, 9);
