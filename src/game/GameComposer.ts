import { AmbientLight, Color, Fog, PerspectiveCamera, Scene, Timer, WebGLRenderer } from "three";
import { World } from "@dimforge/rapier3d-compat";
import { CAMERA_OFFSET } from "./camera";
import { MAX_HEARTS, Player } from "./Player";
import { RetroFilter } from "./RetroFilter";
import { Hud } from "./ui/Hud";
import { Door } from "./Door";
import { Character } from "./Character";
import { ItemType, type Dialogue } from "./generation/output/output";
import type { Game } from "./Game";
import type { Part } from "./Part";
import type { Room } from "./Room";

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
  readonly hud = new Hud();
  private game: Game | null = null;
  private room: Room | null = null;
  /** Objects the player was touching last frame, so touches only trigger once on contact. */
  private touching = new Set<Part>();

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
    this.hud.setHearts(this.player.hearts, MAX_HEARTS);

    window.addEventListener("keydown", (e) => {
      // defaultPrevented: the dialogue box already used this press (e.g. to close the last line).
      if (e.key.toLowerCase() === "e" && !e.repeat && !e.defaultPrevented && !this.hud.dialogue.isOpen) void this.talk();
    });

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
    this.player.setRoomLight(room.lightLevel);
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
      this.room?.update(dt, this.hud.dialogue.isOpen, this.player.position);
      // Nothing happens to the player, and NPCs stand still, while they're reading.
      if (!this.hud.dialogue.isOpen) this.handleTouches();
    }
    this.camera.position.copy(this.player.position).add(CAMERA_OFFSET);

    this.retro.render(this.scene, this.camera);
  }

  private handleTouches() {
    const room = this.room;
    if (!room) return;

    const now = new Set<Part>();
    for (const collider of this.player.touching(this.world)) {
      const obj = room.objectFor(collider.handle);
      if (obj) now.add(obj);
    }
    const started = [...now].filter((obj) => !this.touching.has(obj));
    this.touching = now;

    // Items and damage are checked every frame: a dropped item may not be ready on first contact,
    // and something hostile keeps hurting while you stay in contact (after the invulnerability window).
    for (const obj of now) {
      if (!(obj instanceof Character)) continue;
      if (obj.item && room.isPickupReady(obj)) {
        this.player.inventory.push(obj.item);
        this.hud.setItems(this.player.inventory);
        room.removeObject(obj);
      } else if (obj.collision?.hostileToIds.includes("player") && this.player.hurt(obj.collision.damage)) {
        this.hud.setHearts(this.player.hearts, MAX_HEARTS);
        if (this.player.hearts === 0) void this.die();
      }
    }
    this.hud.setHint(this.talkTarget() ? "[E] Talk" : null);

    for (const obj of started) {
      if (obj instanceof Door) void this.useDoor(obj);
      else if (obj instanceof Character && obj.emit?.when.type === "collision") room.emitFrom(obj);
      if (this.room !== room) return; // went through a door
    }
  }

  private async useDoor(door: Door) {
    const connection = this.game?.connections.get(door.connectionId);
    const room = this.room;
    if (!connection || !room) return;

    if (connection.locked) {
      const key = this.player.inventory.find((i) => i.type === ItemType.Key && i.unlocksId === connection.id);
      if (!key) {
        await this.showDialogue({ speaker: "", lines: ["It's locked."] });
        return;
      }
      connection.locked = false;
      await this.showDialogue({ speaker: "", lines: [`You unlock it with the ${key.name}.`] });
    }

    const next = this.game?.rooms.get(connection.otherRoom(room.id));
    if (!next || this.room !== room) return;
    this.swapRooms(next, connection.id);
  }

  /** The NPC with something to say that the player is touching, if any. */
  private talkTarget() {
    for (const obj of this.touching) if (obj instanceof Character && obj.dialogues.length > 0) return obj;
    return undefined;
  }

  private async talk() {
    const npc = this.talkTarget();
    const dialogue = npc?.nextDialogue();
    const room = this.room;
    if (!npc || !dialogue || !room) return;
    await this.showDialogue(dialogue);
    if (npc.emit?.when.type === "dialogueEnd" && this.room === room) room.emitFrom(npc);
  }

  /** Shows a dialogue with the player held still until it's read. */
  private async showDialogue(dialogue: Dialogue) {
    this.player.frozen = true;
    this.hud.setHint(null);
    try {
      await this.hud.dialogue.play(dialogue);
    } finally {
      this.player.frozen = false;
    }
  }

  // Placeholder until the game's states are designed: back to the room's start with full hearts.
  private async die() {
    await this.showDialogue({ speaker: "", lines: ["Everything goes dark..."] });
    this.player.heal();
    this.hud.setHearts(this.player.hearts, MAX_HEARTS);
    if (this.room) this.swapRooms(this.room);
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
