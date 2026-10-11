import { BoxGeometry, Mesh, MeshStandardMaterial, Vector3, type Scene, type Vector3Tuple } from "three";
import { ColliderDesc, RigidBodyDesc, type RigidBody, type World } from "@dimforge/rapier3d-compat";
import { artFor } from "../shared/art";
import { INTERACT, PICKUP, PLAYER, WALL_THICKNESS } from "../shared/constants";
import { distanceXZ, placeProp, roomWalls, type PlacedPart, type Side } from "../shared/geometry";
import type { AmbientSpec, ItemSpec, RoomSpec } from "../shared/spec";
import { Character } from "./Character";
import { Door } from "./Door";
import { stateKey, type GameState } from "./GameState";
import { Part } from "./Part";
import { Pickup } from "./Pickup";
import { Prop } from "./Prop";
import type { TextureLibrary } from "./TextureLibrary";
import { CAMERA_PITCH } from "./camera";

const FLOOR_THICKNESS = 0.2;
// A leaning sprite keeps this far from whatever is behind it.
const LEAN_MARGIN = 0.05;
// Sprites at least this far in front of the north wall are freestanding (not hung on it) and get a contact shadow.
const FREESTANDING = 0.15;
// Meters covered by one repeat of the floor texture.
const FLOOR_TILE_SIZE = 4;
// Dropped items and particles appear this far in front of (toward the camera from) what they come out of.
const SPAWN_OFFSET = 0.5;
// Items dropped by a prop or character pop up out of it before landing.
const DROP_VELOCITY: Vector3Tuple = [0, 3, 0];
const TOLERANCE = 0.05;
// Reused by interactTarget, which runs every frame.
const scratch = new Vector3();

/** Things touching does something to: doors go through, hazards and hostile characters hurt. */
export type Touchable = Prop | Character | Door;
/** Things the player uses with [E]. */
export type Interactable = Prop | Character;

interface Particle {
  part: Part;
  expiresAt: number;
}

// The room spans x 0..W, z 0..D, with the floor's top at y = 0.
export class Room {
  readonly id: string;
  readonly start: Vector3;
  /** Brightness before any lights, 0 to 1. */
  readonly baseLight: number;
  readonly props: Prop[];
  readonly characters: Character[];
  readonly doors: Door[];
  private readonly walls: Prop[];
  /** Placed pickups not yet taken, plus dropped ones. Dropped ones stay while the room is unloaded. */
  private readonly pickups: Pickup[];
  private readonly emitters: { prop: Prop; ambient: AmbientSpec; wait: number }[];
  private readonly particles: Particle[] = [];
  private readonly floor: Mesh;
  private readonly colliderDescs: ColliderDesc[];
  private body: RigidBody | null = null;
  private readonly byCollider = new Map<number, Touchable>();
  private mounted: { scene: Scene; world: World } | null = null;
  private time = 0;

  /** `sides` gives the wall each of this room's connections leaves through. */
  constructor(
    spec: RoomSpec,
    private readonly textures: TextureLibrary,
    sides: Map<string, Side>,
    private readonly state: GameState,
  ) {
    this.id = spec.id;
    this.start = new Vector3(spec.start[0], 0, spec.start[1]);
    this.baseLight = spec.baseLight;
    this.walls = roomWalls(spec).map((wall) => new Prop(wall, textures));
    this.props = spec.props.map((prop) => new Prop(prop, textures));
    this.characters = spec.characters.map((character) => new Character(character, textures));
    this.doors = spec.doors.flatMap((door) => {
      const side = sides.get(door.connection);
      if (side) return [new Door(door, spec, side, textures)];
      console.warn(`Door to ${door.connection} in ${spec.id} doesn't match a connection of this room`);
      return [];
    });
    this.pickups = spec.pickups
      .filter((p) => !state.collected.has(stateKey(spec.id, p.id)))
      .map((p) => new Pickup(p.item, p.position, textures, { stateKey: stateKey(spec.id, p.id) }));
    this.emitters = this.props.flatMap((prop) => (prop.ambient ? [{ prop, ambient: prop.ambient, wait: prop.ambient.everySeconds * Math.random() }] : []));
    this.leanSprites(spec);

    const [w, h, d] = spec.size;
    const floorGeometry = new BoxGeometry(w, FLOOR_THICKNESS, d);
    // Tile the texture by stretching the UVs; the texture itself is shared, so its repeat can't change.
    const uv = floorGeometry.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / FLOOR_TILE_SIZE, (uv.getY(i) * d) / FLOOR_TILE_SIZE);
    const floorTexture = textures.get(artFor.surface(spec.floor).id);
    const floorMaterial = new MeshStandardMaterial({ color: floorTexture ? (spec.floorTint ?? 0xffffff) : 0x1c1a17, map: floorTexture ?? null });
    this.floor = new Mesh(floorGeometry, floorMaterial);
    this.floor.position.set(w / 2, -FLOOR_THICKNESS / 2, d / 2);

    // Floor, plus invisible walls around the edges so the player can't leave the room.
    this.colliderDescs = [
      ColliderDesc.cuboid(w / 2, FLOOR_THICKNESS / 2, d / 2).setTranslation(w / 2, -FLOOR_THICKNESS / 2, d / 2),
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
    for (const prop of [...this.walls, ...this.props]) prop.addTo(scene, world);
    for (const character of this.characters) {
      character.addTo(scene, world);
      character.setRoomLight(this.baseLight);
    }
    for (const door of this.doors) door.addTo(scene, world);
    for (const pickup of this.pickups) pickup.addTo(scene, world);
    for (const { part } of this.particles) part.addTo(scene, world);
    this.mounted = { scene, world };

    this.byCollider.clear();
    for (const prop of this.props) for (const part of prop.parts) this.register(part, prop);
    for (const character of this.characters) this.register(character, character);
    for (const door of this.doors) this.register(door, door);
  }

  removeFrom(scene: Scene, world: World) {
    scene.remove(this.floor);
    if (this.body) {
      world.removeRigidBody(this.body);
      this.body = null;
    }
    for (const prop of [...this.walls, ...this.props]) prop.removeFrom(scene, world);
    for (const character of this.characters) character.removeFrom(scene, world);
    for (const door of this.doors) door.removeFrom(scene, world);
    for (const pickup of this.pickups) pickup.removeFrom(scene, world);
    for (const { part } of this.particles) part.removeFrom(scene, world);
    this.mounted = null;
  }

  /** What a collider belongs to, if touching it does something. */
  ownerOf(colliderHandle: number) {
    return this.byCollider.get(colliderHandle);
  }

  /** Where the player appears when arriving through the given connection. */
  arrivalPoint(connectionId: string) {
    return this.doors.find((d) => d.connectionId === connectionId)?.arrivalPoint() ?? this.start.clone();
  }

  /**
   * What [E] uses for a player whose feet are at `feet`. Anything whose edge is within reach counts; of
   * those, the one whose middle is nearest wins. Going by the edge alone favors big things: a rug the
   * player stands on, or a whole building front, is always 0 m away and would hide the small thing in
   * front of them. Characters win ties.
   */
  interactTarget(feet: Vector3): Interactable | undefined {
    let best: Interactable | undefined;
    let bestDistance = Infinity;
    for (const prop of this.props) {
      const searchable = prop.contains && !this.state.given.has(stateKey(this.id, prop.id));
      if (!prop.examine && !searchable) continue;
      const inReach = distanceXZ(prop.bounds, feet.x, feet.z) <= INTERACT.range && prop.bounds.min.y <= feet.y + INTERACT.maxHeightAboveFeet + TOLERANCE;
      if (!inReach) continue;
      prop.bounds.getCenter(scratch);
      const distance = Math.hypot(scratch.x - feet.x, scratch.z - feet.z);
      if (distance < bestDistance) [best, bestDistance] = [prop, distance];
    }
    for (const character of this.characters) {
      if (!character.dialogue) continue;
      const p = character.mesh.position;
      const distance = Math.hypot(p.x - feet.x, p.z - feet.z);
      const inReach = distance - character.size.x / 2 <= INTERACT.range && p.y <= feet.y + INTERACT.maxHeightAboveFeet + TOLERANCE;
      if (inReach && distance <= bestDistance) [best, bestDistance] = [character, distance];
    }
    return best;
  }

  /** Pickups close enough to collect. Dropped ones wait a moment, so they're seen falling out first. */
  pickupsInReach(feet: Vector3) {
    return this.pickups.filter((pickup) => {
      if (pickup.droppedAt !== undefined && this.time - pickup.droppedAt < PICKUP.delaySeconds) return false;
      const p = pickup.mesh.position;
      return Math.hypot(p.x - feet.x, p.z - feet.z) <= PICKUP.range && p.y >= feet.y - PICKUP.below && p.y <= feet.y + PLAYER.height;
    });
  }

  /** Removes a collected pickup. */
  take(pickup: Pickup) {
    const i = this.pickups.indexOf(pickup);
    if (i < 0) return;
    this.pickups.splice(i, 1);
    if (this.mounted) pickup.removeFrom(this.mounted.scene, this.mounted.world);
  }

  /** Drops an item out of a prop or character: it pops up in front of it and lands nearby. */
  drop(source: Interactable, item: ItemSpec) {
    const origin = this.spawnPoint(source);
    const pickup = new Pickup(item, origin.toArray(), this.textures, { droppedAt: this.time });
    this.pickups.push(pickup);
    if (this.mounted) {
      pickup.addTo(this.mounted.scene, this.mounted.world);
      pickup.setVelocity(DROP_VELOCITY);
    }
  }

  /**
   * `paused` holds characters still (e.g. while a dialogue is open); everything else keeps going.
   * `player` is where the player is, for characters that chase them.
   */
  update(dt: number, paused: boolean, player: Vector3) {
    this.time += dt;
    for (const prop of this.props) prop.update(dt, this.time);
    for (const character of this.characters) {
      character.updateLight(this.time);
      character.update(dt, paused, player);
    }
    for (const pickup of this.pickups) pickup.syncFromPhysics();

    for (const emitter of this.emitters) {
      emitter.wait -= dt;
      if (emitter.wait > 0) continue;
      // ±50% jitter around the average, so drips and sparks don't tick like a metronome.
      emitter.wait = emitter.ambient.everySeconds * (0.5 + Math.random());
      this.spawnParticle(emitter.prop, emitter.ambient);
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const { part, expiresAt } = this.particles[i];
      if (this.time < expiresAt) {
        part.syncFromPhysics();
        continue;
      }
      if (this.mounted) part.removeFrom(this.mounted.scene, this.mounted.world);
      this.particles.splice(i, 1);
    }
  }

  private spawnParticle(prop: Prop, ambient: AmbientSpec) {
    if (!this.mounted) return;
    const part = new Part(
      { shape: "panel", position: this.spawnPoint(prop).toArray(), rotation: [0, 0, 0], size: [ambient.size[0], ambient.size[1], 0], solid: false },
      { texture: this.textures.get(artFor.ambient(ambient).id) },
    );
    part.leanBack(CAMERA_PITCH);
    part.dynamic = true;
    part.gravityScale = ambient.gravity ? 1 : 0;
    part.addTo(this.mounted.scene, this.mounted.world);
    part.setVelocity(ambient.velocity);
    this.particles.push({ part, expiresAt: this.time + ambient.lifetimeSeconds });
  }

  /**
   * Leans each upright sprite back to face the camera, as far as the space behind it allows, so it never
   * tips into a wall or a box: a freestanding barrel leans all the way, a picture hung on the wall stays
   * flat against it. Freestanding sprites resting on the floor or on something get a contact shadow.
   */
  private leanSprites(spec: RoomSpec) {
    const placed = spec.props.map((prop) => placeProp(prop, prop.id));
    const blocks = [...roomWalls(spec).flatMap((wall) => placeProp(wall, wall.id)), ...placed.flat()].filter((p) => p.part.shape !== "panel");
    placed.forEach((parts, i) => {
      parts.forEach((placedPart, j) => {
        const { part, box, quaternion: q } = placedPart;
        // Only sprites facing the camera straight on; turned or tilted panels stay as placed.
        if (part.shape !== "panel" || Math.abs(q.x) > 1e-3 || Math.abs(q.y) > 1e-3 || Math.abs(q.z) > 1e-3) return;
        const z = box.max.z;
        const bottom = box.min.y;
        const freestanding = z - WALL_THICKNESS > FREESTANDING;
        const resting = bottom <= TOLERANCE || blocks.some(({ box: b }) => Math.abs(b.max.y - bottom) <= TOLERANCE && distanceXZ(b, (box.min.x + box.max.x) / 2, z) === 0);
        this.props[i].parts[j].leanBack(leanAngle(placedPart, blocks), freestanding && resting);
      });
    });
  }

  // Halfway up whatever it comes out of, just in front of it.
  private spawnPoint(source: Interactable) {
    if (source instanceof Character) return source.mesh.position.clone().add(new Vector3(0, source.size.y / 2, SPAWN_OFFSET));
    const { min, max } = source.bounds;
    return new Vector3((min.x + max.x) / 2, (min.y + max.y) / 2, max.z + SPAWN_OFFSET);
  }

  private register(part: Part, owner: Touchable) {
    const handle = part.colliderHandle;
    if (handle !== undefined) this.byCollider.set(handle, owner);
  }
}

/**
 * How far a sprite can lean back before it touches anything behind it. Leaning by `a`, a point `s` up the
 * sprite moves back s * sin(a), so each box behind it limits the lean by how high it reaches up the sprite.
 */
function leanAngle({ box }: PlacedPart, blocks: PlacedPart[]) {
  const z = box.max.z;
  const bottom = box.min.y;
  const height = box.max.y - bottom;
  let angle = CAMERA_PITCH;
  for (const { box: b } of blocks) {
    const behind = b.min.z < z;
    const across = b.min.x < box.max.x && b.max.x > box.min.x;
    const level = b.max.y > bottom + TOLERANCE && b.min.y < box.max.y;
    if (!behind || !across || !level) continue;
    const clearance = z - b.max.z - LEAN_MARGIN;
    if (clearance <= 0) return 0;
    angle = Math.min(angle, Math.asin(Math.min(1, clearance / Math.min(height, b.max.y - bottom))));
  }
  return angle;
}
