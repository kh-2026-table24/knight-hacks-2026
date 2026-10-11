import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Quaternion,
  SpotLight,
  Vector3,
  type BufferGeometry,
  type Object3D,
  type Texture,
  type Vector3Tuple,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import { ColliderDesc, RigidBodyDesc, type Collider, type RigidBody, type World } from "@dimforge/rapier3d-compat";
import type { LightSpec, PartSpec, Shape } from "../shared/spec";
import { applyWorldUVs } from "./worldUVs";

// Panels have no depth, so their collider gets some to stop the player clipping through.
export const PLANE_COLLIDER_DEPTH = 0.3;
// Meters covered by one repeat of a box or wedge's surface texture, so pixels are the same size on
// every face instead of one texture stretched across each face whatever its size.
const SURFACE_TILE_SIZE = 2;

// Rapier collision groups are (membership << 16) | filter. Dynamic objects (dropped items, particles)
// land on everything except the player, so they don't get shoved around or block movement.
export const PLAYER_GROUP = 0x0002;
const DYNAMIC_GROUP = 0x0004;
export const PLAYER_COLLISION_GROUPS = (PLAYER_GROUP << 16) | (0xffff & ~DYNAMIC_GROUP);
const DYNAMIC_COLLISION_GROUPS = (DYNAMIC_GROUP << 16) | (0xffff & ~PLAYER_GROUP);

// Colliders of things that move themselves sit this far off the floor: resting exactly on it counts
// as stuck to a character controller, which then won't slide sideways.
const MOVER_LIFT = 0.05;

// Light intensities are on a friendly scale (1 = a candle); this converts to three.js candela.
const LIGHT_CANDELA = 6;
// A glow sits this far up the part (near its top) and this far in front of it, so the part and the
// floor in front of it catch the light instead of it hiding inside a box.
const GLOW_HEIGHT = 0.8;
const GLOW_FORWARD = 0.3;
// Spots shine down from this far above the part's top.
const SPOT_HEIGHT = 4;
// How much a glowing part lights up its own surface. Strong for flat cutouts (a candle, a ghost);
// faint for boxes and wedges, which otherwise turn into flat blocks of color.
const SELF_GLOW: Record<Shape, number> = { box: 0.15, wedge: 0.15, panel: 0.7 };
const COLORS: Record<Shape, number> = { box: 0x5a5048, wedge: 0x4a443e, panel: 0x2f3b2a };
// Contact shadows: a soft dark ellipse under a freestanding sprite, this wide relative to it and this
// deep (within limits), so it sits on the ground instead of hovering over it.
const SHADOW_WIDTH = 0.9;
const SHADOW_DEPTH = 0.35;
const SHADOW_DEPTH_RANGE: [number, number] = [0.15, 1];
const SHADOW_OPACITY = 0.45;
const SHADOW_LIFT = 0.015;

// Shader changes, made with onBeforeCompile so the materials stay MeshStandardMaterial and keep every
// light, the fog and the tint working as before.
// Flat lighting: the whole sprite is lit as if it were one point (its middle), like a 2D sprite, instead
// of light pools and gradients sweeping across it like light on a sheet of cardboard.
const FLAT_LIGHT_VERTEX = /* glsl */ `
  vViewPosition = - ( modelViewMatrix * vec4( spriteAnchor, 1.0 ) ).xyz;
  #include <worldpos_vertex>`;
// Recoloring: each texel's brightness relative to the texture's average (its smallest mipmap level)
// scales the base color, so the pattern stays but the color is the one asked for, lighter or darker.
const RECOLOR_FRAGMENT = /* glsl */ `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  const vec3 LUMA = vec3( 0.2126, 0.7152, 0.0722 );
  float averageLuma = max( dot( textureLod( map, vMapUv, 16.0 ).rgb, LUMA ), 0.01 );
  diffuseColor.rgb *= clamp( dot( sampledDiffuseColor.rgb, LUMA ) / averageLuma, 0.0, 2.5 );
  diffuseColor.a *= sampledDiffuseColor.a;
#endif`;
// Unlit: only the emission, so no light (not even the part's own, a hand's width away) washes it out.
const LIGHTS_SUM = "vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;";
const UNLIT_FRAGMENT = "vec3 outgoingLight = totalEmissiveRadiance;";

/** What the engine builds a part from. Walls, doors, characters and pickups are parts too. */
export type PartShape = Pick<PartSpec, "shape" | "position" | "rotation" | "size" | "solid">;

// position: bottom-center. rotation: Euler radians. size: [width, height, depth].
// A wedge (unrotated) is low at +z and rises to full height at -z. A panel (unrotated) faces +z and ignores depth.
export class Part {
  readonly shape: Shape;
  /** [width, height, depth]. */
  readonly size: Vector3;
  readonly mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  /** Blocks movement. */
  readonly solid: boolean;
  /** Simulated by physics (falls under gravity) instead of fixed in place. Set before adding it to the world. */
  dynamic = false;
  /** How strongly gravity pulls a dynamic part; 0 for things that float. */
  gravityScale = 1;
  /** Not solid, but still gets a collider (a sensor) so touching it can do something. Set before adding it to the world. */
  sensor = false;
  /** Moves under its own control (characters) instead of being fixed in place. */
  private kinematic = false;
  private readonly colliderDesc: ColliderDesc | null;
  protected body: RigidBody | null = null;
  protected collider: Collider | null = null;
  readonly lightSpec: LightSpec | undefined;
  /** Multiplied over the texture: the tint, times the base color of a recolored or plain-colored part. */
  private readonly surfaceColor: Color;
  /** The point an upright panel is lit at, in its own frame (flat lighting). */
  private readonly spriteAnchor = { value: new Vector3() };
  private light: PointLight | SpotLight | null = null;
  private readonly lightPhase = Math.random() * 100;

  /**
   * `tint` multiplies over the picture or texture. `color` (boxes and wedges) is a base color: the
   * texture is recolored to it, or without a texture the part is plain color.
   */
  constructor(spec: PartShape, options: { texture?: Texture; light?: LightSpec; tint?: string; color?: string } = {}) {
    this.shape = spec.shape;
    this.size = new Vector3().fromArray(spec.size);
    const [w, h, d] = spec.size;
    let geometry: BufferGeometry;
    let colliderDesc: ColliderDesc | null;

    switch (spec.shape) {
      case "box":
        geometry = new BoxGeometry(w, h, d).translate(0, h / 2, 0);
        applyWorldUVs(geometry, SURFACE_TILE_SIZE);
        colliderDesc = ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(0, h / 2, 0);
        break;
      case "wedge": {
        // prettier-ignore
        const points = new Float32Array([
          -w / 2, 0, -d / 2,   w / 2, 0, -d / 2,
          -w / 2, 0,  d / 2,   w / 2, 0,  d / 2,
          -w / 2, h, -d / 2,   w / 2, h, -d / 2,
        ]);
        const vectors: Vector3[] = [];
        for (let i = 0; i < points.length; i += 3) vectors.push(new Vector3().fromArray(points, i));
        // ConvexGeometry has no UVs at all, so without this the wedge can't show its texture.
        geometry = new ConvexGeometry(vectors);
        applyWorldUVs(geometry, SURFACE_TILE_SIZE);
        colliderDesc = ColliderDesc.convexHull(points);
        break;
      }
      case "panel":
        geometry = new PlaneGeometry(w, h).translate(0, h / 2, 0);
        colliderDesc = ColliderDesc.cuboid(w / 2, h / 2, PLANE_COLLIDER_DEPTH / 2).setTranslation(0, h / 2, 0);
        break;
      default:
        throw new Error(`Unknown shape: ${spec.shape satisfies never}`);
    }

    this.mesh = new Mesh(geometry, new MeshStandardMaterial({ color: COLORS[spec.shape], side: DoubleSide }));
    this.mesh.position.fromArray(spec.position);
    this.mesh.rotation.fromArray(spec.rotation);
    this.solid = spec.solid;
    this.colliderDesc = colliderDesc;
    this.lightSpec = options.light;
    this.surfaceColor = new Color(options.tint ?? "#ffffff").multiply(new Color(options.color ?? "#ffffff"));
    if (options.color) this.mesh.material.color.copy(this.surfaceColor);
    this.setShaders({ flatLit: spec.shape === "panel" && Math.abs(spec.rotation[0]) < 1e-3 && Math.abs(spec.rotation[2]) < 1e-3, recolor: !!options.color });
    this.spriteAnchor.value.set(0, h / 2, 0);
    if (this.lightSpec?.type === "glow") {
      this.mesh.material.emissive.set(this.lightSpec.color);
      this.mesh.material.emissiveIntensity = SELF_GLOW[spec.shape];
    }
    this.setTexture(options.texture);
  }

  /** Whether touching this does something. Non-solid touchable parts get a sensor collider. */
  get touchable() {
    return this.sensor;
  }

  get colliderHandle() {
    return this.collider?.handle;
  }

  protected setTexture(texture: Texture | undefined) {
    if (!texture) return;
    const material = this.mesh.material;
    material.map = texture;
    material.color.copy(this.surfaceColor);
    material.alphaTest = 0.5;
    // A glowing part lights up its own picture rather than a flat block of color.
    if (this.lightSpec?.type === "glow") material.emissiveMap = texture;
    material.needsUpdate = true;
  }

  /** Replaces any shader changes set before; call it before the part is first drawn. */
  protected setShaders({ flatLit = false, recolor = false, unlit = false }: { flatLit?: boolean; recolor?: boolean; unlit?: boolean }) {
    if (!flatLit && !recolor && !unlit) return;
    const material = this.mesh.material;
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      if (flatLit) {
        shader.uniforms.spriteAnchor = this.spriteAnchor;
        shader.vertexShader = `uniform vec3 spriteAnchor;\n${shader.vertexShader.replace("#include <worldpos_vertex>", FLAT_LIGHT_VERTEX)}`;
      }
      if (recolor) shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", RECOLOR_FRAGMENT);
      if (unlit) shader.fragmentShader = shader.fragmentShader.replace(LIGHTS_SUM, UNLIT_FRAGMENT);
    };
    material.customProgramCacheKey = () => `${flatLit ? "flat" : ""}${recolor ? "recolor" : ""}${unlit ? "unlit" : ""}`;
  }

  /**
   * Leans an upright panel back by `angle` radians, pivoting on its bottom edge, so it faces the camera:
   * a picture square-on to the camera is drawn without perspective distortion, as a 2D sprite. Only
   * the picture leans; its collider stays upright. `shadow` adds a contact shadow at its base.
   */
  leanBack(angle: number, shadow = false) {
    if (angle > 0) {
      this.mesh.geometry.rotateX(-angle);
      this.spriteAnchor.value.set(0, (this.size.y / 2) * Math.cos(angle), (-this.size.y / 2) * Math.sin(angle));
    }
    if (shadow) this.mesh.add(createShadow(this.size.x));
  }

  /** Swaps in another animation frame. Setting the maps directly avoids recompiling the material. */
  showFrame(texture: Texture) {
    const material = this.mesh.material;
    material.map = texture;
    if (material.emissiveMap) material.emissiveMap = texture;
  }

  addTo(parent: Object3D, world: World) {
    parent.add(this.mesh);
    if (this.lightSpec && !this.light) this.light = this.createLight(this.lightSpec);
    // Dynamic parts always collide with the world so they can land on things.
    const solid = this.solid || this.dynamic;
    if (!this.colliderDesc || this.body || (!solid && !this.touchable)) return;

    // Use the world transform so parts inside props collide where they appear.
    const position = this.mesh.getWorldPosition(new Vector3());
    const quaternion = this.mesh.getWorldQuaternion(new Quaternion());
    const bodyDesc = this.dynamic
      ? RigidBodyDesc.dynamic().lockRotations().setGravityScale(this.gravityScale)
      : this.kinematic
        ? RigidBodyDesc.kinematicPositionBased()
        : RigidBodyDesc.fixed();
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

  /** Frees the GPU copies of this part's geometry and material. Textures are shared, so they stay. */
  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }

  /** For things that move themselves: a kinematic body, with the collider lifted off the floor. */
  protected makeKinematic() {
    if (this.kinematic) return;
    this.kinematic = true;
    const t = this.colliderDesc?.translation;
    if (t) this.colliderDesc!.setTranslation(t.x, t.y + MOVER_LIFT, t.z);
  }

  /** Animates flickering and pulsing lights. `time` is in seconds. */
  updateLight(time: number) {
    const light = this.light;
    const effect = this.lightSpec?.effect;
    if (!light || !effect || effect === "steady") return;
    const t = time + this.lightPhase;
    const base = light.userData.baseIntensity as number;
    light.intensity =
      effect === "flicker"
        ? base * (0.8 + 0.1 * Math.sin(t * 11) + 0.06 * Math.sin(t * 23.7) + 0.04 * Math.sin(t * 41.3))
        : base * (0.55 + 0.45 * Math.sin(t * 2.2));
  }

  // The light is a child of the mesh so it moves with it (moving characters carry their light), but
  // it's placed in world terms (above, in front) so rotated or grouped parts still light correctly.
  private createLight({ type, color, intensity, range }: LightSpec) {
    this.mesh.updateWorldMatrix(true, false);
    const base = this.mesh.getWorldPosition(new Vector3());
    const top = base.y + this.size.y;
    let light: PointLight | SpotLight;
    let at: Vector3;

    if (type === "spot") {
      // Brightness falls off with distance squared, so scale by height² to keep the pool as bright as `intensity` says.
      const spot = new SpotLight(color, intensity * LIGHT_CANDELA * SPOT_HEIGHT ** 2, 0, Math.atan(range / SPOT_HEIGHT), 0.5, 2);
      spot.target = this.mesh;
      light = spot;
      at = new Vector3(base.x, top + SPOT_HEIGHT, base.z);
    } else {
      light = new PointLight(color, intensity * LIGHT_CANDELA, range, 2);
      at = new Vector3(base.x, base.y + this.size.y * GLOW_HEIGHT, base.z + GLOW_FORWARD);
    }
    light.userData.baseIntensity = light.intensity;
    light.position.copy(this.mesh.worldToLocal(at));
    this.mesh.add(light);
    return light;
  }

  setVelocity(velocity: Vector3Tuple) {
    this.body?.setLinvel({ x: velocity[0], y: velocity[1], z: velocity[2] }, true);
  }

  /** Moves the mesh to where physics put it. Only for dynamic parts added directly to the scene. */
  syncFromPhysics() {
    if (this.dynamic && this.body) this.mesh.position.copy(this.body.translation());
  }
}

// One soft ellipse texture, geometry and material, shared by every contact shadow.
let shadowMaterial: MeshBasicMaterial | undefined;
let shadowGeometry: PlaneGeometry | undefined;

function createShadow(width: number) {
  shadowGeometry ??= new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  shadowMaterial ??= new MeshBasicMaterial({ color: 0x000000, map: softDot(), transparent: true, opacity: SHADOW_OPACITY, depthWrite: false });
  const shadow = new Mesh(shadowGeometry, shadowMaterial);
  const [minDepth, maxDepth] = SHADOW_DEPTH_RANGE;
  shadow.scale.set(width * SHADOW_WIDTH, 1, Math.min(Math.max(width * SHADOW_DEPTH, minDepth), maxDepth));
  shadow.position.y = SHADOW_LIFT;
  return shadow;
}

/** White in the middle fading to transparent at the edge. */
function softDot() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}
