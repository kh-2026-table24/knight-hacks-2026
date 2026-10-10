import { DoubleSide, Mesh, MeshBasicMaterial, NearestFilter, PlaneGeometry, SRGBColorSpace, TextureLoader, Vector3, type Texture } from "three";
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
import { PLAYER_COLLISION_GROUPS } from "./Part";
import { FRAME_SECONDS, PLAYER } from "../shared/constants";

const MOVE_KEYS = new Set(["w", "a", "s", "d"]);
// The sprites are square, with the figure filling their height.
const WIDTH = PLAYER.height;
const { height: HEIGHT, radius: RADIUS, gravity: GRAVITY, stepHeight: MAX_STEP_HEIGHT, touchMargin: TOUCH_MARGIN } = PLAYER;
const MAX_SLOPE = (PLAYER.maxSlopeDeg * Math.PI) / 180;
const NO_ROTATION = { x: 0, y: 0, z: 0, w: 1 };
// Gap the character controller keeps from surfaces. Spawning closer than this counts as stuck in the floor.
const CONTROLLER_OFFSET = 0.02;
const SPAWN_LIFT = 0.05;
// Placeholder color until the sprites load.
const COLOR = 0xd0d0d0;

// The same protagonist in every game, so her sprites ship with the client (public/sprites/girl/) rather
// than being generated per game. Side frames face right; facing left flips the mesh.
type View = "front" | "side" | "back";
const VIEWS: View[] = ["front", "side", "back"];
const POSES = ["stand", "walk-1", "walk-2"];
// Indexes into POSES. Standing is the passing pose between steps, so the walk loop reuses it.
const WALK_CYCLE = [0, 1, 0, 2];
const SPRITE_URL = (name: string) => `/sprites/girl/${name}.png`;

const textureLoader = new TextureLoader();
function loadSprite(name: string, onLoad: () => void): Texture {
  const texture = textureLoader.load(SPRITE_URL(name), onLoad);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

/**
 * The protagonist: an upright 2D plane facing the camera, moved with WASD on the ground (XZ) plane.
 * Hearts and keys are game state (GameState); the player only knows whether it's mid-blink after a hit.
 */
export class Player {
  readonly mesh: Mesh;
  speed: number = PLAYER.speed;
  /** Ignores movement keys, e.g. while a dialogue is open. */
  frozen = false;
  /** Called when a foot comes down while walking on something, for footstep sounds. */
  onStep: (() => void) | null = null;
  private grounded = false;
  private invulnerableFor = 0;
  private readonly material: MeshBasicMaterial;
  private readonly keys = new Set<string>();
  private readonly movement = new Vector3();
  private verticalVelocity = 0;
  private readonly body: RigidBody;
  private readonly collider: Collider;
  private readonly controller: KinematicCharacterController;
  private readonly touchShape = new Capsule(HEIGHT / 2 - RADIUS, RADIUS + TOUCH_MARGIN);
  /** Each view's frames, in POSES order. */
  private readonly sprites: Record<View, Texture[]>;
  private spritesLoaded = false;
  private brightness = 1;
  private view: View = "front";
  private frame = 0;
  private frameTime = 0;

  constructor(world: World) {
    // Shift geometry up so the mesh origin sits at the character's feet, and stretch it so the
    // camera's downward angle doesn't squash it.
    const geometry = new PlaneGeometry(WIDTH, HEIGHT).translate(0, HEIGHT / 2, 0).scale(1, CHARACTER_STRETCH, 1);
    this.material = new MeshBasicMaterial({ color: COLOR, side: DoubleSide, alphaTest: 0.5 });
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.add(createCharacterGlow(HEIGHT));

    // Keep the placeholder until every frame is in, so walking never flashes an empty frame.
    let pending = VIEWS.length * POSES.length;
    const onLoad = () => {
      if (--pending === 0) this.showSprites();
    };
    const load = (view: View) => POSES.map((pose) => loadSprite(`${view}-${pose}`, onLoad));
    this.sprites = { front: load("front"), side: load("side"), back: load("back") };

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
    this.brightness = characterBrightness(lightLevel);
    this.material.color.set(this.spritesLoaded ? 0xffffff : COLOR).multiplyScalar(this.brightness);
  }

  private showSprites() {
    this.spritesLoaded = true;
    this.material.map = this.sprites.front[0];
    this.material.color.set(0xffffff).multiplyScalar(this.brightness);
    this.material.needsUpdate = true;
  }

  // Faces the way she's walking (horizontal wins on diagonals) and steps through the walk loop; stands when still.
  private animate(dt: number, dx: number, dz: number) {
    const walking = dx !== 0 || dz !== 0;
    if (walking) {
      this.view = dx !== 0 ? "side" : dz < 0 ? "back" : "front";
      this.mesh.scale.x = dx < 0 ? -1 : 1;
      this.frameTime += dt;
      if (this.frameTime >= FRAME_SECONDS) {
        this.frameTime = 0;
        this.frame = (this.frame + 1) % WALK_CYCLE.length;
        // Both walk poses are a foot landing; the stand pose between them is the passing step.
        if (WALK_CYCLE[this.frame] !== 0 && this.grounded) this.onStep?.();
      }
    } else {
      this.frame = 0;
      this.frameTime = 0;
    }
    if (this.spritesLoaded) this.material.map = this.sprites[this.view][WALK_CYCLE[this.frame]];
  }

  /** False during the blinking grace period after a hit, when further hits don't land. */
  get vulnerable() {
    return this.invulnerableFor === 0;
  }

  /** Starts the blinking grace period. */
  startInvulnerability(seconds: number) {
    this.invulnerableFor = seconds;
  }

  /** Ends the grace period early and stops blinking. */
  clearInvulnerability() {
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
    this.animate(dt, m.x, m.z);
    if (m.lengthSq() > 0) m.normalize().multiplyScalar(this.speed * dt);

    this.verticalVelocity -= GRAVITY * dt;
    m.y = this.verticalVelocity * dt;

    // Walk through sensors and dynamic things (dropped items); collide with everything else.
    this.controller.computeColliderMovement(this.collider, m, QueryFilterFlags.EXCLUDE_SENSORS | QueryFilterFlags.EXCLUDE_DYNAMIC);
    this.grounded = this.controller.computedGrounded();
    if (this.grounded) this.verticalVelocity = 0;

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
