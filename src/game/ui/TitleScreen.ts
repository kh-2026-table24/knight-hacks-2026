import type { GameSummary } from "../../shared/api";

// The title screen: the game's name and the list of games to play, over the (still empty) canvas.
// Plain HTML like the HUD, sharing its frame art and font. The name is a placeholder.
export const GAME_NAME = "Château Nowhere";
const TAGLINE = "Every night, a different house. None of them are on any map.";

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, text?: string) => {
  const el = document.createElement(tag);
  el.className = className;
  if (text) el.textContent = text;
  parent?.append(el);
  return el;
};

/** The story's opening sentence, for the list. */
const firstSentence = (text: string) => text.match(/^.*?[.!?](\s|$)/)?.[0].trim() ?? text;

export class TitleScreen {
  private readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly status: HTMLElement;

  constructor(parent: HTMLElement = document.body) {
    this.root = element("div", "title-screen", parent);
    const heading = element("header", "title-heading", this.root);
    element("h1", "title-name", heading, GAME_NAME);
    element("p", "title-tagline", heading, TAGLINE);
    this.status = element("p", "title-status", this.root, "Listening at the door…");
    this.list = element("div", "title-games", this.root);
    this.list.setAttribute("role", "list");
    element("p", "title-controls", this.root, "WASD move · E interact · M mute · Esc back here");
  }

  /** Shows the games and resolves with the id of the one picked. */
  async choose(): Promise<string> {
    let games: GameSummary[];
    try {
      const response = await fetch("/api/games");
      if (!response.ok) throw new Error(await response.text());
      games = (await response.json()) as GameSummary[];
    } catch (error) {
      this.status.textContent = `The house won't answer. (${error instanceof Error ? error.message : String(error)})`;
      return new Promise(() => {});
    }
    if (games.length === 0) {
      this.status.textContent = "No houses tonight.";
      return new Promise(() => {});
    }
    this.status.hidden = true;

    return new Promise((resolve) => {
      const buttons = games.map((game) => {
        const button = element("button", "title-game hud-frame", this.list);
        button.type = "button";
        button.setAttribute("role", "listitem");
        const top = element("span", "title-game-top", button);
        element("span", "title-game-name", top, game.title);
        element("span", "title-game-rooms", top, `${game.rooms} rooms`);
        element("span", "title-game-summary", button, firstSentence(game.summary));
        button.addEventListener("click", () => {
          this.list.querySelectorAll("button").forEach((b) => (b.disabled = true));
          button.classList.add("title-game-chosen");
          resolve(game.id);
        });
        return button;
      });
      // Arrow keys move between games; Enter or Space (the buttons' own behavior) picks one.
      this.list.addEventListener("keydown", (e) => {
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
        if (!step || i < 0) return;
        e.preventDefault();
        buttons[(i + step + buttons.length) % buttons.length].focus();
      });
      buttons[0].focus();
    });
  }

  hide() {
    this.root.classList.add("title-screen-leaving");
    setTimeout(() => this.root.remove(), 600);
  }
}
