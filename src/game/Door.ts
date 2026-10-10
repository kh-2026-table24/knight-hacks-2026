import { Vector3 } from "three";
import { artFor } from "../shared/art";
import { arrivalPoint, placeDoor, type Side } from "../shared/geometry";
import type { DoorSpec, RoomSpec } from "../shared/spec";
import { Part } from "./Part";
import type { TextureLibrary } from "./TextureLibrary";

/** One side of a connection. Touching it goes through, or reports that it's locked. Placement comes from shared/geometry. */
export class Door extends Part {
  readonly connectionId: string;
  readonly side: Side;
  private readonly arrival: Vector3;

  constructor(door: DoorSpec, room: RoomSpec, side: Side, textures: TextureLibrary) {
    const placement = placeDoor(room, door, side);
    const standing = placement.kind === "standing";
    super(
      { shape: "panel", position: placement.position, rotation: placement.rotation, size: placement.size, solid: standing },
      { texture: standing ? textures.get(artFor.door(room, door).id) : undefined },
    );
    this.connectionId = door.connection;
    this.side = side;
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

  /** Where the player appears when arriving through this door: just inside the room, in front of it. */
  arrivalPoint() {
    return this.arrival.clone();
  }
}
