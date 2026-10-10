import { artFor } from "../shared/art";
import type { ItemSpec, Vec3 } from "../shared/spec";
import { Part } from "./Part";
import type { TextureLibrary } from "./TextureLibrary";

// Every pickup is drawn this big, whatever the item.
const SIZE = 0.4;

/**
 * An item in a room, collected by walking up to it (no collider needed, see Room.pickupsInReach).
 * Placed pickups stay where they were put; dropped ones fall under physics.
 */
export class Pickup extends Part {
  readonly item: ItemSpec;
  /** GameState key ("room/id") of a placed pickup, so it stays collected. Dropped ones are tracked by what dropped them. */
  readonly stateKey: string | undefined;
  /** Room clock time it was dropped, or undefined if it was placed. */
  readonly droppedAt: number | undefined;

  constructor(item: ItemSpec, position: Vec3, textures: TextureLibrary, origin: { stateKey: string } | { droppedAt: number }) {
    super({ shape: "panel", position, rotation: [0, 0, 0], size: [SIZE, SIZE, 0], solid: false }, { texture: textures.get(artFor.item(item).id) });
    this.item = item;
    this.stateKey = "stateKey" in origin ? origin.stateKey : undefined;
    this.droppedAt = "droppedAt" in origin ? origin.droppedAt : undefined;
    this.dynamic = this.droppedAt !== undefined;
  }
}
