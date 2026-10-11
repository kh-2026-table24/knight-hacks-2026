// The title screen's picture, drawn like the game draws its rooms: at a third of screen resolution,
// then dithered to 16 shades per channel with the same 4x4 Bayer pattern as RetroFilter, and shown
// scaled up with hard pixel edges. The figure breathes, the grain crawls, and the name flickers.
const PIXEL_SIZE = 3; // screen pixels per drawn pixel, as in RetroFilter
const COLOR_LEVELS = 16; // shades per channel, as in RetroFilter
const FPS = 12; // a low frame rate suits the grain and keeps this cheap
const GRAIN = 22; // ± brightness of the film grain, out of 255

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.5);

// The name's arch: how sharply it bends, and roughly how wide a letter is, in font sizes.
const ARCH = 3.2;
const LETTER_WIDTH = 0.62;

export class TitleArt {
  readonly canvas = document.createElement("canvas");
  private readonly ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
  private readonly figure = new Image();
  private timer: ReturnType<typeof setInterval> | undefined;
  private started = performance.now();

  constructor(
    private readonly name: string,
    figureUrl: string,
  ) {
    this.canvas.className = "title-art";
    this.figure.src = figureUrl;
    window.addEventListener("resize", this.resize);
    this.resize();
  }

  /** Starts drawing once the figure and the font are ready. */
  async start() {
    await Promise.all([this.figure.decode().catch(() => {}), document.fonts.load('64px "IM Fell English"').catch(() => {})]);
    this.started = performance.now();
    this.draw();
    this.timer = setInterval(this.draw, 1000 / FPS);
  }

  stop() {
    clearInterval(this.timer);
    window.removeEventListener("resize", this.resize);
  }

  private resize = () => {
    this.canvas.width = Math.max(1, Math.round(window.innerWidth / PIXEL_SIZE));
    this.canvas.height = Math.max(1, Math.round(window.innerHeight / PIXEL_SIZE));
  };

  private draw = () => {
    const { ctx, canvas } = this;
    const { width: w, height: h } = canvas;
    const t = (performance.now() - this.started) / 1000;
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);

    this.drawFigure(w, h, t);
    this.drawName(w, h, t);

    // Vignette.
    const vignette = ctx.createRadialGradient(w * 0.45, h * 0.5, Math.min(w, h) * 0.3, w * 0.45, h * 0.5, Math.max(w, h) * 0.75);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.9)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);

    this.grainAndDither(w, h);
  };

  /** The figure on the right, tinted cold like the game's moonlight, slowly breathing. */
  private drawFigure(w: number, h: number, t: number) {
    const { ctx, figure } = this;
    if (!figure.naturalWidth) return;
    const breath = 1 + 0.02 * Math.sin(t * 0.7);
    // Cover the right two thirds, anchored right.
    const scale = Math.max((w * 0.75) / figure.naturalWidth, h / figure.naturalHeight) * breath;
    const fw = figure.naturalWidth * scale;
    const fh = figure.naturalHeight * scale;
    const x = w - fw * 0.92;
    const y = (h - fh) / 2;
    ctx.globalAlpha = 0.8 + 0.08 * Math.sin(t * 2.3) * Math.sin(t * 0.37);
    ctx.filter = "grayscale(1) contrast(1.15) brightness(0.95)";
    ctx.drawImage(figure, x, y, fw, fh);
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    // Moonlight blue over it, then fade its left edge into the dark under the name and menu.
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = "#9fb0ff";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
    const fade = ctx.createLinearGradient(x, 0, x + fw * 0.45, 0);
    fade.addColorStop(0, "rgba(0,0,0,1)");
    fade.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, x + fw * 0.45, h);
  }

  /** The name along an arch: a smeared red echo behind bone-white letters, flickering now and then. */
  private drawName(w: number, h: number, t: number) {
    const { ctx } = this;
    const letters = [...this.name.toUpperCase()];
    const size = Math.max(14, Math.min(w * 0.056, h * 0.11));
    const left = Math.max(6, w * 0.07);
    const baseline = Math.max(size * 1.6, h * 0.2);
    ctx.font = `${size}px "IM Fell English", Georgia, serif`;
    ctx.textBaseline = "alphabetic";
    // A failing bulb: mostly on, with quick dips.
    const cycle = t % 7;
    const flicker = cycle > 6.2 && cycle < 6.5 ? (Math.sin(t * 90) > 0 ? 0.35 : 0.9) : 1;

    const place = (i: number) => {
      const u = letters.length === 1 ? 0.5 : i / (letters.length - 1);
      const x = u - 0.45;
      return { lift: (ARCH * x * x - ARCH * 0.25) * size, tilt: Math.atan((2 * ARCH * x) / (letters.length * LETTER_WIDTH)) };
    };
    const drawLetters = (color: string, dx: number, blur: number, alpha: number) => {
      ctx.save();
      ctx.filter = blur ? `blur(${blur}px)` : "none";
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      let x = left + dx;
      letters.forEach((char, i) => {
        const { lift, tilt } = place(i);
        ctx.save();
        ctx.translate(x, baseline + lift);
        ctx.rotate(tilt);
        ctx.fillText(char, 0, 0);
        ctx.restore();
        x += ctx.measureText(char).width + size * 0.04;
      });
      ctx.restore();
    };
    drawLetters("#7a1414", -size * 0.35, size * 0.18, 0.55 * flicker); // dragged smear
    drawLetters("#b01c1c", 0, size * 0.1, flicker); // glow
    drawLetters("#b01c1c", 0, size * 0.04, 0.8 * flicker);
    drawLetters("#e9dfcf", 0, 0, flicker); // the letters
  }

  /** Film grain, then the same ordered dither and color depth as the game's RetroFilter. */
  private grainAndDither(w: number, h: number) {
    const image = this.ctx.getImageData(0, 0, w, h);
    const d = image.data;
    const steps = COLOR_LEVELS - 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const threshold = BAYER[(x & 3) + (y & 3) * 4];
        const grain = (Math.random() - 0.5) * 2 * GRAIN;
        for (let c = 0; c < 3; c++) {
          const v = Math.min(255, Math.max(0, d[i + c] + grain)) / 255;
          d[i + c] = Math.round((Math.floor(v * steps + 0.5 + threshold) / steps) * 255);
        }
      }
    }
    this.ctx.putImageData(image, 0, 0);
  }
}
