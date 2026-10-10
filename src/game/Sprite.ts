import { Vector3, type Object3D, type Texture } from "three";
import { QueryFilterFlags, type KinematicCharacterController, type World } from "@dimforge/rapier3d-compat";
import { CHARACTER_STRETCH, characterBrightness, createCharacterGlow } from "./characters";
import { Object, PLAYER_GROUP } from "./Object";
import { FRAME_SECONDS } from "../shared/constants";
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

const ARRIVE_DISTANCE = 0.15; // close enough to a target to count as there
const STUCK_SECONDS = 0.6; // blocked this long (a wall, furniture), it gives up on the target
const PAUSE_SECONDS: Record<Movement["type"], [number, number]> = { wander: [1, 3], patrol: [0.5, 1], chase: [0.3, 0.6] };
// A chaser gives up once the player is this many times its detectRadius away.
const CHASE_GIVE_UP = 1.5;
// NPCs walk through the player rather than getting blocked by them: their movement ignores colliders in the player's group.
const NPC_QUERY_GROUPS = (0xffff << 16) | (0xffff & ~PLAYER_GROUP);

export class Sprite extends Object {
  /** Frames per state, with unknown texture ids dropped. */
  readonly animations: Partial<Record<AnimationState, Texture[]>> = {};
  readonly collision: CollisionAction | undefined;
  readonly emit: EmitAction | undefined;
  readonly item: Item | undefined;
  readonly movement: Movement | undefined;
  readonly dialogues: Dialogue[];
  /** How many times the player has talked to it. */
  private conversations = 0;
  /** Drawn as a flat 2D character (raw picture plus glow) rather than a lit surface. */
  private readonly characterLook: boolean;

  private readonly home: Vector3;
  private readonly target = new Vector3();
  private hasTarget = false;
  private patrolIndex = 0;
  private pauseFor = 0;
  private stuckFor = 0;
  private moving = false;
  private chasing = false;
  private controller: KinematicCharacterController | null = null;
  private frame = 0;
  private frameTime = 0;

  constructor(output: SpriteOutput, textures: TextureLibrary) {
    super(output, textures);

    for (const state in output.animations) {
      const ids = output.animations[state as AnimationState] ?? [];
      const frames = ids.map((id) => textures.get(id)).filter((t) => t !== undefined);
      if (frames.length > 0) this.animations[state as AnimationState] = frames;
    }
    this.collision = output.actions?.collision;
    this.emit = output.actions?.emit;
    this.item = output.item;
    this.movement = output.movement;
    this.dialogues = (output.dialogues ?? []).filter((d) => d.lines.length > 0);
    this.home = this.mesh.position.clone();

    this.characterLook = this.isNpc;
    if (this.characterLook) {
      // Unaffected by nearby lights: black base color, with the picture drawn as emission instead.
      this.mesh.material.color.set(0x000000);
      this.mesh.material.emissive.set(0xffffff);
      this.mesh.material.emissiveIntensity = characterBrightness(0.25);
      this.mesh.geometry.scale(1, CHARACTER_STRETCH, 1);
      // A glow like the player's, unless it already gives off a light of its own.
      if (!this.lightSpec) this.mesh.add(createCharacterGlow(this.size.y));
    }
    if (this.movement) this.makeKinematic();
    this.setTexture(this.animations.idle?.[0] ?? this.mesh.material.map ?? undefined);
  }

  /** Characters: anything that moves on its own or can be talked to. */
  get isNpc() {
    return this.movement !== undefined || this.dialogues.length > 0;
  }

  override get touchable() {
    return (
      this.item !== undefined ||
      this.collision !== undefined ||
      this.dialogues.length > 0 ||
      this.emit?.when.type === "collision"
    );
  }

  /** The conversation to play next: each talk moves on to the next one, and the last one repeats. */
  nextDialogue(): Dialogue | undefined {
    if (this.dialogues.length === 0) return undefined;
    return this.dialogues[Math.min(this.conversations++, this.dialogues.length - 1)];
  }

  /** Characters are drawn at a brightness set by the room's lightLevel. */
  setRoomLight(lightLevel: number) {
    if (this.characterLook) this.mesh.material.emissiveIntensity = characterBrightness(lightLevel);
  }

  /** Advances movement and animation. `paused` holds movement (e.g. while a dialogue is open). */
  update(dt: number, paused: boolean, player: Vector3) {
    if (this.movement && !paused) this.move(dt, this.movement, player);
    else this.moving = false;
    this.animate(dt);
  }

  protected override setTexture(texture: Texture | undefined) {
    super.setTexture(texture);
    if (!texture || !this.characterLook) return;
    // setTexture makes the base color white; characters keep it black and show the picture as emission.
    this.mesh.material.color.set(0x000000);
    this.mesh.material.emissiveMap = texture;
  }

  override addTo(parent: Object3D, world: World) {
    super.addTo(parent, world);
    if (this.movement && this.collider && !this.controller) this.controller = world.createCharacterController(0.02);
  }

  override removeFrom(parent: Object3D, world: World) {
    super.removeFrom(parent, world);
    if (this.controller) {
      world.removeCharacterController(this.controller);
      this.controller = null;
    }
  }

  // Moves toward the current target, sliding along whatever it bumps into. Assumes the sprite is
  // at room level (not inside a group), so its position is in room coordinates.
  private move(dt: number, movement: Movement, player: Vector3) {
    if (movement.type === "chase") this.aimChase(movement.detectRadius, player);
    if (this.pauseFor > 0) {
      this.pauseFor -= dt;
      this.moving = false;
      return;
    }
    if (!this.hasTarget && !this.pickTarget(movement)) return;

    const position = this.mesh.position;
    const dx = this.target.x - position.x;
    const dz = this.target.z - position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < ARRIVE_DISTANCE) return this.arrive(movement);

    const step = Math.min(movement.speed * dt, distance);
    let mx = (dx / distance) * step;
    let mz = (dz / distance) * step;
    if (this.controller && this.collider) {
      this.controller.computeColliderMovement(
        this.collider,
        { x: mx, y: 0, z: mz },
        QueryFilterFlags.EXCLUDE_SENSORS | QueryFilterFlags.EXCLUDE_DYNAMIC,
        NPC_QUERY_GROUPS,
      );
      const corrected = this.controller.computedMovement();
      mx = corrected.x;
      mz = corrected.z;
    }

    this.stuckFor = Math.hypot(mx, mz) < step * 0.25 ? this.stuckFor + dt : 0;
    if (this.stuckFor > STUCK_SECONDS) return this.arrive(movement);

    position.x += mx;
    position.z += mz;
    this.body?.setNextKinematicTranslation(position);
    this.moving = true;
  }

  // Locks on when the player comes within detectRadius and heads for them; well beyond it, heads home.
  private aimChase(detectRadius: number, player: Vector3) {
    const position = this.mesh.position;
    const distance = Math.hypot(player.x - position.x, player.z - position.z);
    if (!this.chasing && distance <= detectRadius) {
      this.chasing = true;
      this.pauseFor = 0;
    } else if (this.chasing && distance > detectRadius * CHASE_GIVE_UP) {
      this.chasing = false;
    }
    const goal = this.chasing ? player : this.home;
    this.target.set(goal.x, 0, goal.z);
    this.hasTarget = true;
  }

  private pickTarget(movement: Movement) {
    if (movement.type === "chase") {
      this.target.set(this.home.x, 0, this.home.z);
    } else if (movement.type === "patrol") {
      if (movement.points.length === 0) return false;
      const [x, , z] = movement.points[this.patrolIndex % movement.points.length];
      this.target.set(x, 0, z);
    } else {
      // A random spot within `radius` of where it was placed, spread evenly over the circle.
      const angle = Math.random() * Math.PI * 2;
      const r = movement.radius * Math.sqrt(Math.random());
      this.target.set(this.home.x + Math.cos(angle) * r, 0, this.home.z + Math.sin(angle) * r);
    }
    this.hasTarget = true;
    return true;
  }

  // Reached the target, or gave up on it: pause, then head for the next one.
  private arrive(movement: Movement) {
    this.hasTarget = false;
    this.stuckFor = 0;
    this.moving = false;
    if (movement.type === "patrol") this.patrolIndex++;
    const [min, max] = PAUSE_SECONDS[movement.type];
    this.pauseFor = min + Math.random() * (max - min);
  }

  // Plays the "moving" frames while walking (if it has them), otherwise "idle".
  private animate(dt: number) {
    const frames = (this.moving && this.animations.moving) || this.animations.idle;
    if (!frames || frames.length < 2) return;
    this.frameTime += dt;
    if (this.frameTime < FRAME_SECONDS) return;
    this.frameTime = 0;
    this.frame = (this.frame + 1) % frames.length;
    // Swap the picture directly; going through setTexture would recompile the material each frame.
    const material = this.mesh.material;
    material.map = frames[this.frame];
    if (material.emissiveMap) material.emissiveMap = frames[this.frame];
  }
}
