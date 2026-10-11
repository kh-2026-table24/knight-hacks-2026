import type { GameSummary } from "../../shared/api";
import type { GameAudio } from "../audio/GameAudio";
import { TitleArt } from "./TitleArt";

// The title screen, PS1-style: the picture (TitleArt) is drawn at low resolution and dithered like the
// game, under a pixel-font menu. It opens on PRESS ANY KEY, which is also what lets the browser start
// the music. The name is a placeholder.
export const GAME_NAME = "Château Nowhere";
// START GAME plays this one when it's in the list, otherwise the first game.
const FEATURED_GAME = "haunted";
const MENU_THEME = "/audio/menu-theme.mp3";

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

export class TitleScreen {
  private readonly root: HTMLElement;
  private readonly art = new TitleArt(GAME_NAME, "/title/ghost.jpg");
  private readonly prompt: HTMLElement;
  private readonly menu: HTMLElement;
  private items: HTMLButtonElement[] = [];
  private games: GameSummary[] = [];
  private pick: ((id: string) => void) | null = null;
  private stopMusic: (() => void) | undefined;

  constructor(
    private readonly audio?: GameAudio,
    parent: HTMLElement = document.body,
  ) {
    this.root = element("div", "title-screen", parent);
    this.root.append(this.art.canvas);
    void this.art.start();

    const column = element("div", "title-column", this.root);
    // The name is drawn in the picture; this is for screen readers.
    element("h1", "title-name", column, GAME_NAME);
    this.prompt = element("p", "title-prompt", column, "Press any key");
    this.menu = element("nav", "title-menu", column);
    this.menu.hidden = true;
    this.menu.addEventListener("keydown", this.onKey);
  }

  /** Waits for a key, shows the menu, and resolves with the id of the game to play. */
  async choose(): Promise<string> {
    const picked = new Promise<string>((resolve) => (this.pick = resolve));
    const list = fetch("/api/games").then(async (response) => {
      if (!response.ok) throw new Error(await response.text());
      return (await response.json()) as GameSummary[];
    });

    await this.pressAnyKey();
    if (this.audio) this.stopMusic = await this.audio.playTrack(MENU_THEME, 3).catch(() => undefined);
    try {
      this.games = await list;
    } catch (error) {
      this.prompt.textContent = `The house won't answer (${error instanceof Error ? error.message : String(error)})`;
      return new Promise(() => {});
    }
    if (this.games.length === 0) {
      this.prompt.textContent = "No houses tonight";
      return new Promise(() => {});
    }
    this.prompt.hidden = true;
    this.menu.hidden = false;
    this.showMain();
    return picked;
  }

  hide() {
    this.stopMusic?.();
    this.root.classList.add("title-screen-leaving");
    setTimeout(() => {
      this.art.stop();
      this.root.remove();
    }, 900);
  }

  private pressAnyKey() {
    return new Promise<void>((resolve) => {
      const go = (e: Event) => {
        if (e instanceof KeyboardEvent && (e.repeat || ["Shift", "Control", "Alt", "Meta"].includes(e.key))) return;
        e.preventDefault();
        window.removeEventListener("keydown", go);
        window.removeEventListener("pointerdown", go);
        resolve();
      };
      window.addEventListener("keydown", go);
      window.addEventListener("pointerdown", go);
    });
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
    this.select(this.items[0], true);
  }

  /** Marks an item selected, with a soft tick unless `quiet` (a new menu opening). */
  private select(item: HTMLButtonElement, quiet = false) {
    const changed = !item.classList.contains("title-item-selected");
    for (const other of this.items) other.classList.toggle("title-item-selected", other === item);
    if (document.activeElement !== item) item.focus();
    if (changed && !quiet) this.audio?.play("dialogue", { volume: 0.25, pitchJitter: 0 });
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
