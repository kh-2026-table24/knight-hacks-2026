import * as THREE from "three";

const MOVE_KEYS = new Set(["w", "a", "s", "d"]);

/** The protagonist: an upright 2D plane facing the camera, moved with WASD on the ground (XZ) plane. */
export class Player {
  readonly mesh: THREE.Mesh;
  speed = 5;
  private readonly keys = new Set<string>();
  private readonly direction = new THREE.Vector3();

  constructor() {
    const width = 1;
    const height = 1.8;
    // Shift geometry up so the mesh origin sits at the character's feet.
    const geometry = new THREE.PlaneGeometry(width, height).translate(0, height / 2, 0);
    this.mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xd0d0d0, side: THREE.DoubleSide }));

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

  reset(position: THREE.Vector3) {
    this.mesh.position.copy(position);
    this.keys.clear();
  }

  update(dt: number) {
    const d = this.direction.set(0, 0, 0);
    if (this.keys.has("w")) d.z -= 1;
    if (this.keys.has("s")) d.z += 1;
    if (this.keys.has("a")) d.x -= 1;
    if (this.keys.has("d")) d.x += 1;
    if (d.lengthSq() === 0) return;

    this.mesh.position.addScaledVector(d.normalize(), this.speed * dt);
  }
}
