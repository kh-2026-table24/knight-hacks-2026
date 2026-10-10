// Sound board for audio-test.html: every sound in GameAudio, one button each.
import { GameAudio, type Ambience } from "./game/audio/GameAudio";
import { SOUND_VARIATIONS, type FloorSound, type SoundName } from "./game/audio/sounds";

const audio = new GameAudio();
await audio.load();
const board = document.getElementById("board")!;

function section(title: string, buttons: [string, (button: HTMLButtonElement) => void][]) {
  const heading = document.createElement("h2");
  heading.textContent = title;
  const row = document.createElement("div");
  row.className = "row";
  for (const [label, onClick] of buttons) {
    const button = document.createElement("button");
    button.textContent = label;
    button.addEventListener("click", () => void audio.context.resume().then(() => onClick(button)));
    row.append(button);
  }
  board.append(heading, row);
}

/** A button that switches something on and off. */
const toggle = (label: string, on: () => void, off: () => void): [string, (b: HTMLButtonElement) => void] => [
  label,
  (button) => (button.classList.toggle("on") ? on() : off()),
];

let walking: ReturnType<typeof setInterval> | undefined;
const floors: FloorSound[] = ["concrete", "wood", "grass", "carpet", "snow"];
section(
  "Walk (click again to stop)",
  floors.map((floor) => [
    floor,
    (button) => {
      clearInterval(walking);
      const wasOn = button.classList.contains("on");
      document.querySelectorAll("button.walk").forEach((b) => b.classList.remove("on"));
      button.classList.add("walk");
      if (wasOn) return;
      button.classList.add("on");
      walking = setInterval(() => audio.footstep(floor), 420);
    },
  ]),
);

const recorded = (Object.keys(SOUND_VARIATIONS) as SoundName[]).filter((name) => !name.startsWith("footstep"));
section("One-shots", [
  ...recorded.map((name): [string, () => void] => [name, () => audio.play(name)]),
  ["bats", () => audio.bats()],
  ["static", () => audio.static()],
  ["heartbeat", () => audio.heartbeat()],
]);

let ambience: Ambience | null = null;
const setAmbience = (kind: Ambience) => (button: HTMLButtonElement) => {
  ambience = ambience === kind ? null : kind;
  document.querySelectorAll("button.ambience").forEach((b) => b.classList.remove("on"));
  button.classList.add("ambience");
  if (ambience) button.classList.add("on");
  audio.setAmbience(ambience);
};
let heart: ReturnType<typeof setInterval> | undefined;
section("Loops", [
  ["outdoor wind", setAmbience("outdoor")],
  ["indoor room tone", setAmbience("indoor")],
  toggle("eerie music", () => audio.startMusic(), () => audio.stopMusic()),
  toggle("house noises (every 8-22s)", () => audio.startHouseNoises(), () => audio.stopHouseNoises()),
  toggle("heartbeat (enemy close)", () => (heart = setInterval(() => audio.heartbeat(), 700)), () => clearInterval(heart)),
]);
