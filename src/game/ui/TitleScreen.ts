import type { GameSummary } from "../../shared/api";

// The title screen: the name glowing across the top left, a short menu under it, and a blurred figure
// reaching out of the dark on the right. Plain HTML over the (still empty) canvas, like the HUD.
// The name is a placeholder.
export const GAME_NAME = "Château Nowhere";
// START GAME plays this one when it's in the list, otherwise the first game.
const FEATURED_GAME = "haunted";

interface MenuItem {
  label: string;
  /** A line shown under the item while it's selected. */
  detail?: string;
  action: () => void;
}

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, text?: string) => {
  const el = document.createElement(tag);
  el.className = className;
  if (text) el.textContent = text;
  parent?.append(el);
  return el;
};

/** The story's opening sentence. */
const firstSentence = (text: string) => text.match(/^.*?[.!?](\s|$)/)?.[0].trim() ?? text;

// How sharply the name arches (em of drop per unit of width, squared), and roughly how wide each
// letter is (em), for working out the tilt that follows the curve.
const ARCH = 4.2;
const LETTER_WIDTH = 0.78;

/** One span per letter, lifted onto an arch and turned to follow it, like the name was scrawled in a sweep. */
function archedLetters(text: string, parent: HTMLElement) {
  const letters = [...text];
  letters.forEach((char, i) => {
    const t = letters.length === 1 ? 0.5 : i / (letters.length - 1);
    const span = element("span", "title-letter", parent, char === " " ? " " : char);
    // Highest a little right of center, dipping at both ends; the slope sets each letter's tilt.
    const x = t - 0.45;
    const width = letters.length * LETTER_WIDTH;
    span.style.setProperty("--lift", `${(ARCH * x * x - ARCH * 0.25).toFixed(3)}em`);
    span.style.setProperty("--tilt", `${((Math.atan((2 * ARCH * x) / width) * 180) / Math.PI).toFixed(1)}deg`);
    // Each letter flickers on its own clock, so the glow never pulses in unison.
    span.style.animationDelay = `${(-Math.random() * 9).toFixed(2)}s`;
  });
}

export class TitleScreen {
  private readonly root: HTMLElement;
  private readonly menu: HTMLElement;
  private readonly status: HTMLElement;
  private items: HTMLButtonElement[] = [];
  private games: GameSummary[] = [];
  private pick: ((id: string) => void) | null = null;

  constructor(parent: HTMLElement = document.body) {
    this.root = element("div", "title-screen", parent);
    const figure = element("img", "title-figure", this.root);
    figure.src = "/title/ghost.jpg";
    figure.alt = "";
    element("div", "title-grain", this.root);

    const column = element("div", "title-column", this.root);
    const name = element("h1", "title-name", column);
    name.setAttribute("aria-label", GAME_NAME);
    // A smeared copy behind the name, like it was dragged across the glass.
    archedLetters(GAME_NAME, element("span", "title-name-smear", name));
    archedLetters(GAME_NAME, element("span", "title-name-text", name));

    this.status = element("p", "title-status", column);
    this.menu = element("nav", "title-menu", column);
    this.menu.addEventListener("keydown", this.onKey);
  }

  /** Shows the menu and resolves with the id of the game to play. */
  async choose(): Promise<string> {
    const picked = new Promise<string>((resolve) => (this.pick = resolve));
    this.status.textContent = "listening at the door…";
    try {
      const response = await fetch("/api/games");
      if (!response.ok) throw new Error(await response.text());
      this.games = (await response.json()) as GameSummary[];
    } catch (error) {
      this.status.textContent = `the house won't answer (${error instanceof Error ? error.message : String(error)})`;
      return new Promise(() => {});
    }
    if (this.games.length === 0) {
      this.status.textContent = "no houses tonight";
      return new Promise(() => {});
    }
    this.status.hidden = true;
    this.showMain();
    return picked;
  }

  hide() {
    this.root.classList.add("title-screen-leaving");
    setTimeout(() => this.root.remove(), 900);
  }

  private showMain() {
    const featured = this.games.find((g) => g.id === FEATURED_GAME) ?? this.games[0];
    this.setMenu([
      { label: "Start game", action: () => this.choosePick(featured.id) },
      { label: "Browse games", action: () => this.showBrowse() },
    ]);
  }

  private showBrowse() {
    this.setMenu(
      [
        ...this.games.map((game) => ({
          label: game.title,
          detail: `${game.rooms} rooms · ${firstSentence(game.summary)}`,
          action: () => this.choosePick(game.id),
        })),
        { label: "Back", action: () => this.showMain() },
      ],
      true,
    );
  }

  private choosePick(id: string) {
    for (const item of this.items) item.disabled = true;
    this.pick?.(id);
  }

  private setMenu(entries: MenuItem[], browsing = false) {
    this.menu.classList.toggle("title-menu-browse", browsing);
    this.items = entries.map((entry) => {
      const button = element("button", "title-item");
      button.type = "button";
      element("span", "title-item-marker", button).setAttribute("aria-hidden", "true");
      element("span", "title-item-label", button, entry.label);
      if (entry.detail) element("span", "title-item-detail", button, entry.detail);
      button.addEventListener("click", entry.action);
      // The pointer and the keyboard share one selection.
      button.addEventListener("pointerenter", () => this.select(button));
      button.addEventListener("focus", () => this.select(button));
      return button;
    });
    this.menu.replaceChildren(...this.items);
    this.select(this.items[0]);
  }

  private select(item: HTMLButtonElement) {
    for (const other of this.items) other.classList.toggle("title-item-selected", other === item);
    if (document.activeElement !== item) item.focus({ preventScroll: false });
  }

  private onKey = (e: KeyboardEvent) => {
    const i = this.items.findIndex((item) => item.classList.contains("title-item-selected"));
    const step = e.key === "ArrowDown" || e.key === "s" ? 1 : e.key === "ArrowUp" || e.key === "w" ? -1 : 0;
    if (step && i >= 0) {
      e.preventDefault();
      this.select(this.items[(i + step + this.items.length) % this.items.length]);
    } else if (e.key === "Escape" && this.menu.classList.contains("title-menu-browse")) {
      e.preventDefault();
      this.showMain();
    }
  };
}
