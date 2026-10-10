import { DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from "three";
import {
  ColliderDesc,
  RigidBodyDesc,
  type Collider,
  type KinematicCharacterController,
  type RigidBody,
  type World,
} from "@dimforge/rapier3d-compat";

const MOVE_KEYS = new Set(["w", "a", "s", "d"]);
const WIDTH = 1;
const HEIGHT = 1.8;
const RADIUS = 0.35;

/** The protagonist: an upright 2D plane facing the camera, moved with WASD on the ground (XZ) plane. */
export class Player {
  readonly mesh: Mesh;
  speed = 5;
  private readonly keys = new Set<string>();
  private readonly movement = new Vector3();
  private readonly body: RigidBody;
  private readonly collider: Collider;
  private readonly controller: KinematicCharacterController;

  constructor(world: World) {
    // Shift geometry up so the mesh origin sits at the character's feet.
    const geometry = new PlaneGeometry(WIDTH, HEIGHT).translate(0, HEIGHT / 2, 0);
    this.mesh = new Mesh(geometry, new MeshBasicMaterial({ color: 0xd0d0d0, side: DoubleSide }));

    // Body origin is also at the feet; the capsule sits above it.
    this.body = world.createRigidBody(RigidBodyDesc.kinematicPositionBased());
    this.collider = world.createCollider(
      ColliderDesc.capsule(HEIGHT / 2 - RADIUS, RADIUS).setTranslation(0, HEIGHT / 2, 0),
      this.body,
    );
    this.controller = world.createCharacterController(0.02);

    window.addEventListener("keydown", (e) => {
      const key = e.key.toLowerCase();
      if (MOVE_KEYS.has(key)) this.keys.add(key);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => this.keys.clear());
  }

  get position() {
    return this.mesh.position;
  }

  reset(position: Vector3) {
    this.mesh.position.copy(position);
    this.body.setTranslation(position, true);
    this.keys.clear();
  }

  update(dt: number) {
    const m = this.movement.set(0, 0, 0);
    if (this.keys.has("w")) m.z -= 1;
    if (this.keys.has("s")) m.z += 1;
    if (this.keys.has("a")) m.x -= 1;
    if (this.keys.has("d")) m.x += 1;
    if (m.lengthSq() === 0) return;
    m.normalize().multiplyScalar(this.speed * dt);

    // Slide along whatever we hit; ignore any vertical correction so the player stays on the ground.
    this.controller.computeColliderMovement(this.collider, m);
    const corrected = this.controller.computedMovement();
    const t = this.body.translation();
    this.mesh.position.set(t.x + corrected.x, t.y, t.z + corrected.z);
    this.body.setNextKinematicTranslation(this.mesh.position);
  }
}
