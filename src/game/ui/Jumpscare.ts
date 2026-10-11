// A jumpscare: the character's face lunges at the screen for about a second, drawn like the rest of the
// game (a third of screen resolution, 16 shades per channel, the RetroFilter's 4x4 Bayer dither) but
// blown out: drained to bone and blood red, torn by rows, with frames that flash negative.
const PIXEL_SIZE = 3; // screen pixels per drawn pixel, as in RetroFilter
const COLOR_LEVELS = 16; // shades per channel, as in RetroFilter
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.5);

const SECONDS = 1.1;
const FADE_FROM = 0.8; // then it fades to black
const FPS = 24; // jerkier than the game, which helps
// How much of the picture (from the top) is the face, and how far it lunges: from filling this much of
// the screen's height to that much.
const FACE_SHARE = 0.5;
const LUNGE: [from: number, to: number] = [1.1, 1.8];
const SHAKE = 0.04; // of the screen's width, at the start
const NEGATIVE_FRAMES = [1, 5]; // these frames flash inverted
const GRAIN = 60;

export class Jumpscare {
  private readonly canvas = document.createElement("canvas");
  private readonly ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
  private playing = false;

  constructor(parent: HTMLElement = document.body) {
    this.canvas.className = "jumpscare";
    this.canvas.hidden = true;
    parent.append(this.canvas);
  }

  /** The game holds still while it plays, as it does for dialogue. */
  get isPlaying() {
    return this.playing;
  }

  /** Plays the scare over everything and resolves when it's gone. Without a picture, it's a flash of red static. */
  play(face: CanvasImageSource | undefined): Promise<void> {
    const w = (this.canvas.width = Math.max(1, Math.round(window.innerWidth / PIXEL_SIZE)));
    const h = (this.canvas.height = Math.max(1, Math.round(window.innerHeight / PIXEL_SIZE)));
    this.canvas.hidden = false;
    this.playing = true;
    const started = performance.now();
    let frame = -1;
    return new Promise((resolve) => {
      const tick = () => {
        const t = (performance.now() - started) / 1000;
        if (t >= SECONDS) {
          this.canvas.hidden = true;
          this.playing = false;
          return resolve();
        }
        const next = Math.floor(t * FPS);
        if (next !== frame) {
          frame = next;
          this.draw(face, t, frame, w, h);
        }
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  private draw(face: CanvasImageSource | undefined, t: number, frame: number, w: number, h: number) {
    const { ctx } = this;
    ctx.fillStyle = frame === 0 ? "#fff" : "#000";
    ctx.fillRect(0, 0, w, h);
    const progress = t / SECONDS;

    if (face && frame > 0) {
      const iw = Number((face as HTMLImageElement).width);
      const ih = Number((face as HTMLImageElement).height);
      // Ease out: it's on you almost at once, then keeps creeping closer.
      const lunge = LUNGE[0] + (LUNGE[1] - LUNGE[0]) * (1 - (1 - progress) ** 3);
      const scale = (h * lunge) / (ih * FACE_SHARE);
      const shake = SHAKE * w * (1 - progress);
      const x = (w - iw * scale) / 2 + (Math.random() * 2 - 1) * shake;
      const y = -h * 0.08 * lunge + (Math.random() * 2 - 1) * shake;
      ctx.drawImage(face, x, y, iw * scale, ih * scale);
    }
    this.bleed(w, h, frame, progress);
  }

  /** Bone and blood, torn rows, grain, the dither, negative flashes and the fade. */
  private bleed(w: number, h: number, frame: number, progress: number) {
    const image = this.ctx.getImageData(0, 0, w, h);
    const d = image.data;
    const source = new Uint8ClampedArray(d);
    const steps = COLOR_LEVELS - 1;
    const negative = NEGATIVE_FRAMES.includes(frame);
    const fade = progress < FADE_FROM ? 1 : 1 - (progress - FADE_FROM) / (1 - FADE_FROM);
    let tear = 0;
    for (let y = 0; y < h; y++) {
      // A few bands of rows slide sideways, like a tape losing tracking.
      if (Math.random() < 0.04) tear = Math.random() < 0.5 ? 0 : Math.round((Math.random() * 2 - 1) * w * 0.06);
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const from = (y * w + Math.min(w - 1, Math.max(0, x + tear))) * 4;
        let l = (0.3 * source[from] + 0.59 * source[from + 1] + 0.11 * source[from + 2]) / 255;
        l = Math.min(1, Math.max(0, (l - 0.5) * 1.8 + 0.55 + ((Math.random() - 0.5) * GRAIN) / 255));
        if (negative) l = 1 - l;
        // Dark parts go to blood, light parts to bone.
        const rgb = [l * 1.1, l * l * 0.9, l * l * 0.8];
        const threshold = BAYER[(x & 3) + (y & 3) * 4];
        for (let c = 0; c < 3; c++) {
          const v = Math.min(1, rgb[c] * fade);
          d[i + c] = Math.round((Math.floor(v * steps + 0.5 + threshold) / steps) * 255);
        }
        d[i + 3] = 255;
      }
    }
    this.ctx.putImageData(image, 0, 0);
  }
}
