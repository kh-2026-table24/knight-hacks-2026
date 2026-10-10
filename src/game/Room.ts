import { BoxGeometry, Mesh, MeshStandardMaterial, Vector3, type Scene } from "three";
import { ColliderDesc, RigidBodyDesc, type RigidBody, type World } from "@dimforge/rapier3d-compat";
import { Group } from "./Group";
import { Door } from "./Door";
import { Sprite } from "./Sprite";
import type { Side } from "./Connection";
import type { Object } from "./Object";
import type { TextureLibrary } from "./TextureLibrary";
import type { Room as RoomOutput } from "./generation/output/output";

const FLOOR_THICKNESS = 0.2;
// Meters covered by one repeat of the floor texture.
const FLOOR_TILE_SIZE = 4;
// Emitted sprites spawn this far in front of their emitter (toward the camera) so they fall out of it.
const SPAWN_OFFSET = 0.5;
// Base brightness of a room that doesn't say: dim, so placed lights carry the scene.
const DEFAULT_LIGHT_LEVEL = 0.25;
// Seconds before a dropped item can be picked up, so it's seen falling out first.
const PICKUP_DELAY = 0.75;

interface Emitter {
  sprite: Sprite;
  count: number;
  timer: number;
}

interface Spawned {
  sprite: Sprite;
  spawnedAt: number;
  expiresAt: number | null;
}

// The room spans x: 0..width, z: 0..depth, with the floor's top at y = 0.
// dimensions: [width, height, depth]
export class Room {
  readonly id: string;
  readonly dimensions: Vector3;
  readonly startPosition: Vector3;
  /** Base brightness before any lights, 0 to 1. */
  readonly lightLevel: number;
  /** Everything in the room except doors, as a group at the origin. */
  readonly contents: Group;
  readonly doors: Door[];
  private readonly textures: TextureLibrary;
  private readonly floor: Mesh;
  private readonly colliderDescs: ColliderDesc[];
  private body: RigidBody | null = null;

  private readonly emitters: Emitter[];
  /** Objects with flickering or pulsing lights. */
  private readonly animatedLights: Object[];
  /** Sprites placed in the room, which may move and animate. */
  private readonly sprites: Sprite[];
  /** Sprites created by emitters. Kept while the room is unloaded so dropped items stay put. */
  private readonly spawned: Spawned[] = [];
  private readonly byCollider = new Map<number, Object>();
  private mounted: { scene: Scene; world: World } | null = null;
  private time = 0;

  /** `sideOf` gives the wall a connection leaves this room through, or undefined if it doesn't touch this room. */
  constructor(output: RoomOutput, textures: TextureLibrary, sideOf: (connectionId: string) => Side | undefined) {
    this.id = output.id;
    this.textures = textures;
    this.dimensions = new Vector3().fromArray(output.dimensions);
    this.startPosition = new Vector3().fromArray(output.startPosition);
    this.lightLevel = Math.min(1, Math.max(0, output.lightLevel ?? DEFAULT_LIGHT_LEVEL));
    this.contents = new Group(
      { id: output.id, position: [0, 0, 0], rotation: [0, 0, 0], objects: output.objects, groups: output.groups },
      textures,
    );
    this.doors = (output.doors ?? []).flatMap((door) => {
      const side = sideOf(door.connectionId);
      if (!side) {
        console.warn(`Door ${door.id} in ${output.id} uses connection ${door.connectionId}, which doesn't join this room`);
        return [];
      }
      return [new Door(door, textures, side, this.dimensions)];
    });
    this.animatedLights = [...allObjects(this.contents), ...this.doors].filter((o) => hasAnimatedLight(o));
    this.sprites = allObjects(this.contents).filter((o) => o instanceof Sprite);
    this.emitters = allObjects(this.contents)
      .filter((o): o is Sprite => o instanceof Sprite && o.emit !== undefined)
      .map((sprite) => ({ sprite, count: 0, timer: 0 }));

    const { x: w, y: h, z: d } = this.dimensions;
    const floorGeometry = new BoxGeometry(w, FLOOR_THICKNESS, d);
    const floorMaterial = new MeshStandardMaterial({ color: 0x1c1a17 });
    const floorTexture = textures.get(output.floorTextureId);
    if (floorTexture) {
      // Tile the texture by stretching the UVs; the texture itself is shared, so its repeat can't change.
      const uv = floorGeometry.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / FLOOR_TILE_SIZE, (uv.getY(i) * d) / FLOOR_TILE_SIZE);
      floorMaterial.map = floorTexture;
      floorMaterial.color.set(0xffffff);
    }
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
    this.contents.addTo(scene, world);
    for (const sprite of this.sprites) sprite.setRoomLight(this.lightLevel);
    for (const door of this.doors) door.addTo(scene, world);
    for (const { sprite } of this.spawned) sprite.addTo(scene, world);

    this.mounted = { scene, world };
    this.byCollider.clear();
    for (const obj of allObjects(this.contents)) this.register(obj);
    for (const door of this.doors) this.register(door);
    for (const { sprite } of this.spawned) this.register(sprite);
  }

  removeFrom(scene: Scene, world: World) {
    scene.remove(this.floor);
    if (this.body) {
      world.removeRigidBody(this.body);
      this.body = null;
    }
    this.contents.removeFrom(scene, world);
    for (const door of this.doors) door.removeFrom(scene, world);
    for (const { sprite } of this.spawned) sprite.removeFrom(scene, world);
    this.mounted = null;
  }

  /** The object a collider belongs to, if it's one of this room's. */
  objectFor(colliderHandle: number) {
    return this.byCollider.get(colliderHandle);
  }

  /** Where the player appears when arriving through the given connection. */
  arrivalPoint(connectionId: string) {
    const door = this.doors.find((d) => d.connectionId === connectionId);
    return door ? door.arrivalPoint() : this.startPosition.clone();
  }

  /**
   * `paused` holds NPCs still (e.g. while a dialogue is open); everything else keeps going.
   * `player` is where the player is, for NPCs that chase them.
   */
  update(dt: number, paused: boolean, player: Vector3) {
    this.time += dt;
    for (const obj of this.animatedLights) obj.updateLight(this.time);
    for (const sprite of this.sprites) sprite.update(dt, paused, player);

    for (const emitter of this.emitters) {
      const when = emitter.sprite.emit!.when;
      if (when.type === "interval") {
        emitter.timer += dt;
        if (emitter.timer >= when.seconds) {
          emitter.timer -= when.seconds;
          this.emitFrom(emitter.sprite);
        }
      } else if (when.type === "random" && Math.random() < when.chancePerSecond * dt) {
        this.emitFrom(emitter.sprite);
      }
    }

    for (const { sprite, expiresAt } of [...this.spawned]) {
      if (expiresAt !== null && this.time >= expiresAt) this.removeObject(sprite);
      else {
        sprite.syncFromPhysics();
        sprite.updateLight(this.time);
        sprite.update(dt, paused, player);
      }
    }
  }

  /** Spawn the sprite's emitted sprite, if it hasn't hit its maxCount. */
  emitFrom(sprite: Sprite) {
    const emitter = this.emitters.find((e) => e.sprite === sprite);
    const emit = sprite.emit;
    if (!this.mounted || !emitter || !emit) return;
    if (emit.maxCount !== undefined && emitter.count >= emit.maxCount) return;
    emitter.count++;

    const origin = sprite.mesh.getWorldPosition(new Vector3()).add(new Vector3(0, sprite.size.y / 2, SPAWN_OFFSET));
    const spawned = new Sprite({ ...emit.sprite, id: `${sprite.id}-${emitter.count}`, position: origin.toArray() }, this.textures);
    spawned.dynamic = true;
    spawned.addTo(this.mounted.scene, this.mounted.world);
    spawned.setVelocity(emit.velocity);
    this.register(spawned);
    this.spawned.push({
      sprite: spawned,
      spawnedAt: this.time,
      expiresAt: emit.lifetimeSeconds === undefined ? null : this.time + emit.lifetimeSeconds,
    });
  }

  /** False for items that were dropped too recently to pick up. */
  isPickupReady(obj: Object) {
    const spawned = this.spawned.find((s) => s.sprite === obj);
    return !spawned || this.time - spawned.spawnedAt >= PICKUP_DELAY;
  }

  removeObject(obj: Object) {
    if (!this.mounted) return;
    const handle = obj.colliderHandle;
    if (handle !== undefined) this.byCollider.delete(handle);
    obj.removeFrom(obj.mesh.parent ?? this.mounted.scene, this.mounted.world);
    const i = this.spawned.findIndex((s) => s.sprite === obj);
    if (i >= 0) this.spawned.splice(i, 1);
  }

  private register(obj: Object) {
    const handle = obj.colliderHandle;
    if (handle !== undefined) this.byCollider.set(handle, obj);
  }
}

const hasAnimatedLight = (obj: Object) => obj.lightSpec?.effect !== undefined && obj.lightSpec.effect !== "steady";

function allObjects(group: Group): Object[] {
  return [...group.objects, ...group.groups.flatMap(allObjects)];
}
