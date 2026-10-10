import { DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from "three";
import {
  Capsule,
  ColliderDesc,
  QueryFilterFlags,
  RigidBodyDesc,
  type Collider,
  type KinematicCharacterController,
  type RigidBody,
  type World,
} from "@dimforge/rapier3d-compat";
import { CHARACTER_STRETCH, characterBrightness, createCharacterGlow } from "./characters";
import { PLAYER_COLLISION_GROUPS } from "./Object";
import { PLAYER } from "../shared/constants";
import type { Item } from "./generation/output/output";

const MOVE_KEYS = new Set(["w", "a", "s", "d"]);
const WIDTH = 1;
const { height: HEIGHT, radius: RADIUS, gravity: GRAVITY, stepHeight: MAX_STEP_HEIGHT, touchMargin: TOUCH_MARGIN } = PLAYER;
const MAX_SLOPE = (PLAYER.maxSlopeDeg * Math.PI) / 180;
const NO_ROTATION = { x: 0, y: 0, z: 0, w: 1 };
// Gap the character controller keeps from surfaces. Spawning closer than this counts as stuck in the floor.
const CONTROLLER_OFFSET = 0.02;
const SPAWN_LIFT = 0.05;
export const MAX_HEARTS = PLAYER.maxHearts;
// The player blinks while invulnerable after a hit.
const INVULNERABLE_SECONDS = PLAYER.invulnerableSeconds;
// Placeholder color until the player has a sprite.
const COLOR = 0xd0d0d0;

/** The protagonist: an upright 2D plane facing the camera, moved with WASD on the ground (XZ) plane. */
export class Player {
  readonly mesh: Mesh;
  readonly inventory: Item[] = [];
  speed: number = PLAYER.speed;
  hearts: number = MAX_HEARTS;
  /** Ignores movement keys, e.g. while a dialogue is open. */
  frozen = false;
  private invulnerableFor = 0;
  private readonly material: MeshBasicMaterial;
  private readonly keys = new Set<string>();
  private readonly movement = new Vector3();
  private verticalVelocity = 0;
  private readonly body: RigidBody;
  private readonly collider: Collider;
  private readonly controller: KinematicCharacterController;
  private readonly touchShape = new Capsule(HEIGHT / 2 - RADIUS, RADIUS + TOUCH_MARGIN);

  constructor(world: World) {
    // Shift geometry up so the mesh origin sits at the character's feet, and stretch it so the
    // camera's downward angle doesn't squash it.
    const geometry = new PlaneGeometry(WIDTH, HEIGHT).translate(0, HEIGHT / 2, 0).scale(1, CHARACTER_STRETCH, 1);
    this.material = new MeshBasicMaterial({ color: COLOR, side: DoubleSide });
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.add(createCharacterGlow(HEIGHT));

    // Body origin is also at the feet; the capsule sits above it.
    this.body = world.createRigidBody(RigidBodyDesc.kinematicPositionBased());
    this.collider = world.createCollider(
      ColliderDesc.capsule(HEIGHT / 2 - RADIUS, RADIUS)
        .setTranslation(0, HEIGHT / 2, 0)
        .setCollisionGroups(PLAYER_COLLISION_GROUPS),
      this.body,
    );
    this.controller = world.createCharacterController(CONTROLLER_OFFSET);
    this.controller.enableAutostep(MAX_STEP_HEIGHT, 0.2, false);
    this.controller.enableSnapToGround(MAX_STEP_HEIGHT);
    this.controller.setMaxSlopeClimbAngle(MAX_SLOPE);

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

  reset(position: Vector3, world: World) {
    // Start just above the given point and let gravity settle it.
    this.mesh.position.copy(position).setY(position.y + SPAWN_LIFT);
    this.body.setTranslation(this.mesh.position, true);
    world.propagateModifiedBodyPositionsToColliders();
    this.verticalVelocity = 0;
    this.keys.clear();
  }

  /** Draws the player at the brightness characters have in a room with this lightLevel. */
  setRoomLight(lightLevel: number) {
    this.material.color.set(COLOR).multiplyScalar(characterBrightness(lightLevel));
  }

  /** Takes `amount` hearts unless recently hit. Returns whether it landed. */
  hurt(amount: number) {
    if (this.invulnerableFor > 0 || this.hearts === 0) return false;
    this.hearts = Math.max(0, this.hearts - amount);
    this.invulnerableFor = INVULNERABLE_SECONDS;
    return true;
  }

  heal() {
    this.hearts = MAX_HEARTS;
    this.invulnerableFor = 0;
    this.material.visible = true;
  }

  update(dt: number) {
    if (this.invulnerableFor > 0) {
      this.invulnerableFor = Math.max(0, this.invulnerableFor - dt);
      // Blink the material, not the mesh: hiding the mesh would also switch off the glow it carries.
      this.material.visible = this.invulnerableFor === 0 || Math.floor(this.invulnerableFor * 10) % 2 === 0;
    }
    if (this.frozen) this.keys.clear();

    const m = this.movement.set(0, 0, 0);
    if (this.keys.has("w")) m.z -= 1;
    if (this.keys.has("s")) m.z += 1;
    if (this.keys.has("a")) m.x -= 1;
    if (this.keys.has("d")) m.x += 1;
    if (m.lengthSq() > 0) m.normalize().multiplyScalar(this.speed * dt);

    this.verticalVelocity -= GRAVITY * dt;
    m.y = this.verticalVelocity * dt;

    // Walk through sensors and dynamic things (dropped items); collide with everything else.
    this.controller.computeColliderMovement(this.collider, m, QueryFilterFlags.EXCLUDE_SENSORS | QueryFilterFlags.EXCLUDE_DYNAMIC);
    if (this.controller.computedGrounded()) this.verticalVelocity = 0;

    const corrected = this.controller.computedMovement();
    const t = this.body.translation();
    this.mesh.position.set(t.x + corrected.x, t.y + corrected.y, t.z + corrected.z);
    this.body.setNextKinematicTranslation(this.mesh.position);
  }

  /** Colliders currently touching the player. */
  touching(world: World) {
    const hits: Collider[] = [];
    const { x, y, z } = this.mesh.position;
    world.intersectionsWithShape(
      { x, y: y + HEIGHT / 2, z },
      NO_ROTATION,
      this.touchShape,
      (c) => {
        hits.push(c);
        return true;
      },
      undefined,
      undefined,
      this.collider,
    );
    return hits;
  }
}
