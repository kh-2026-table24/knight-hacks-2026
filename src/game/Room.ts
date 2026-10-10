import { BoxGeometry, Mesh, MeshStandardMaterial, Vector3, type Scene } from "three";
import { ColliderDesc, RigidBodyDesc, type RigidBody, type World } from "@dimforge/rapier3d-compat";
import { Object } from "./Object";
import type { Room as RoomOutput } from "./generation/output/output";

const FLOOR_THICKNESS = 0.2;

// The room spans x: 0..width, z: 0..depth, with the floor's top at y = 0.
// dimensions: [width, height, depth]
export class Room {
  readonly id: string;
  readonly dimensions: Vector3;
  readonly startPosition: Vector3;
  readonly objects: Object[];
  private readonly floor: Mesh;
  private readonly colliderDescs: ColliderDesc[];
  private body: RigidBody | null = null;

  constructor(output: RoomOutput) {
    this.id = output.id;
    this.dimensions = new Vector3().fromArray(output.dimensions);
    this.startPosition = new Vector3().fromArray(output.startPosition);
    this.objects = output.objects.map((o) => new Object(o));

    const { x: w, y: h, z: d } = this.dimensions;
    this.floor = new Mesh(new BoxGeometry(w, FLOOR_THICKNESS, d), new MeshStandardMaterial({ color: 0x1c1a17 }));
    this.floor.position.set(w / 2, -FLOOR_THICKNESS / 2, d / 2);

    // Invisible walls around the edges so the player can't leave the room.
    this.colliderDescs = [
      ColliderDesc.cuboid(w / 2, h / 2, 0.5).setTranslation(w / 2, h / 2, -0.5),
      ColliderDesc.cuboid(w / 2, h / 2, 0.5).setTranslation(w / 2, h / 2, d + 0.5),
      ColliderDesc.cuboid(0.5, h / 2, d / 2).setTranslation(-0.5, h / 2, d / 2),
      ColliderDesc.cuboid(0.5, h / 2, d / 2).setTranslation(w + 0.5, h / 2, d / 2),
    ];
  }

  addTo(scene: Scene, world: World) {
    scene.add(this.floor);
    if (!this.body) {
      this.body = world.createRigidBody(RigidBodyDesc.fixed());
      for (const desc of this.colliderDescs) world.createCollider(desc, this.body);
    }
    for (const obj of this.objects) obj.addTo(scene, world);
  }

  removeFrom(scene: Scene, world: World) {
    scene.remove(this.floor);
    if (this.body) {
      world.removeRigidBody(this.body);
      this.body = null;
    }
    for (const obj of this.objects) obj.removeFrom(scene, world);
  }
}
