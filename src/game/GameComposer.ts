import { AmbientLight, Color, Fog, PerspectiveCamera, Scene, Timer, WebGLRenderer } from "three";
import { World } from "@dimforge/rapier3d-compat";
import { PLAYER } from "../shared/constants";
import { SoundDirector } from "./audio/SoundDirector";
import { CAMERA_OFFSET } from "./camera";
import type { Game } from "./Game";
import { Interactions } from "./Interactions";
import { Player } from "./Player";
import { RetroFilter } from "./RetroFilter";
import type { Room } from "./Room";
import { Hud } from "./ui/Hud";

// Fill light at a room's base light of 1, tinted cold like moonlight. Placed lights do the rest.
const AMBIENT_COLOR = 0xb8c4ff;
const AMBIENT_AT_FULL = 3;
// Things beyond the player fade to black: fog starts a little past the player (who is about 11 m
// from the camera) and is solid black by the far end of a large room.
const FOG_NEAR = 13;
const FOG_FAR = 30;

/** Owns the renderer, the physics world and the loop, and swaps rooms in and out. What the player does is in Interactions. */
export class GameComposer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 0.1, 1000);
  readonly world = new World({ x: 0, y: -9.81, z: 0 });
  readonly player: Player;
  readonly hud = new Hud();
  readonly sounds = new SoundDirector();
  private readonly timer = new Timer();
  private readonly ambient = new AmbientLight(AMBIENT_COLOR, 0);
  private readonly retro: RetroFilter;
  private readonly interactions: Interactions;
  private game: Game | null = null;
  private room: Room | null = null;

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
    this.player.onStep = () => this.sounds.footstep(this.room, this.player.position);
    this.hud.setHearts(PLAYER.maxHearts, PLAYER.maxHearts);
    this.interactions = new Interactions({
      player: this.player,
      world: this.world,
      hud: this.hud,
      audio: this.sounds.audio,
      game: () => this.game,
      room: () => this.room,
      swapRooms: (next, arrivalConnectionId) => this.swapRooms(next, arrivalConnectionId),
    });

    window.addEventListener("resize", this.resize);
    this.resize();

    this.renderer.setAnimationLoop((time) => this.frameUpdate(time));
  }

  loadGame(game: Game) {
    this.game = game;
    this.hud.setHearts(game.state.hearts, PLAYER.maxHearts);
    this.hud.setObjective(game.objective ?? null);
    this.sounds.start();
    this.swapRooms(game.startRoom);
  }

  /** Arrives at the door for `arrivalConnectionId` if given, otherwise at the room's start. */
  swapRooms(next: Room, arrivalConnectionId?: string) {
    this.room?.removeFrom(this.scene, this.world);
    next.addTo(this.scene, this.world);
    this.room = next;
    this.ambient.intensity = AMBIENT_AT_FULL * next.baseLight;
    this.player.setRoomLight(next.baseLight);
    const spec = this.game?.spec.rooms.find((room) => room.id === next.id);
    if (spec) this.sounds.enterRoom(spec);
    this.interactions.reset();
    this.player.reset(arrivalConnectionId ? next.arrivalPoint(arrivalConnectionId) : next.start, this.world);
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
      // Nothing happens to the player, and characters stand still, while they're reading.
      const reading = this.hud.dialogue.isOpen;
      this.room?.update(dt, reading, this.player.position);
      if (!reading) {
        this.interactions.step();
        this.sounds.update(dt, this.room, this.player.position);
      }
    }
    this.camera.position.copy(this.player.position).add(CAMERA_OFFSET);

    this.retro.render(this.scene, this.camera);
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
