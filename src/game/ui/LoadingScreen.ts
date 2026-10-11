import { PLAYABLE_SHARE, progressOf, type GameStatus } from "../../shared/api";
import { TitleArt } from "./TitleArt";
import { GAME_NAME } from "./TitleScreen";

// Shown while a game is being made and its art painted, over the same dithered picture as the title
// screen. A bar of candle-lit cells fills as images arrive; the mark on it is where the doors open
// (PLAYABLE_SHARE). Before there are images to count (the story, the rooms), a light crawls along it.
const CELLS = 25;
const LEAVE_NOTE = "Esc returns to the title. The house keeps building without you.";

const count = (n: number) => n.toLocaleString("en-US");

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, text?: string) => {
  const el = document.createElement(tag);
  el.className = className;
  if (text) el.textContent = text;
  parent?.append(el);
  return el;
};

export class LoadingScreen {
  private readonly root: HTMLElement;
  private readonly art = new TitleArt(GAME_NAME, "/title/ghost.jpg");
  private readonly title: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly cells: HTMLElement[];
  private readonly images: HTMLElement;
  private readonly tokens: HTMLElement;
  private readonly note: HTMLElement;
  private readonly log: HTMLElement;

  constructor(parent: HTMLElement = document.body) {
    this.root = element("div", "title-screen loading-screen", parent);
    this.root.setAttribute("role", "status");
    this.root.append(this.art.canvas);
    void this.art.start();

    const column = element("div", "loading-column", this.root);
    this.title = element("h2", "loading-title", column, "A new house");
    this.stage = element("p", "loading-stage", column, "Knocking...");
    this.bar = element("div", "loading-bar loading-bar-seeking", column);
    this.cells = Array.from({ length: CELLS }, (_, i) => {
      const cell = element("span", "loading-cell", this.bar);
      cell.style.setProperty("--i", String(i));
      return cell;
    });
    element("span", "loading-mark", this.bar).style.left = `${PLAYABLE_SHARE * 100}%`;
    // What it's costing: images from the GPU, tokens from Claude.
    this.images = element("p", "loading-stats", column);
    this.tokens = element("p", "loading-stats", column);
    this.images.hidden = this.tokens.hidden = true;
    this.note = element("p", "loading-note", column, LEAVE_NOTE);
    // The server's latest log lines about this game, newest at the bottom.
    this.log = element("pre", "loading-log", column);
    this.log.hidden = true;
  }

  /** Shows where the game is. `entering` once enough is painted and the first room is being unpacked. */
  show(status: GameStatus, entering = false) {
    if (status.title) this.title.textContent = status.title;
    const progress = progressOf(status);
    const counting = status.stage === "art" || status.stage === "ready";
    this.bar.classList.toggle("loading-bar-seeking", !counting);
    this.cells.forEach((cell, i) => cell.classList.toggle("loading-cell-lit", counting && i < Math.floor(progress * CELLS + 1e-9)));

    if (entering) this.stage.textContent = "Lighting the candles...";
    else if (status.stage === "story") this.stage.textContent = "Choosing a haunting...";
    else if (status.stage === "rooms") this.stage.textContent = `Raising the rooms · ${status.roomsBuilt ?? 0} of ${status.roomsTotal ?? "?"}`;
    else this.stage.textContent = `Painting the house · ${Math.floor(progress * 100)}%`;
    const { ready, failed, total, generating, tokens } = status;
    // Fixtures that are already painted have nothing worth counting.
    this.images.hidden = status.stage === "ready" && !tokens;
    this.images.textContent = counting
      ? [
          `Images ${count(ready.length)} / ${count(total)}`,
          `${generating} being painted now`,
          failed.length > 0 && `${failed.length} failed`,
        ].filter(Boolean).join(" · ")
      : "Images · painting starts once the rooms are built";
    this.tokens.hidden = !tokens;
    if (tokens) {
      // Calls still streaming only have an estimate of their output so far.
      const writing = tokens.live > 0;
      this.tokens.textContent = [
        `Claude tokens ${count(tokens.input)} in`,
        `${count(tokens.cached)} cached`,
        `${writing ? "~" : ""}${count(tokens.output)} out`,
        writing && `${tokens.live} ${tokens.live === 1 ? "call" : "calls"} writing`,
      ].filter(Boolean).join(" · ");
    }

    this.log.hidden = status.log.length === 0;
    this.log.textContent = status.log.join("\n");

    const waiting = counting && progress < PLAYABLE_SHARE;
    this.note.textContent = waiting ? `The doors open at ${Math.round(PLAYABLE_SHARE * 100)}%. ${LEAVE_NOTE}` : LEAVE_NOTE;
  }

  /** Why the game can't be played. */
  fail(message: string) {
    this.root.classList.add("loading-failed");
    this.bar.classList.remove("loading-bar-seeking");
    this.stage.textContent = "The house would not take shape.";
    this.note.textContent = `${message}\nEsc returns to the title.`;
  }

  hide() {
    this.root.classList.add("title-screen-leaving");
    setTimeout(() => {
      this.art.stop();
      this.root.remove();
    }, 900);
  }
}
