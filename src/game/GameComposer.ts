import { AmbientLight, DirectionalLight, PerspectiveCamera, Scene, Timer, Vector3, WebGLRenderer } from "three";
import { World } from "@dimforge/rapier3d-compat";
import { Player } from "./Player";
import type { Room } from "./Room";

// Fixed camera offset from the player. The camera's orientation is set once
// from this and never changes; only its position follows the player.
const CAMERA_OFFSET = new Vector3(0, 6, 9);

export class GameComposer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 0.1, 1000);
  readonly world = new World({ x: 0, y: 0, z: 0 });
  readonly player: Player;
  private readonly timer = new Timer();
  private room: Room | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);

    this.camera.position.copy(CAMERA_OFFSET);
    this.camera.lookAt(0, 0, 0);

    const sun = new DirectionalLight(0xffffff, 1.5);
    sun.position.set(5, 10, 7);
    this.scene.add(new AmbientLight(0xffffff, 0.5), sun);

    this.player = new Player(this.world);
    this.scene.add(this.player.mesh);

    window.addEventListener("resize", this.resize);
    this.resize();

    this.renderer.setAnimationLoop((time) => this.frameUpdate(time));
  }

  loadRoom(room: Room) {
    this.clearRoom();
    room.addTo(this.scene, this.world);
    this.room = room;
    this.player.reset(room.startPosition);
  }

  clearRoom() {
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
    }
    this.camera.position.copy(this.player.position).add(CAMERA_OFFSET);

    this.renderer.render(this.scene, this.camera);
  }

  private resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };
}
