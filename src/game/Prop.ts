import { Group as ThreeGroup, type Object3D } from "three";
import type { World } from "@dimforge/rapier3d-compat";
import { Part } from "./Part";
import { Character } from "./Character";
import type { TextureLibrary } from "./TextureLibrary";
import type { Group as GroupOutput, Object as ObjectOutput, Sprite as SpriteOutput } from "./generation/output/output";

export class Prop {
  readonly id: string;
  readonly root = new ThreeGroup();
  readonly objects: Part[];
  readonly groups: Prop[];

  constructor(output: GroupOutput, textures: TextureLibrary) {
    this.id = output.id;
    this.root.position.fromArray(output.position);
    this.root.rotation.fromArray(output.rotation);
    this.objects = output.objects.map((o) => createObject(o, textures));
    this.groups = (output.groups ?? []).map((g) => new Prop(g, textures));
  }

  addTo(parent: Object3D, world: World) {
    parent.add(this.root);
    for (const obj of this.objects) obj.addTo(this.root, world);
    for (const group of this.groups) group.addTo(this.root, world);
  }

  removeFrom(parent: Object3D, world: World) {
    for (const obj of this.objects) obj.removeFrom(this.root, world);
    for (const group of this.groups) group.removeFrom(this.root, world);
    parent.remove(this.root);
  }
}

// The output has no explicit kind field, so tell sprites apart by the fields only they have.
function createObject(output: ObjectOutput | SpriteOutput, textures: TextureLibrary) {
  if (["animations", "actions", "item", "movement", "dialogues"].some((key) => key in output)) {
    return new Character(output as SpriteOutput, textures);
  }
  return new Part(output, textures);
}
