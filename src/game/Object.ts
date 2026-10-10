import { BoxGeometry, DoubleSide, Mesh, MeshStandardMaterial, PlaneGeometry, Vector3, type BufferGeometry, type Scene } from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import { ColliderDesc, RigidBodyDesc, type RigidBody, type World } from "@dimforge/rapier3d-compat";
import { ObjectType, type Object as ObjectOutput } from "./generation/output/output";

// Planes have no depth, so their collider gets some to stop the player clipping through.
const PLANE_COLLIDER_DEPTH = 0.3;

const COLORS: Record<ObjectType, number> = {
  [ObjectType.RectPrism]: 0x5a5048,
  [ObjectType.RightTriPrism]: 0x4a443e,
  [ObjectType.Plane]: 0x2f3b2a,
};

// position: bottom-center of the object. rotation: Euler radians. scale: size [width, height, depth].
// RightTriPrism (unrotated) is a ramp: low at +z and rises to full height at -z. Plane (unrotated) faces +z and ignores depth.
export class Object {
  readonly type: ObjectType;
  readonly mesh: Mesh;
  private readonly colliderDesc: ColliderDesc | null;
  private body: RigidBody | null = null;

  constructor(output: ObjectOutput) {
    this.type = output.type;
    const [w, h, d] = output.scale;
    let geometry: BufferGeometry;
    let colliderDesc: ColliderDesc | null;

    switch (output.type) {
      case ObjectType.RectPrism:
        geometry = new BoxGeometry(w, h, d).translate(0, h / 2, 0);
        colliderDesc = ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(0, h / 2, 0);
        break;
      case ObjectType.RightTriPrism: {
        // prettier-ignore
        const points = new Float32Array([
          -w / 2, 0, -d / 2,   w / 2, 0, -d / 2,
          -w / 2, 0,  d / 2,   w / 2, 0,  d / 2,
          -w / 2, h, -d / 2,   w / 2, h, -d / 2,
        ]);
        const vectors: Vector3[] = [];
        for (let i = 0; i < points.length; i += 3) vectors.push(new Vector3().fromArray(points, i));
        geometry = new ConvexGeometry(vectors);
        colliderDesc = ColliderDesc.convexHull(points);
        break;
      }
      case ObjectType.Plane:
        geometry = new PlaneGeometry(w, h).translate(0, h / 2, 0);
        colliderDesc = ColliderDesc.cuboid(w / 2, h / 2, PLANE_COLLIDER_DEPTH / 2).setTranslation(0, h / 2, 0);
        break;
      default:
        throw new Error(`Unknown object type: ${output.type}`);
    }

    this.mesh = new Mesh(geometry, new MeshStandardMaterial({ color: COLORS[output.type], side: DoubleSide }));
    this.mesh.position.fromArray(output.position);
    this.mesh.rotation.fromArray(output.rotation);
    this.colliderDesc = output.collisionsEnabled ? colliderDesc : null;
  }

  addTo(scene: Scene, world: World) {
    scene.add(this.mesh);
    if (!this.colliderDesc || this.body) return;

    const { position, quaternion } = this.mesh;
    this.body = world.createRigidBody(RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z).setRotation(quaternion));
    world.createCollider(this.colliderDesc, this.body);
  }

  removeFrom(scene: Scene, world: World) {
    scene.remove(this.mesh);
    if (this.body) {
      world.removeRigidBody(this.body);
      this.body = null;
    }
  }
}
