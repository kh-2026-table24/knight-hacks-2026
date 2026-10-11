import { Vector3 } from "three";

// Fixed camera offset from the player. The camera's orientation is set once
// from this and never changes; only its position follows the player.
export const CAMERA_OFFSET = new Vector3(0, 6, 9);

/** How far the camera looks down, in radians. A sprite leaned back this far faces it square-on. */
export const CAMERA_PITCH = Math.atan2(CAMERA_OFFSET.y, Math.hypot(CAMERA_OFFSET.x, CAMERA_OFFSET.z));
