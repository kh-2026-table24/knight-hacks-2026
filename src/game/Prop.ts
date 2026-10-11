import { Group, type Box3, type Object3D, type Texture } from "three";
import type { World } from "@dimforge/rapier3d-compat";
import { artFor, materialOf } from "../shared/art";
import { ART_FRAME_SECONDS } from "../shared/constants";
import { boundsOf, lightPartIndex, placeProp } from "../shared/geometry";
import type { AmbientSpec, Damage, ItemSpec, PropSpec } from "../shared/spec";
import { Part } from "./Part";
import type { TextureLibrary } from "./TextureLibrary";

/**
 * A thing in a room built from parts that move together: furniture, scenery, the walls. It may have
 * something to read ([E] Examine), something inside it ([E] Search), hurt to touch, or give off particles.
 */
export class Prop {
  readonly id: string;
  readonly name: string;
  readonly root = new Group();
  readonly parts: Part[];
  /** Room-space box around it: how close the player must get to use it. */
  readonly bounds: Box3;
  readonly examine: string[] | undefined;
  readonly afterwards: string[] | undefined;
  readonly contains: ItemSpec | undefined;
  readonly hazard: Damage | undefined;
  readonly ambient: AmbientSpec | undefined;
  /** Panels with more than one frame, and their frames. */
  private readonly animated: { part: Part; frames: Texture[] }[] = [];
  private frame = 0;
  private frameTime = 0;

  constructor(spec: PropSpec, textures: TextureLibrary) {
    this.id = spec.id;
    this.name = spec.name;
    this.examine = spec.examine;
    this.afterwards = spec.afterwards;
    this.contains = spec.contains;
    this.hazard = spec.hazard;
    this.ambient = spec.ambient;
    this.root.position.fromArray(spec.position);
    this.root.rotation.set(0, spec.rotationY, 0);

    const lightIndex = spec.light ? lightPartIndex(spec) : -1;
    this.parts = spec.parts.map((part, i) => {
      const material = materialOf(spec, part);
      const art = part.shape === "panel" ? artFor.panel(spec, part) : material ? [artFor.surface(material)] : [];
      const frames = art.flatMap((a) => textures.get(a.id) ?? []);
      const built = new Part(part, { texture: frames[0], light: i === lightIndex ? spec.light : undefined, tint: part.tint, color: part.color });
      // Touching a hazard hurts even where it isn't solid (flames, a pool of something).
      if (spec.hazard && !part.solid) built.sensor = true;
      if (frames.length > 1) this.animated.push({ part: built, frames });
      return built;
    });
    this.bounds = boundsOf(placeProp(spec, spec.id));
  }

  addTo(parent: Object3D, world: World) {
    parent.add(this.root);
    for (const part of this.parts) part.addTo(this.root, world);
  }

  removeFrom(parent: Object3D, world: World) {
    for (const part of this.parts) part.removeFrom(this.root, world);
    parent.remove(this.root);
  }

  /** Animates panels and flickering lights. `time` is the room's clock, in seconds. */
  update(dt: number, time: number) {
    for (const part of this.parts) part.updateLight(time);
    if (this.animated.length === 0) return;
    this.frameTime += dt;
    if (this.frameTime < ART_FRAME_SECONDS) return;
    this.frameTime = 0;
    this.frame++;
    for (const { part, frames } of this.animated) part.showFrame(frames[this.frame % frames.length]);
  }
}
