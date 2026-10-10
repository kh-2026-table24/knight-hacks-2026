import * as THREE from "three";
import { Player } from "./Player";
import type { Room } from "./Room";

// Fixed camera offset from the player. The camera's orientation is set once
// from this and never changes; only its position follows the player.
const CAMERA_OFFSET = new THREE.Vector3(0, 6, 9);

export class GameComposer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  readonly player = new Player();
  private readonly timer = new THREE.Timer();
  private room: Room | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);

    this.camera.position.copy(CAMERA_OFFSET);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(this.player.mesh);
    // Temporary floor reference so movement is visible; remove once rooms have floors.
    this.scene.add(new THREE.GridHelper(50, 50, 0x444444, 0x222222));

    window.addEventListener("resize", this.resize);
    this.resize();

    this.renderer.setAnimationLoop((time) => this.frameUpdate(time));
  }

  loadRoom(room: Room) {
    this.clearRoom();
    this.room = room;
    this.player.reset(room.startPosition);
  }

  clearRoom() {
    this.room = null;
  }

  get currentRoom() {
    return this.room;
  }

  private frameUpdate(time: number) {
    this.timer.update(time);
    const dt = Math.min(this.timer.getDelta(), 0.1);

    this.player.update(dt);
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
