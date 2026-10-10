import { Vector3 } from "three";
import { Object } from "./Object";
import type { Side } from "./Connection";
import type { TextureLibrary } from "./TextureLibrary";
import { ObjectType, type Door as DoorOutput, type Object as ObjectOutput } from "./generation/output/output";

// Doors stand this far in from the room's edge, so they show in front of walls up to 0.3 thick.
const DOOR_INSET = 0.31;
// South exits are a dark strip this deep along the front edge of the floor.
const EXIT_DEPTH = 0.8;
// How far in front of a door the player appears when arriving through it.
const ARRIVAL_DISTANCE = 1;

const INWARD: Record<Side, Vector3> = {
  north: new Vector3(0, 0, 1),
  south: new Vector3(0, 0, -1),
  east: new Vector3(-1, 0, 0),
  west: new Vector3(1, 0, 0),
};

export class Door extends Object {
  readonly connectionId: string;
  readonly side: Side;

  constructor(output: DoorOutput, textures: TextureLibrary, side: Side, roomSize: Vector3) {
    super(placeDoor(output, side, roomSize), textures);
    this.connectionId = output.connectionId;
    this.side = side;

    if (side === "south") {
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
    const depth = this.side === "south" ? EXIT_DEPTH : this.size.z / 2;
    return this.mesh.position.clone().setY(0).addScaledVector(INWARD[this.side], depth + ARRIVAL_DISTANCE);
  }
}

function placeDoor(output: DoorOutput, side: Side, room: Vector3): ObjectOutput {
  const [w, , d] = output.scale;
  const inset = DOOR_INSET + d / 2;
  const base = { ...output, position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] };

  switch (side) {
    case "north":
      return { ...base, position: [output.offset, 0, inset] };
    case "east":
      return { ...base, position: [room.x - inset, 0, output.offset], rotation: [0, -Math.PI / 2, 0] };
    case "west":
      return { ...base, position: [inset, 0, output.offset], rotation: [0, Math.PI / 2, 0] };
    case "south":
      // A flat strip lying on the floor along the front edge, instead of a door blocking the camera.
      return {
        id: output.id,
        type: ObjectType.Plane,
        position: [output.offset, 0.01, room.z],
        rotation: [-Math.PI / 2, 0, 0],
        scale: [w, EXIT_DEPTH, 0],
        collisionsEnabled: false,
      };
  }
}
