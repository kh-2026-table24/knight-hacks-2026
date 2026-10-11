import { PLAYABLE_SHARE, type CreatedGame, type GameSummary } from "../../shared/api";
import type { GameAudio } from "../audio/GameAudio";
import { TitleArt } from "./TitleArt";

// The title screen, PS1-style: the picture (TitleArt) is drawn at low resolution and dithered like the
// game, under a pixel-font menu. It opens on PRESS ANY KEY, which is also what lets the browser start
// the music. NEW GAME has the server make one; BROWSE GAMES lists every game made before, each in the
// dialogue box's frame, with how far along its art is. The name is a placeholder.
export const GAME_NAME = "Château Nowhere";
const MENU_THEME = "/audio/menu-theme.mp3";
// While browsing, the list refreshes this often so games being painted count up.
const BROWSE_REFRESH_MS = 2000;

interface MenuItem {
  label: string;
  /** A line shown under the item while it's selected. */
  detail?: string;
  action: () => void;
}

/** What a game's card says about how far along it is. */
function gameState(game: GameSummary) {
  const percent = `${Math.floor(game.progress * 100)}%`;
  switch (game.stage) {
    case "story":
      return "Being written...";
    case "rooms":
      return "Raising the rooms...";
    case "art":
      if (!game.loading) return `Partly painted · ${percent} · opening it carries on`;
      return `Painting · ${percent}${game.progress >= PLAYABLE_SHARE ? " · doors open" : ""}`;
    case "ready":
      return "Ready";
    case "failed":
      return "Lost · it never took shape";
  }
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
  private pick: ((id: string) => void) | null = null;
  private stopMusic: (() => void) | undefined;
  private browseTimer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped whenever the menu changes, so a list refresh still in flight from before knows to stop. */
  private menuVersion = 0;
  /** The browse list's cards by game id, so a refresh can update them in place. */
  private cards = new Map<string, { button: HTMLButtonElement; state: HTMLElement }>();

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

  /** Waits for a key, shows the menu, and resolves with the id of the game to play (a new one, or one made before). */
  async choose(): Promise<string> {
    const picked = new Promise<string>((resolve) => (this.pick = resolve));
    await this.pressAnyKey();
    if (this.audio) this.stopMusic = await this.audio.playTrack(MENU_THEME, 3).catch(() => undefined);
    this.prompt.hidden = true;
    this.menu.hidden = false;
    this.showMain();
    return picked;
  }

  hide() {
    clearTimeout(this.browseTimer);
    this.menuVersion++;
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

  private showMain(note?: string) {
    clearTimeout(this.browseTimer);
    this.menuVersion++;
    this.setMenu([
      { label: "New game", detail: note ?? "A real haunting, written and painted for you", action: () => void this.create() },
      { label: "Browse games", detail: "Houses made before", action: () => void this.showBrowse() },
    ]);
  }

  /** Asks the server for a new game; it starts making it and answers with its id right away. */
  private async create() {
    for (const item of this.items) item.disabled = true;
    try {
      const response = await fetch("/api/games", { method: "POST" });
      if (!response.ok) throw new Error(await response.text());
      this.pick?.(((await response.json()) as CreatedGame).id);
    } catch (error) {
      this.showMain(`The house won't answer (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  private async showBrowse() {
    clearTimeout(this.browseTimer);
    const version = ++this.menuVersion;
    const games = await this.fetchGames();
    if (!games || version !== this.menuVersion) return;
    this.cards.clear();
    const cards = games.map((game) => this.card(game));
    const back = this.menuItem({ label: "Back", action: () => this.showMain() });
    const empty = games.length === 0 ? [element("p", "title-empty", undefined, "No houses yet. Make one with New game.")] : [];
    this.menu.classList.add("title-menu-browse");
    this.items = [...cards, back];
    this.menu.replaceChildren(...empty, ...this.items);
    this.select(this.items[0], true);
    this.browseTimer = setTimeout(() => void this.refreshBrowse(version), BROWSE_REFRESH_MS);
  }

  /** Updates the cards' progress in place, or rebuilds the list if games came or went. */
  private async refreshBrowse(version: number) {
    const games = await this.fetchGames(false);
    if (version !== this.menuVersion) return;
    if (games && (games.length !== this.cards.size || games.some((g) => !this.cards.has(g.id)))) {
      const selected = [...this.cards].find(([, card]) => card.button.classList.contains("title-item-selected"))?.[0];
      await this.showBrowse();
      const card = selected && this.cards.get(selected);
      if (card) this.select(card.button, true);
      return;
    }
    for (const game of games ?? []) {
      const card = this.cards.get(game.id)!;
      card.state.textContent = gameState(game);
      card.button.setAttribute("aria-disabled", String(game.stage === "failed"));
    }
    this.browseTimer = setTimeout(() => void this.refreshBrowse(version), BROWSE_REFRESH_MS);
  }

  private async fetchGames(showErrors = true): Promise<GameSummary[] | undefined> {
    try {
      const response = await fetch("/api/games");
      if (!response.ok) throw new Error(await response.text());
      return (await response.json()) as GameSummary[];
    } catch (error) {
      if (showErrors) this.showMain(`The house won't answer (${error instanceof Error ? error.message : String(error)})`);
      return undefined;
    }
  }

  /** A game in the browse list, drawn in the dialogue box's frame: its title as the speaker, its story as the line. */
  private card(game: GameSummary) {
    const button = element("button", "title-card hud-frame");
    button.type = "button";
    element("span", "title-card-title hud-dialogue-speaker", button, game.title);
    element("span", "title-card-text hud-dialogue-text", button, firstSentence(game.summary));
    const meta = element("span", "title-card-meta", button);
    if (game.rooms) meta.append(`${game.rooms} rooms · `);
    const state = element("span", "title-card-state", meta, gameState(game));
    button.setAttribute("aria-disabled", String(game.stage === "failed"));
    // A game that failed stays on the list so it's clear what happened, but can't be opened.
    this.wire(button, () => button.getAttribute("aria-disabled") !== "true" && this.choosePick(game.id));
    this.cards.set(game.id, { button, state });
    return button;
  }

  private choosePick(id: string) {
    clearTimeout(this.browseTimer);
    this.menuVersion++;
    for (const item of this.items) item.disabled = true;
    this.pick?.(id);
  }

  private setMenu(entries: MenuItem[]) {
    this.menu.classList.remove("title-menu-browse");
    this.items = entries.map((entry) => this.menuItem(entry));
    this.menu.replaceChildren(...this.items);
    this.select(this.items[0], true);
  }

  private menuItem(entry: MenuItem) {
    const button = element("button", "title-item");
    button.type = "button";
    element("span", "title-item-marker", button).setAttribute("aria-hidden", "true");
    element("span", "title-item-label", button, entry.label);
    if (entry.detail) element("span", "title-item-detail", button, entry.detail);
    this.wire(button, entry.action);
    return button;
  }

  private wire(button: HTMLButtonElement, action: () => void) {
    button.addEventListener("click", action);
    // The pointer and the keyboard share one selection.
    button.addEventListener("pointerenter", () => this.select(button));
    button.addEventListener("focus", () => this.select(button));
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
