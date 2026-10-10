// Plays through the haunted fixture headlessly: the engine's real rooms, physics and interactions, with
// no renderer. The player is teleported next to things and presses [E], the way a tester would. This
// catches engine logic regressions that npm run check (which only validates data) can't.
//
//   npm run check:play
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { init as initPhysics, World } from "@dimforge/rapier3d-compat";
import { Scene, Vector3 } from "three";

// The engine listens for keys on window and draws texture placeholders on a canvas; stand-ins are enough.
// Rapier times its steps with window.performance whenever a window exists, so the stand-in needs it.
const listeners: ((e: unknown) => void)[] = [];
Object.assign(globalThis, {
  window: { performance, addEventListener: (type: string, fn: (e: unknown) => void) => type === "keydown" && listeners.push(fn) },
  document: { createElement: () => ({ getContext: () => ({ fillRect() {} }) }) },
});
const press = (key: string) => listeners.forEach((fn) => fn({ key, repeat: false, defaultPrevented: false, preventDefault() {} }));

const { validateGame } = await import("../src/shared/validate");
const { Game } = await import("../src/game/Game");
const { Interactions } = await import("../src/game/Interactions");
const { Player } = await import("../src/game/Player");
type Room = import("../src/game/Room").Room;
type Hud = import("../src/game/ui/Hud").Hud;

await initPhysics();
const { spec } = validateGame(JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "games", "haunted.json"), "utf8")));
if (!spec) throw new Error("fixtures/games/haunted.json doesn't validate; run npm run check");

const lines: string[] = [];
let hint: string | null = null;
const hud = {
  setHearts() {},
  setItems() {},
  setHint: (text: string | null) => (hint = text),
  dialogue: { isOpen: false, play: async (said: string[]) => void lines.push(...said) },
};

const world = new World({ x: 0, y: -9.81, z: 0 });
const scene = new Scene();
const player = new Player(world);
const game = new Game("haunted", spec);
let room: Room | null = null;
const swapRooms = (next: Room, arrival?: string) => {
  room?.removeFrom(scene, world);
  next.addTo(scene, world);
  room = next;
  interactions.reset();
  player.reset(arrival ? next.arrivalPoint(arrival) : next.start, world);
};
const interactions = new Interactions({ player, world, hud: hud as unknown as Hud, game: () => game, room: () => room, swapRooms });
swapRooms(game.startRoom);

const STEP = 1 / 60;
/** Runs the game for a while; awaits between steps so dialogue and other async reactions settle. */
async function run(seconds: number) {
  for (let t = 0; t < seconds; t += STEP) {
    player.update(STEP);
    world.timestep = STEP;
    world.step();
    room!.update(STEP, hud.dialogue.isOpen, player.position);
    if (!hud.dialogue.isOpen) interactions.step();
    await Promise.resolve();
  }
}
async function teleport(x: number, z: number) {
  player.reset(new Vector3(x, 0, z), world);
  await run(0.25);
}
const said = (text: string) => lines.some((line) => line.includes(text));

let failures = 0;
function check(ok: boolean, what: string) {
  if (ok) console.log(`✓ ${what}`);
  else {
    failures++;
    console.error(`✗ ${what}  (room: ${room?.id}, player: ${player.position.toArray().map((n) => n.toFixed(2)).join(", ")}, hint: ${hint}, last lines: ${JSON.stringify(lines.slice(-3))})`);
  }
}

// Foyer: the cellar door is locked until the key is found on the butler.
await teleport(11.5, 0.85);
check(said("It's locked.") && room!.id === "foyer", "the locked cellar door says it's locked");
await teleport(11.5, 3);

// The corpse is a panel at z = 3; [E] reaches 1 m.
await teleport(16, 3.7);
check(hint === "[E] Examine", "the corpse can be examined");
press("e");
await run(1.5);
check(said("Something glints in his cold, clenched hand."), "examining the corpse shows its text");
await teleport(16, 3.7);
check(game.state.keys.some((k) => k.name === "Brass Key"), "the key drops out and can be picked up");
press("e");
await run(1.5);
await teleport(16, 3.7);
check(game.state.keys.length === 1, "the corpse only gives the key once");

await teleport(12.5, 6);
check(hint === null, "no [E] hint away from everything");

// Through the locked door with the key, and back.
await teleport(11.5, 0.85);
check(said("You unlock it with the Brass Key.") && room!.id === "cellar", "the key unlocks the cellar door");
check(Math.abs(player.position.z - 10.2) < 0.3, "the player arrives in front of the cellar's door");
await teleport(7, 11.6);
check(room!.id === "foyer", "the cellar's exit strip leads back to the foyer");
await teleport(11.5, 3);
await teleport(11.5, 0.85);
check(room!.id === "cellar", "the cellar door stays unlocked");
await teleport(7, 11.6);

// Study: the caretaker talks.
await teleport(19.15, 14.5);
check(room!.id === "study", "the east door leads to the study");
const caretaker = room!.characters.find((c) => c.id === "caretaker")!;
await teleport(caretaker.mesh.position.x, caretaker.mesh.position.z + 0.9);
check(hint === "[E] Talk", "the caretaker can be talked to");
press("e");
await run(0.5);
check(said("He always kept the key on him."), "talking to the caretaker plays the dialogue");

// Back in the foyer, the ghost hurts and eventually kills.
// Touching the west door (it stands 0.31 m from the wall), not its arrival spot.
await teleport(0.85, 5);
check(room!.id === "foyer", "the study's west door leads back to the foyer");
const ghost = room!.characters.find((c) => c.id === "ghost")!;
await teleport(ghost.mesh.position.x, ghost.mesh.position.z);
check(game.state.hearts < 4, "the ghost hurts on touch");
// Each hit is followed by a blinking grace period, so four hits take about five seconds.
for (let i = 0; i < 40 && !said("Everything goes dark..."); i++) await teleport(ghost.mesh.position.x, ghost.mesh.position.z);
check(said("Everything goes dark...") && game.state.hearts === 4, "dying shows a message and restores the hearts");

console.log(failures ? `\n${failures} check(s) failed` : "\nPlaythrough passed");
process.exit(failures ? 1 : 0);
