// The 2D overlay: hearts, the items the player carries, the current objective, a hint line, the dialogue box and a centered
// message for loading and errors. It's plain HTML over the canvas, so it stays crisp instead of going
// through the retro filter. The art in public/ui/ is shared by every game (scripts/gen-ui.ts makes it).
import { DeathScreen } from "./DeathScreen";
import { Jumpscare } from "./Jumpscare";

const DEFAULT_ITEM_ICON = "/ui/key.png";

/** An item as the HUD shows it. */
export interface HudItem {
  name: string;
  /** Defaults to the shared key icon. */
  iconUrl?: string;
}

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement) => {
  const el = document.createElement(tag);
  el.className = className;
  parent?.append(el);
  return el;
};

export class Hud {
  readonly dialogue: DialogueBox;
  readonly jumpscare: Jumpscare;
  readonly death: DeathScreen;
  private readonly hearts: HTMLElement;
  private readonly items: HTMLElement;
  private readonly objective: HTMLElement;
  private readonly objectiveText: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly message: HTMLElement;

  constructor(parent: HTMLElement = document.body) {
    const root = element("div", "hud", parent);
    this.items = element("div", "hud-items hud-frame", root);
    this.hearts = element("div", "hud-hearts", root);
    this.objective = element("div", "hud-objective", root);
    element("div", "hud-objective-label", this.objective).textContent = "Objective";
    this.objectiveText = element("div", "hud-objective-text", this.objective);
    this.hint = element("div", "hud-hint", root);
    this.dialogue = new DialogueBox(root);
    this.message = element("div", "hud-message", root);
    this.death = new DeathScreen(parent);
    this.jumpscare = new Jumpscare(parent);
    this.setItems([]);
    this.setObjective(null);
    this.setHint(null);
    this.showMessage(null);
  }

  /** A centered message over the game ("Generating…", or why a game couldn't load); null hides it. */
  showMessage(text: string | null) {
    this.message.hidden = !text;
    this.message.textContent = text ?? "";
  }

  setHearts(current: number, max: number) {
    this.hearts.replaceChildren(
      ...Array.from({ length: max }, (_, i) => {
        const heart = element("img", i < current ? "hud-heart" : "hud-heart hud-heart-empty");
        heart.src = "/ui/heart.png";
        heart.alt = "";
        return heart;
      }),
    );
  }

  /** Shows the items as a row of icons, hidden while there are none. */
  setItems(items: HudItem[]) {
    this.items.hidden = items.length === 0;
    this.items.replaceChildren(
      ...items.map((item) => {
        const slot = element("div", "hud-item");
        const icon = element("img", "hud-item-icon", slot);
        icon.src = item.iconUrl ?? DEFAULT_ITEM_ICON;
        // A generated icon that hasn't been made yet (or failed) falls back to the shared one.
        icon.onerror = () => {
          icon.onerror = null;
          icon.src = DEFAULT_ITEM_ICON;
        };
        icon.alt = "";
        element("span", "hud-item-name", slot).textContent = item.name;
        return slot;
      }),
    );
  }

  /** What the player should do next, along the top of the screen; null hides it. */
  setObjective(text: string | null) {
    this.objective.hidden = !text;
    this.objectiveText.textContent = text ?? "";
  }

  /** A short prompt above the bottom of the screen, e.g. "[E] Talk". */
  setHint(text: string | null) {
    this.hint.hidden = !text;
    this.hint.textContent = text ?? "";
  }
}

const CHARS_PER_SECOND = 45;
// Ignore input for a moment after opening, so the key press that opened the box doesn't also advance it.
const INPUT_DELAY_MS = 150;
const ADVANCE_KEYS = new Set(["e", " ", "enter"]);

/** Shows a conversation one line at a time. Reusable for NPCs, signs, locked doors and so on. */
export class DialogueBox {
  private readonly box: HTMLElement;
  private readonly speaker: HTMLElement;
  private readonly text: HTMLElement;
  private readonly more: HTMLElement;
  private advance: (() => void) | null = null;
  private acceptInputAt = 0;

  constructor(parent: HTMLElement) {
    this.box = element("div", "hud-dialogue hud-frame", parent);
    this.speaker = element("div", "hud-dialogue-speaker", this.box);
    this.text = element("div", "hud-dialogue-text", this.box);
    this.more = element("div", "hud-dialogue-more", this.box);
    this.more.textContent = "▼";
    this.box.hidden = true;

    window.addEventListener("keydown", (e) => {
      if (ADVANCE_KEYS.has(e.key.toLowerCase()) && this.isOpen) {
        e.preventDefault();
        this.onInput();
      }
    });
    this.box.addEventListener("click", () => this.onInput());
  }

  get isOpen() {
    return !this.box.hidden;
  }

  /** Plays the lines and resolves once the player has read the last one. An empty speaker hides the name. */
  async play(lines: string[], speaker = "") {
    this.box.hidden = false;
    this.speaker.textContent = speaker;
    this.speaker.hidden = !speaker;
    this.acceptInputAt = performance.now() + INPUT_DELAY_MS;
    for (const line of lines) await this.showLine(line);
    this.box.hidden = true;
  }

  // Types the line out; the first press finishes it, the next moves on.
  private showLine(line: string) {
    return new Promise<void>((resolve) => {
      let shown = 0;
      this.more.hidden = true;
      const timer = window.setInterval(() => {
        shown++;
        this.text.textContent = line.slice(0, shown);
        if (shown >= line.length) finishTyping();
      }, 1000 / CHARS_PER_SECOND);

      const finishTyping = () => {
        window.clearInterval(timer);
        this.text.textContent = line;
        this.more.hidden = false;
        this.advance = () => {
          this.advance = null;
          resolve();
        };
      };
      this.text.textContent = "";
      this.advance = finishTyping;
    });
  }

  private onInput() {
    if (performance.now() < this.acceptInputAt) return;
    this.advance?.();
  }
}
