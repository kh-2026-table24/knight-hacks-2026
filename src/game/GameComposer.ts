import { AmbientLight, Color, Fog, PerspectiveCamera, Scene, Timer, Vector3, WebGLRenderer } from "three";
import { World } from "@dimforge/rapier3d-compat";
import { Player } from "./Player";
import { RetroFilter } from "./RetroFilter";
import { Door } from "./Door";
import { Sprite } from "./Sprite";
import { ItemType } from "./generation/output/output";
import type { Game } from "./Game";
import type { Object } from "./Object";
import type { Room } from "./Room";

// Fixed camera offset from the player. The camera's orientation is set once
// from this and never changes; only its position follows the player.
const CAMERA_OFFSET = new Vector3(0, 6, 9);
// Fill light at a room's lightLevel of 1, tinted cold like moonlight. Placed lights do the rest.
const AMBIENT_COLOR = 0xb8c4ff;
const AMBIENT_AT_FULL = 3;
// Things beyond the player fade to black: fog starts a little past the player (who is about 11 m
// from the camera) and is solid black by the far end of a large room.
const FOG_NEAR = 13;
const FOG_FAR = 30;

export class GameComposer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 0.1, 1000);
  readonly world = new World({ x: 0, y: -9.81, z: 0 });
  readonly player: Player;
  private readonly timer = new Timer();
  private readonly ambient = new AmbientLight(AMBIENT_COLOR, 0);
  private readonly retro: RetroFilter;
  private game: Game | null = null;
  private room: Room | null = null;
  /** Objects the player was touching last frame, so touches only trigger once on contact. */
  private touching = new Set<Object>();

  constructor(canvas: HTMLCanvasElement) {
    // No antialiasing: the scene is drawn at low resolution and upscaled with hard pixel edges.
    this.renderer = new WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.retro = new RetroFilter(this.renderer);

    this.camera.position.copy(CAMERA_OFFSET);
    this.camera.lookAt(0, 0, 0);

    this.scene.background = new Color(0x000000);
    this.scene.fog = new Fog(0x000000, FOG_NEAR, FOG_FAR);
    this.scene.add(this.ambient);

    this.player = new Player(this.world);
    this.scene.add(this.player.mesh);

    window.addEventListener("resize", this.resize);
    this.resize();

    this.renderer.setAnimationLoop((time) => this.frameUpdate(time));
  }

  loadGame(game: Game) {
    this.game = game;
    this.swapRooms(game.startRoom);
  }

  /** Arrives at the door for `arrivalConnectionId` if given, otherwise at the room's start position. */
  swapRooms(nextRoom: Room, arrivalConnectionId?: string) {
    this.clearRoom()
    this.loadRoom(nextRoom, arrivalConnectionId)
  }

  private loadRoom(room: Room, arrivalConnectionId?: string) {
    this.clearRoom();
    room.addTo(this.scene, this.world);
    this.room = room;
    this.ambient.intensity = AMBIENT_AT_FULL * room.lightLevel;
    this.touching.clear();
    this.player.reset(arrivalConnectionId ? room.arrivalPoint(arrivalConnectionId) : room.startPosition, this.world);
  }

  private clearRoom() {
    this.room?.removeFrom(this.scene, this.world);
    this.room = null;
  }

  get currentRoom() {
    return this.room;
  }

  private frameUpdate(time: number) {
    this.timer.update(time);
    const dt = Math.min(this.timer.getDelta(), 0.1);

    if (dt > 0) {
      this.player.update(dt);
      this.world.timestep = dt;
      this.world.step();
      this.room?.update(dt);
      this.handleTouches();
    }
    this.camera.position.copy(this.player.position).add(CAMERA_OFFSET);

    this.retro.render(this.scene, this.camera);
  }

  private handleTouches() {
    const room = this.room;
    if (!room) return;

    const now = new Set<Object>();
    for (const collider of this.player.touching(this.world)) {
      const obj = room.objectFor(collider.handle);
      if (obj) now.add(obj);
    }
    const started = [...now].filter((obj) => !this.touching.has(obj));
    this.touching = now;

    // Items are checked every frame, since a dropped item may not be ready on first contact.
    for (const obj of now) {
      if (obj instanceof Sprite && obj.item && room.isPickupReady(obj)) {
        this.player.inventory.push(obj.item);
        room.removeObject(obj);
        console.log(`Picked up ${obj.item.name}`);
      }
    }

    for (const obj of started) {
      if (obj instanceof Door) this.useDoor(obj);
      else if (obj instanceof Sprite && obj.emit?.when.type === "collision") room.emitFrom(obj);
      if (this.room !== room) return; // went through a door
    }
  }

  private useDoor(door: Door) {
    const connection = this.game?.connections.get(door.connectionId);
    if (!connection || !this.room) return;

    if (connection.locked) {
      const key = this.player.inventory.find((i) => i.type === ItemType.Key && i.unlocksId === connection.id);
      if (!key) {
        console.log(`${connection.id} is locked`);
        return;
      }
      connection.locked = false;
      console.log(`Unlocked ${connection.id} with ${key.name}`);
    }

    const next = this.game?.rooms.get(connection.otherRoom(this.room.id));
    if (!next) return;
    console.log(`${this.room.id} (${door.side}) -> ${next.id}`);
    this.swapRooms(next, connection.id);
  }

  private resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.retro.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };
}
