import { Vector3, type Object3D, type Texture } from "three";
import { QueryFilterFlags, type KinematicCharacterController, type World } from "@dimforge/rapier3d-compat";
import { artFor } from "../shared/art";
import { ART_FRAME_SECONDS } from "../shared/constants";
import { screamFor, type ScreamJob } from "../shared/screams";
import { DEFAULTS, type CharacterSpec, type Conversation, type Damage, type ItemSpec, type Movement } from "../shared/spec";
import { CHARACTER_STRETCH, characterBrightness, createCharacterGlow } from "./characters";
import { Part, PLAYER_GROUP } from "./Part";
import type { TextureLibrary } from "./TextureLibrary";

type AnimationState = "idle" | "moving";
const ANIMATION_STATES: AnimationState[] = ["idle", "moving"];

const ARRIVE_DISTANCE = 0.15; // close enough to a target to count as there
const STUCK_SECONDS = 0.6; // blocked this long (a wall, furniture), it gives up on the target
const PAUSE_SECONDS: Record<Movement["type"], [number, number]> = { wander: [1, 3], patrol: [0.5, 1], chase: [0.3, 0.6] };
// A chaser gives up once the player is this many times its detectRadius away.
const CHASE_GIVE_UP = 1.5;
// Characters walk through the player rather than getting blocked by them: their movement ignores colliders in the player's group.
const NPC_QUERY_GROUPS = (0xffff << 16) | (0xffff & ~PLAYER_GROUP);

/**
 * Someone (or something) in a room: drawn as a flat 2D figure, it may wander, patrol or chase, talk
 * when the player presses [E], hand over an item, or hurt to touch. Always placed at room level, so its
 * position is in room coordinates.
 */
export class Character extends Part {
  readonly id: string;
  readonly name: string;
  readonly dialogue: Conversation[] | undefined;
  readonly gives: ItemSpec | undefined;
  readonly hostile: Damage | undefined;
  readonly movement: Movement | undefined;
  /** Hostile characters: the scream of their jumpscare. */
  readonly scream: ScreamJob | undefined;
  private readonly animations: Partial<Record<AnimationState, Texture[]>> = {};

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

  constructor(spec: CharacterSpec, textures: TextureLibrary) {
    const [w, h] = spec.size;
    super({ shape: "panel", position: spec.position, rotation: [0, 0, 0], size: [w, h, 0], solid: spec.solid }, { light: spec.light });
    this.id = spec.id;
    this.name = spec.name;
    this.dialogue = spec.dialogue;
    this.gives = spec.gives;
    this.hostile = spec.hostile;
    this.movement = spec.movement;
    this.scream = screamFor(spec);
    const frames = artFor.character(spec.art, spec.size);
    for (const state of ANIMATION_STATES) {
      const list = frames[state].flatMap((art) => textures.get(art.id) ?? []);
      if (list.length > 0) this.animations[state] = list;
    }
    this.home = this.mesh.position.clone();

    // Unaffected by nearby lights (which make cutouts look like lit cardboard): black base color, with
    // the picture drawn as emission at a brightness the room sets.
    this.mesh.material.color.set(0x000000);
    this.mesh.material.emissive.set(0xffffff);
    this.mesh.material.emissiveIntensity = characterBrightness(DEFAULTS.baseLight);
    this.mesh.geometry.scale(1, CHARACTER_STRETCH, 1);
    // A glow like the player's, unless it already gives off a light of its own.
    if (!this.lightSpec) this.mesh.add(createCharacterGlow(h));
    if (this.movement) this.makeKinematic();
    this.setTexture(this.animations.idle?.[0]);
  }

  // Hostile ones hurt on touch; moving ones need a collider for their controller to steer around things.
  override get touchable() {
    return this.hostile !== undefined || this.movement !== undefined;
  }

  /** Characters are drawn at a brightness set by the room's base light. */
  setRoomLight(lightLevel: number) {
    this.mesh.material.emissiveIntensity = characterBrightness(lightLevel);
  }

  /** Its reference picture (the first idle frame), for the jumpscare. Undefined until the image has loaded. */
  get portrait(): CanvasImageSource | undefined {
    const image = this.animations.idle?.[0].image as CanvasImageSource | undefined;
    // Before it's painted, the texture holds a 1-pixel placeholder.
    return image && "width" in image && Number(image.width) > 1 ? image : undefined;
  }

  /** After a jumpscare: it vanishes and is back where it started, and waits a moment before it hunts again. */
  vanish(seconds: number) {
    this.mesh.position.copy(this.home);
    this.body?.setNextKinematicTranslation(this.home);
    this.body?.setTranslation(this.home, true);
    this.chasing = false;
    this.hasTarget = false;
    this.moving = false;
    this.pauseFor = seconds;
  }

  /** Advances movement and animation. `paused` holds movement (e.g. while a dialogue is open). */
  update(dt: number, paused: boolean, player: Vector3) {
    if (this.movement && !paused) this.move(dt, this.movement, player);
    else this.moving = false;
    this.animate(dt);
  }

  protected override setTexture(texture: Texture | undefined) {
    super.setTexture(texture);
    if (!texture) return;
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

  // Moves toward the current target, sliding along whatever it bumps into.
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
      const [x, z] = movement.points[this.patrolIndex % movement.points.length];
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
    if (this.frameTime < ART_FRAME_SECONDS) return;
    this.frameTime = 0;
    this.frame = (this.frame + 1) % frames.length;
    this.showFrame(frames[this.frame]);
  }
}
