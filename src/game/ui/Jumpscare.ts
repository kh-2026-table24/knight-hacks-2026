// A jumpscare: the character's generated scare face hits the screen in a blink, either zooming out of
// nothing to fill it or popping up from the bottom edge, then shakes violently for about a second. It's
// drawn like the rest of the game (a third of screen resolution, 16 shades per channel, the
// RetroFilter's 4x4 Bayer dither), with a couple of frames flashing negative.
const PIXEL_SIZE = 3; // screen pixels per drawn pixel, as in RetroFilter
const COLOR_LEVELS = 16; // shades per channel, as in RetroFilter
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.5);

const SECONDS = 1.2;
const FADE_FROM = 0.8; // of the way through, it fades to black
const FPS = 30;
/** How long the face takes to arrive at full size: almost no time at all. */
const APPEAR_SECONDS = 0.08;
// Once there, the face is this many times the screen's height, and keeps creeping closer by this much.
const FACE_HEIGHT = 1.15;
const CREEP = 0.08;
// Violent shaking: up to this share of the screen's width each way, and this many radians of twist. It
// stays at full strength for the first part, then eases to a share of it.
const SHAKE = 0.07;
const TWIST = 0.12;
const SHAKE_HOLD = 0.5;
const SHAKE_END = 0.4;
// The room behind darkens to this as the face arrives.
const BACKDROP = 0.85;
const NEGATIVE_FRAMES = [2, 7]; // these frames flash inverted
const GRAIN = 40;

/** zoom: out of nothing in the middle of the screen. rise: up from below the bottom edge. */
export type ScareStyle = "zoom" | "rise";
const STYLES: ScareStyle[] = ["zoom", "rise"];

export interface ScareOptions {
  /** Picked at random if not given. */
  style?: ScareStyle;
  /** End on black and stay there until hide(), for what comes after the last scare. */
  holdBlack?: boolean;
}

export class Jumpscare {
  private readonly canvas = document.createElement("canvas");
  private readonly ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
  private playing = false;
  private holdBlack = false;

  constructor(parent: HTMLElement = document.body) {
    this.canvas.className = "jumpscare";
    this.canvas.hidden = true;
    parent.append(this.canvas);
  }

  /** The game holds still while it plays, as it does for dialogue. */
  get isPlaying() {
    return this.playing;
  }

  /** Plays the scare over everything and resolves when it's gone (or black). Without a face, it's a burst of red static. */
  play(face: CanvasImageSource | undefined, { style = STYLES[Math.floor(Math.random() * STYLES.length)], holdBlack = false }: ScareOptions = {}): Promise<void> {
    this.holdBlack = holdBlack;
    const w = (this.canvas.width = Math.max(1, Math.round(window.innerWidth / PIXEL_SIZE)));
    const h = (this.canvas.height = Math.max(1, Math.round(window.innerHeight / PIXEL_SIZE)));
    this.ctx.imageSmoothingEnabled = false;
    this.canvas.hidden = false;
    this.playing = true;
    const started = performance.now();
    let frame = -1;
    return new Promise((resolve) => {
      const tick = () => {
        const t = (performance.now() - started) / 1000;
        if (t >= SECONDS) {
          if (holdBlack) {
            this.ctx.fillStyle = "#000";
            this.ctx.fillRect(0, 0, w, h);
          } else this.canvas.hidden = true;
          this.playing = false;
          return resolve();
        }
        const next = Math.floor(t * FPS);
        if (next !== frame) {
          frame = next;
          this.draw(face, style, t, frame, w, h);
        }
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  /** Takes away the black a held scare ended on. */
  hide() {
    this.canvas.hidden = true;
  }

  private draw(face: CanvasImageSource | undefined, style: ScareStyle, t: number, frame: number, w: number, h: number) {
    const { ctx } = this;
    const progress = t / SECONDS;
    // Ease out: it covers nearly all the distance in the first instant.
    const arrived = 1 - (1 - Math.min(1, t / APPEAR_SECONDS)) ** 3;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = `rgba(0, 0, 0, ${BACKDROP * arrived})`;
    ctx.fillRect(0, 0, w, h);

    if (face) {
      const iw = Number((face as HTMLImageElement).width);
      const ih = Number((face as HTMLImageElement).height);
      const full = ((h * FACE_HEIGHT) / ih) * (1 + CREEP * progress);
      const scale = style === "zoom" ? full * arrived : full;
      const fw = iw * scale;
      const fh = ih * scale;
      const strength = progress < SHAKE_HOLD ? 1 : 1 - ((progress - SHAKE_HOLD) / (1 - SHAKE_HOLD)) * (1 - SHAKE_END);
      const jolt = () => (Math.random() * 2 - 1) * strength;
      // Centered on the face's middle; a rising face starts wholly below the screen.
      const settledY = h / 2;
      const y = style === "rise" ? h + fh / 2 + (settledY - h - fh / 2) * arrived : settledY;
      ctx.save();
      ctx.translate(w / 2 + jolt() * SHAKE * w, y + jolt() * SHAKE * w);
      ctx.rotate(jolt() * TWIST);
      ctx.drawImage(face, -fw / 2, -fh / 2, fw, fh);
      ctx.restore();
    } else {
      ctx.fillStyle = "#300";
      ctx.fillRect(0, 0, w, h);
    }
    this.finish(w, h, frame, progress);
  }

  /** Grain, a push toward blood red, the game's dither, the negative flashes and the fade. */
  private finish(w: number, h: number, frame: number, progress: number) {
    const image = this.ctx.getImageData(0, 0, w, h);
    const d = image.data;
    const steps = COLOR_LEVELS - 1;
    const negative = NEGATIVE_FRAMES.includes(frame);
    const fade = progress < FADE_FROM ? 1 : 1 - (progress - FADE_FROM) / (1 - FADE_FROM);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const grain = ((Math.random() - 0.5) * GRAIN) / 255;
        const rgb = [(d[i] / 255) * 1.12 + grain, (d[i + 1] / 255) * 0.88 + grain, (d[i + 2] / 255) * 0.85 + grain];
        const threshold = BAYER[(x & 3) + (y & 3) * 4];
        for (let c = 0; c < 3; c++) {
          let v = Math.min(1, Math.max(0, rgb[c]));
          if (negative) v = 1 - v;
          v *= fade;
          d[i + c] = Math.round((Math.max(0, Math.floor(v * steps + 0.5 + threshold)) / steps) * 255);
        }
        // Fading out takes the backdrop with it, so the room shows again underneath (unless it's held on black).
        d[i + 3] = this.holdBlack ? Math.max(d[i + 3], Math.round(255 * (1 - fade))) : Math.round(d[i + 3] * fade);
      }
    }
    this.ctx.putImageData(image, 0, 0);
  }
}
