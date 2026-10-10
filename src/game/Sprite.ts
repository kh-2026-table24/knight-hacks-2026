import type { Texture } from "three";
import { Object } from "./Object";
import type { TextureLibrary } from "./TextureLibrary";
import type {
  Animations,
  CollisionAction,
  Dialogue,
  EmitAction,
  Item,
  Movement,
  Sprite as SpriteOutput,
} from "./generation/output/output";

export type AnimationState = keyof Animations;

export class Sprite extends Object {
  /** Frames per state, with unknown texture ids dropped. */
  readonly animations: Partial<Record<AnimationState, Texture[]>> = {};
  readonly collision: CollisionAction | undefined;
  readonly emit: EmitAction | undefined;
  readonly item: Item | undefined;
  readonly movement: Movement | undefined;
  readonly dialogue: Dialogue | undefined;

  constructor(output: SpriteOutput, textures: TextureLibrary) {
    super(output, textures);

    for (const state in output.animations) {
      const ids = output.animations[state as AnimationState] ?? [];
      const frames = ids.map((id) => textures.get(id)).filter((t) => t !== undefined);
      if (frames.length > 0) this.animations[state as AnimationState] = frames;
    }
    this.setTexture(this.animations.idle?.[0]);

    this.collision = output.actions?.collision;
    this.emit = output.actions?.emit;
    this.item = output.item;
    this.movement = output.movement;
    this.dialogue = output.dialogue?.lines.length ? output.dialogue : undefined;
  }

  override get touchable() {
    return (
      this.item !== undefined ||
      this.collision !== undefined ||
      this.dialogue !== undefined ||
      this.emit?.when.type === "collision"
    );
  }
}
