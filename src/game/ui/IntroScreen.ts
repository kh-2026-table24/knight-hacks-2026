// Shown once the game is ready, before play starts: the game's opening picture with the story so far,
// one paragraph at a time. It reuses the title screen's frame (.title-screen), so it fades the same way.
const ADVANCE_KEYS = new Set(["e", " ", "enter"]);
// Ignore input for a moment after each paragraph appears, so a held or repeated key doesn't skip it.
const INPUT_DELAY_MS = 400;

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement) => {
  const el = document.createElement(tag);
  el.className = className;
  parent?.append(el);
  return el;
};

export class IntroScreen {
  private readonly root: HTMLElement;
  private readonly text: HTMLElement;
  private readonly more: HTMLElement;

  /** `imageUrl` is undefined when the picture couldn't be made; the text shows on its own. */
  constructor(imageUrl: string | undefined, parent: HTMLElement = document.body) {
    this.root = element("div", "title-screen intro-screen", parent);
    if (imageUrl) {
      const picture = element("img", "intro-picture", this.root);
      picture.src = imageUrl;
      picture.alt = "";
      // A picture that won't load leaves the text on its own.
      picture.onerror = () => picture.remove();
    }
    this.text = element("p", "intro-text", this.root);
    this.more = element("p", "intro-more", this.root);
  }

  /** Shows the paragraphs one at a time and resolves once the last one is read. */
  async play(paragraphs: string[]) {
    for (const [i, paragraph] of paragraphs.entries()) {
      this.text.classList.remove("intro-text-shown");
      this.text.textContent = paragraph;
      // Restarts the fade-in for each paragraph.
      void this.text.offsetWidth;
      this.text.classList.add("intro-text-shown");
      this.more.textContent = i === paragraphs.length - 1 ? "[E] Begin" : "[E] Continue";
      await this.nextInput();
    }
  }

  hide() {
    this.root.classList.add("title-screen-leaving");
    setTimeout(() => this.root.remove(), 900);
  }

  private nextInput() {
    const acceptAt = performance.now() + INPUT_DELAY_MS;
    return new Promise<void>((resolve) => {
      const done = () => {
        window.removeEventListener("keydown", onKey);
        this.root.removeEventListener("click", onClick);
        resolve();
      };
      const onKey = (e: KeyboardEvent) => {
        if (!ADVANCE_KEYS.has(e.key.toLowerCase())) return;
        // So the press that begins the game doesn't also reach the game's own [E].
        e.preventDefault();
        if (!e.repeat && performance.now() >= acceptAt) done();
      };
      const onClick = () => {
        if (performance.now() >= acceptAt) done();
      };
      window.addEventListener("keydown", onKey);
      this.root.addEventListener("click", onClick);
    });
  }
}
