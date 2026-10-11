import { Vector3 } from "three";
import { artFor } from "../shared/art";
import { DOOR, PLAYER } from "../shared/constants";
import { arrivalPoint, placeDoor, type Side } from "../shared/geometry";
import type { DoorSpec, RoomSpec } from "../shared/spec";
import { Part, PLANE_COLLIDER_DEPTH } from "./Part";
import type { TextureLibrary } from "./TextureLibrary";

// How far the player's center may be from where a standing door stops her and still be walking into it:
// enough that a sill or trim sticking out a little in front of the door doesn't keep her from it.
const PRESS_MARGIN = 0.12;

/** One side of a connection. Walking into it goes through, or reports that it's locked. Placement comes from shared/geometry. */
export class Door extends Part {
  readonly connectionId: string;
  readonly side: Side;
  private readonly arrival: Vector3;
  /** Middle of the door's bottom edge, in room coordinates. */
  private readonly base: Vector3;

  constructor(door: DoorSpec, room: RoomSpec, side: Side, textures: TextureLibrary) {
    const placement = placeDoor(room, door, side);
    const standing = placement.kind === "standing";
    super(
      { shape: "panel", position: placement.position, rotation: placement.rotation, size: placement.size, solid: standing },
      { texture: standing ? textures.get(artFor.door(room, door).id) : undefined },
    );
    this.connectionId = door.connection;
    this.side = side;
    this.base = new Vector3().fromArray(placement.position);
    const [x, z] = arrivalPoint(room, door, side);
    this.arrival = new Vector3(x, 0, z);

    if (!standing) {
      // A south door would block the camera, so it's a dark strip on the floor along the open edge.
      const material = this.mesh.material;
      material.color.set(0x000000);
      material.transparent = true;
      material.opacity = 0.75;
      material.depthWrite = false;
    }
  }

  override get touchable() {
    return true;
  }

  /**
   * Whether the player, with her feet at `feet`, is walking into the door: square in front of a standing
   * door and up against it, or well onto a south exit strip. Brushing past a door's edge doesn't count.
   */
  isEnteredFrom(feet: Vector3) {
    const { x, z } = this.base;
    const halfWidth = DOOR.width / 2;
    switch (this.side) {
      case "south":
        return Math.abs(feet.x - x) <= halfWidth && feet.z >= z - DOOR.exitDepth + PLAYER.radius;
      case "north":
        return Math.abs(feet.x - x) <= halfWidth && feet.z - z <= this.pressedDistance;
      case "west":
        return Math.abs(feet.z - z) <= halfWidth && feet.x - x <= this.pressedDistance;
      case "east":
        return Math.abs(feet.z - z) <= halfWidth && x - feet.x <= this.pressedDistance;
    }
  }

  /** How close the player's center gets to a standing door: its collider sticks out in front of it, plus her radius. */
  private get pressedDistance() {
    return PLANE_COLLIDER_DEPTH / 2 + PLAYER.radius + PRESS_MARGIN;
  }

  /** Where the player appears when arriving through this door: just inside the room, in front of it. */
  arrivalPoint() {
    return this.arrival.clone();
  }
}
