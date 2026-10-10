import {
  HalfFloatType,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from "three";

// PS1-style output: the scene is rendered at a low resolution, then shown with ordered (Bayer)
// dithering and a reduced color depth, which gives the characteristic dot-pattern shading.
const PIXEL_SIZE = 3; // screen pixels per rendered pixel
const COLOR_LEVELS = 16; // shades per color channel (the PS1 had 32; fewer makes the dithering read)

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const fragmentShader = /* glsl */ `
uniform sampler2D source;
uniform vec2 resolution;
uniform float levels;
varying vec2 vUv;

// 4x4 Bayer matrix: a fixed threshold per pixel, so in-between shades become a regular dot pattern.
float bayer(vec2 pixel) {
  const float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  int i = int(mod(pixel.x, 4.0)) + int(mod(pixel.y, 4.0)) * 4;
  return m[i] / 16.0;
}

vec3 linearToSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  // Quantize in display (sRGB) space so the steps are even to the eye, not crowded into the darks.
  vec3 color = linearToSRGB(clamp(texture2D(source, vUv).rgb, 0.0, 1.0));
  float threshold = bayer(floor(vUv * resolution)) - 0.5;
  color = floor(color * (levels - 1.0) + 0.5 + threshold) / (levels - 1.0);
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

export class RetroFilter {
  private readonly renderer: WebGLRenderer;
  // Half-float keeps dark gradients smooth until the dither decides how to break them up.
  private readonly target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, magFilter: NearestFilter, minFilter: NearestFilter });
  private readonly material = new ShaderMaterial({
    uniforms: {
      source: { value: this.target.texture },
      resolution: { value: new Vector2(1, 1) },
      levels: { value: COLOR_LEVELS },
    },
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  private readonly screen = new Mesh(new PlaneGeometry(2, 2), this.material);
  private readonly screenCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
  }

  /** Size of the canvas in CSS pixels. */
  setSize(width: number, height: number) {
    const w = Math.max(1, Math.round(width / PIXEL_SIZE));
    const h = Math.max(1, Math.round(height / PIXEL_SIZE));
    this.target.setSize(w, h);
    (this.material.uniforms.resolution.value as Vector2).set(w, h);
  }

  render(scene: Scene, camera: Camera) {
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.screen, this.screenCamera);
  }
}
