import { BoxGeometry, DoubleSide, Mesh, MeshStandardMaterial, PlaneGeometry, Quaternion, Vector3, type BufferGeometry, type Object3D, type Texture, type Vector3Tuple } from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import { ColliderDesc, RigidBodyDesc, type Collider, type RigidBody, type World } from "@dimforge/rapier3d-compat";
import { ObjectType, type Object as ObjectOutput } from "./generation/output/output";
import type { TextureLibrary } from "./TextureLibrary";
import { applyWorldUVs } from "./worldUVs";

// Planes have no depth, so their collider gets some to stop the player clipping through.
const PLANE_COLLIDER_DEPTH = 0.3;
// Meters covered by one repeat of a box or ramp's surface texture, so pixels are the same size on
// every face instead of one texture stretched across each face whatever its size.
const SURFACE_TILE_SIZE = 2;

// Rapier collision groups are (membership << 16) | filter. Dynamic objects (dropped items)
// land on everything except the player, so they don't get shoved around or block movement.
const PLAYER_GROUP = 0x0002;
const DYNAMIC_GROUP = 0x0004;
export const PLAYER_COLLISION_GROUPS = (PLAYER_GROUP << 16) | (0xffff & ~DYNAMIC_GROUP);
const DYNAMIC_COLLISION_GROUPS = (DYNAMIC_GROUP << 16) | (0xffff & ~PLAYER_GROUP);

const COLORS: Record<ObjectType, number> = {
  [ObjectType.RectPrism]: 0x5a5048,
  [ObjectType.RightTriPrism]: 0x4a443e,
  [ObjectType.Plane]: 0x2f3b2a,
};

// position: bottom-center of the object. rotation: Euler radians. scale: size [width, height, depth].
// RightTriPrism (unrotated) is a ramp: low at +z and rises to full height at -z. Plane (unrotated) faces +z and ignores depth.
export class Object {
  readonly id: string;
  readonly type: ObjectType;
  /** [width, height, depth] from the output's scale. */
  readonly size: Vector3;
  readonly mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  /** Blocks movement. */
  readonly solid: boolean;
  /** Simulated by physics (falls under gravity) instead of fixed in place. */
  dynamic = false;
  private readonly colliderDesc: ColliderDesc | null;
  private body: RigidBody | null = null;
  private collider: Collider | null = null;

  constructor(output: ObjectOutput, textures: TextureLibrary) {
    this.id = output.id;
    this.type = output.type;
    this.size = new Vector3().fromArray(output.scale);
    const [w, h, d] = output.scale;
    let geometry: BufferGeometry;
    let colliderDesc: ColliderDesc | null;

    switch (output.type) {
      case ObjectType.RectPrism:
        geometry = new BoxGeometry(w, h, d).translate(0, h / 2, 0);
        applyWorldUVs(geometry, SURFACE_TILE_SIZE);
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
        // ConvexGeometry has no UVs at all, so without this the ramp can't show its texture.
        geometry = new ConvexGeometry(vectors);
        applyWorldUVs(geometry, SURFACE_TILE_SIZE);
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
    this.solid = output.collisionsEnabled;
    this.colliderDesc = colliderDesc;
    this.setTexture(textures.get(output.textureId));
  }

  /** Whether touching this does something. Non-solid touchable objects get a sensor collider. */
  get touchable() {
    return false;
  }

  get colliderHandle() {
    return this.collider?.handle;
  }

  protected setTexture(texture: Texture | undefined) {
    if (!texture) return;
    const material = this.mesh.material;
    material.map = texture;
    material.color.set(0xffffff);
    material.alphaTest = 0.5;
    material.needsUpdate = true;
  }

  addTo(parent: Object3D, world: World) {
    parent.add(this.mesh);
    // Dynamic objects always collide with the world so they can land on things.
    const solid = this.solid || this.dynamic;
    if (!this.colliderDesc || this.body || (!solid && !this.touchable)) return;

    // Use the world transform so objects inside groups collide where they appear.
    const position = this.mesh.getWorldPosition(new Vector3());
    const quaternion = this.mesh.getWorldQuaternion(new Quaternion());
    const bodyDesc = this.dynamic ? RigidBodyDesc.dynamic().lockRotations() : RigidBodyDesc.fixed();
    this.body = world.createRigidBody(bodyDesc.setTranslation(position.x, position.y, position.z).setRotation(quaternion));
    this.colliderDesc.setSensor(!solid);
    if (this.dynamic) this.colliderDesc.setCollisionGroups(DYNAMIC_COLLISION_GROUPS);
    this.collider = world.createCollider(this.colliderDesc, this.body);
  }

  removeFrom(parent: Object3D, world: World) {
    parent.remove(this.mesh);
    if (this.body) {
      world.removeRigidBody(this.body);
      this.body = null;
      this.collider = null;
    }
  }

  setVelocity(velocity: Vector3Tuple) {
    this.body?.setLinvel({ x: velocity[0], y: velocity[1], z: velocity[2] }, true);
  }

  /** Move the mesh to where physics put it. Only for dynamic objects added directly to the scene. */
  syncFromPhysics() {
    if (this.dynamic && this.body) this.mesh.position.copy(this.body.translation());
  }
}
