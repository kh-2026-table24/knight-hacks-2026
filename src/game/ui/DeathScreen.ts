// What the player sees when their hearts run out: whatever took them, dim and blood red behind the
// words, drawn like the rest of the game (a third of screen resolution, 16 shades per channel, the
// RetroFilter's 4x4 Bayer dither), an epitaph naming it, and a choice in the title screen's menu style:
// try the room again, or go back to the title screen for a new dream.
const PIXEL_SIZE = 3; // screen pixels per drawn pixel, as in RetroFilter
const COLOR_LEVELS = 16; // shades per channel, as in RetroFilter
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.5);
const FPS = 12;
const GRAIN = 26;
// The figure behind the words: how much of the screen's height it fills, and how bright it gets.
const FIGURE_HEIGHT = 1.25;
const FIGURE_BRIGHTNESS = 0.55;

export type DeathChoice = "retry" | "new";

export interface Death {
  /** What took them: a character's or a hazard's name. */
  by: string;
  /** Where. */
  room: string;
  /** Its picture, for the background; without one the background is grain. */
  portrait?: CanvasImageSource;
  /** The game's end, after the antagonist's jumpscare: nothing to try again, and it shows over the scare's black. */
  ending?: boolean;
}

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, text?: string) => {
  const el = document.createElement(tag);
  el.className = className;
  if (text) el.textContent = text;
  parent?.append(el);
  return el;
};

export class DeathScreen {
  private readonly root: HTMLElement;
  private readonly canvas = document.createElement("canvas");
  private readonly ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
  private readonly title: HTMLElement;
  private readonly by: HTMLElement;
  private readonly where: HTMLElement;
  private readonly menu: HTMLElement;
  private items: HTMLButtonElement[] = [];
  private portrait: CanvasImageSource | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private started = 0;

  constructor(parent: HTMLElement = document.body) {
    this.root = element("div", "death-screen title-screen", parent);
    this.root.hidden = true;
    this.canvas.className = "title-art";
    this.root.append(this.canvas);
    const column = element("div", "death-column", this.root);
    this.title = element("h1", "death-title", column);
    const epitaph = element("p", "death-epitaph", column);
    element("span", "death-epitaph-small", epitaph, "Taken by");
    this.by = element("span", "death-epitaph-name", epitaph);
    this.where = element("span", "death-epitaph-small", epitaph);
    this.menu = element("nav", "title-menu death-menu", column);
    this.menu.addEventListener("keydown", this.onKey);
  }

  get isOpen() {
    return !this.root.hidden;
  }

  /** Shows the screen and resolves with what the player picks; it's hidden again by then. */
  show(death: Death): Promise<DeathChoice> {
    this.title.textContent = death.ending ? "The end" : "You did not wake";
    this.root.classList.toggle("death-screen-ending", !!death.ending);
    this.by.textContent = death.by;
    this.where.textContent = death.room;
    this.portrait = death.portrait;
    this.canvas.width = Math.max(1, Math.round(window.innerWidth / PIXEL_SIZE));
    this.canvas.height = Math.max(1, Math.round(window.innerHeight / PIXEL_SIZE));
    this.started = performance.now();
    this.draw();
    this.timer = setInterval(this.draw, 1000 / FPS);
    this.root.classList.remove("death-screen-shown");
    this.root.hidden = false;
    // Next frame, so the fade-in transition runs.
    requestAnimationFrame(() => this.root.classList.add("death-screen-shown"));

    return new Promise((resolve) => {
      const choose = (choice: DeathChoice) => {
        clearInterval(this.timer);
        this.root.hidden = true;
        resolve(choice);
      };
      // Room names often bring their own article ("The Cliff Path").
      const retry = this.menuItem("Try again", `Wake in the ${death.room.replace(/^the\s+/i, "")}, whole again`, () => choose("retry"));
      this.items = [...(death.ending ? [] : [retry]), this.menuItem("New dream", "Another haunting, from the title screen", () => choose("new"))];
      this.menu.replaceChildren(...this.items);
      this.select(this.items[0]);
    });
  }

  private menuItem(label: string, detail: string, action: () => void) {
    const button = element("button", "title-item");
    button.type = "button";
    element("span", "title-item-marker", button).setAttribute("aria-hidden", "true");
    element("span", "title-item-label", button, label);
    element("span", "title-item-detail", button, detail);
    button.addEventListener("click", action);
    button.addEventListener("pointerenter", () => this.select(button));
    button.addEventListener("focus", () => this.select(button));
    return button;
  }

  private select(item: HTMLButtonElement) {
    for (const other of this.items) other.classList.toggle("title-item-selected", other === item);
    if (document.activeElement !== item) item.focus();
  }

  private onKey = (e: KeyboardEvent) => {
    const i = this.items.findIndex((item) => item.classList.contains("title-item-selected"));
    const step = e.key === "ArrowDown" || e.key === "s" ? 1 : e.key === "ArrowUp" || e.key === "w" ? -1 : 0;
    if (!step || i < 0) return;
    e.preventDefault();
    this.select(this.items[(i + step + this.items.length) % this.items.length]);
  };

  private draw = () => {
    const { ctx, canvas } = this;
    const { width: w, height: h } = canvas;
    const t = (performance.now() - this.started) / 1000;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);

    const figure = this.portrait;
    if (figure) {
      const iw = Number((figure as HTMLImageElement).width);
      const ih = Number((figure as HTMLImageElement).height);
      // It breathes, and drifts slowly closer the longer the player waits.
      const scale = ((h * FIGURE_HEIGHT) / ih) * (1 + 0.015 * Math.sin(t * 0.8) + Math.min(t, 30) * 0.004);
      ctx.globalAlpha = Math.min(1, t / 2.5);
      ctx.drawImage(figure, (w - iw * scale) / 2, h * 0.08, iw * scale, ih * scale);
      ctx.globalAlpha = 1;
    }
    // Dark at the edges and behind the words.
    const vignette = ctx.createRadialGradient(w / 2, h * 0.55, Math.min(w, h) * 0.2, w / 2, h * 0.55, Math.max(w, h) * 0.7);
    vignette.addColorStop(0, "rgba(0,0,0,0.15)");
    vignette.addColorStop(1, "rgba(0,0,0,0.95)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
    this.bleed(w, h);
  };

  /** Drained to blood red, with grain, then the game's dither. */
  private bleed(w: number, h: number) {
    const image = this.ctx.getImageData(0, 0, w, h);
    const d = image.data;
    const steps = COLOR_LEVELS - 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const grain = ((Math.random() - 0.5) * GRAIN) / 255;
        const l = Math.max(0, ((0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 255) * FIGURE_BRIGHTNESS + grain * 0.5);
        const rgb = [l * 1.15 + Math.abs(grain) * 0.3, l * l * 0.55, l * l * 0.5];
        const threshold = BAYER[(x & 3) + (y & 3) * 4];
        for (let c = 0; c < 3; c++) {
          d[i + c] = Math.round((Math.max(0, Math.floor(Math.min(1, rgb[c]) * steps + 0.5 + threshold)) / steps) * 255);
        }
      }
    }
    this.ctx.putImageData(image, 0, 0);
  }
}
