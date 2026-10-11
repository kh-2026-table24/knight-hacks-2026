import type { World } from "@dimforge/rapier3d-compat";
import { PLAYER } from "../shared/constants";
import type { ScreamJob } from "../shared/screams";
import type { ItemSpec } from "../shared/spec";
import type { GameAudio } from "./audio/GameAudio";
import { Character } from "./Character";
import type { Door } from "./Door";
import type { Game } from "./Game";
import { stateKey } from "./GameState";
import type { Player } from "./Player";
import { Prop } from "./Prop";
import type { Interactable, Room, Touchable } from "./Room";
import type { Hud } from "./ui/Hud";

/** What Interactions needs from the game around it. */
export interface InteractionHost {
  readonly player: Player;
  readonly world: World;
  readonly hud: Hud;
  /** Sound effects, if there are any. */
  readonly audio?: GameAudio;
  game(): Game | null;
  room(): Room | null;
  swapRooms(next: Room, arrivalConnectionId?: string): void;
}

// A hostile character that catches the player jumpscares them (its face and its scream), then vanishes
// back to where it started and waits this long before hunting again. Catches by the same character
// within the cooldown are ordinary hits, so the scare doesn't wear out.
const VANISH_SECONDS = 4;
const SCARE_COOLDOWN_SECONDS = 20;

// The last heartbeats under the death screen: [seconds in, volume].
const HEARTBEAT_FADING: [number, number][] = [
  [0.6, 0.9],
  [1.5, 0.65],
  [2.8, 0.4],
  [4.6, 0.2],
];

const verb = (target: Interactable) => (target instanceof Character ? "Talk" : target.examine ? "Examine" : "Search");
const describe = (item: ItemSpec) => `the ${item.name}`;
// Said on later visits by a character, or by a prop that already handed over its item, with no "afterwards" of its own.
const NOTHING_MORE = { character: "I've told you all I know.", prop: "There's nothing more here." };

// What the player does to the world. Touching is passive: doors go through, hazards and hostile
// characters hurt, and pickups are collected by walking up to them. [E] is deliberate: talk to a
// character, examine a prop, or search one for what it holds.
export class Interactions {
  /** The door the player was walking into last step, so walking into one only uses it once. */
  private atDoor: Door | null = null;
  /** When each character last jumpscared the player (performance.now()). */
  private lastScare = new WeakMap<Character, number>();

  constructor(private readonly host: InteractionHost) {
    window.addEventListener("keydown", (e) => {
      // defaultPrevented: the dialogue box already used this press (e.g. to close the last line).
      if (e.key.toLowerCase() === "e" && !e.repeat && !e.defaultPrevented && !host.hud.dialogue.isOpen && !host.hud.death.isOpen) void this.interact();
    });
  }

  /** Forgets what was being touched, e.g. after moving to another room. */
  reset() {
    this.atDoor = null;
  }

  /** Runs every step while no dialogue is open. */
  step() {
    const { player, world, hud } = this.host;
    const room = this.host.room();
    const game = this.host.game();
    if (!room || !game) return;

    const now = new Set<Touchable>();
    for (const collider of player.touching(world)) {
      const owner = room.ownerOf(collider.handle);
      if (owner) now.add(owner);
    }
    const door = room.doors.find((d) => d.isEnteredFrom(player.position)) ?? null;
    const enteredDoor = door !== this.atDoor ? door : null;
    this.atDoor = door;

    // Checked every step: something hostile keeps hurting while you stay in contact, once the blinking from the last hit ends.
    for (const owner of now) {
      const damage = owner instanceof Character ? owner.hostile?.damage : owner instanceof Prop ? owner.hazard?.damage : undefined;
      if (damage && this.hurt(game, damage, owner as Character | Prop)) break;
    }

    for (const pickup of room.pickupsInReach(player.position)) {
      this.host.audio?.play(pickup.item.kind === "key" ? "key-pickup" : "pickup");
      if (pickup.item.kind === "key") {
        game.state.keys.push(pickup.item);
        this.showKeys(game);
      }
      if (pickup.stateKey) game.state.collected.add(pickup.stateKey);
      room.take(pickup);
      this.setObjective(game, pickup.objective);
    }

    const target = room.interactTarget(player.position);
    hud.setHint(target ? `[E] ${verb(target)}` : null);

    if (enteredDoor) void this.useDoor(enteredDoor);
  }

  /** Takes hearts unless the player is still blinking from the last hit. Returns whether it landed. */
  private hurt(game: Game, damage: number, by: Character | Prop) {
    const { player, hud } = this.host;
    if (!player.vulnerable || game.state.hearts === 0) return false;
    game.state.hearts = Math.max(0, game.state.hearts - damage);
    player.startInvulnerability(PLAYER.invulnerableSeconds);
    hud.setHearts(game.state.hearts, PLAYER.maxHearts);
    const dead = game.state.hearts === 0;
    const character = by instanceof Character ? by : undefined;
    const last = character && this.lastScare.get(character);
    // The killing blow always scares, cooldown or not.
    const scares = character?.scream && (dead || last === undefined || performance.now() - last > SCARE_COOLDOWN_SECONDS * 1000);
    if (character?.scream && scares) {
      void this.scare(character, character.scream).then(() => {
        if (dead) void this.die(game, by);
      });
    } else {
      this.host.audio?.play("hurt");
      if (dead) void this.die(game, by);
    }
    return true;
  }

  /** The character's face fills the screen as it screams; then it's gone. */
  private async scare(character: Character, scream: ScreamJob) {
    const { player, hud } = this.host;
    this.lastScare.set(character, performance.now());
    player.frozen = true;
    hud.setHint(null);
    this.host.audio?.scream(scream);
    try {
      await hud.jumpscare.play(character.portrait);
    } finally {
      player.frozen = false;
    }
    character.vanish(VANISH_SECONDS);
    // A fresh moment of blinking, in case it vanished to right where the player is standing.
    player.startInvulnerability(PLAYER.invulnerableSeconds);
  }

  // The first press plays the whole conversation (or examine text), then hands over any item and sets any
  // objective. Later presses play "afterwards". A character never repeats its conversation, so without
  // one it brushes the player off; a prop repeats its lines unless it held an item.
  private async interact() {
    const room = this.host.room();
    const game = this.host.game();
    const target = room?.interactTarget(this.host.player.position);
    if (!room || !game || !target) return;

    const key = stateKey(room.id, target.id);
    const character = target instanceof Character;
    const lines = character ? target.dialogue : target.examine;
    const item = character ? target.gives : target.contains;
    const speaker = character ? target.name : "";
    if (game.state.heard.has(key)) {
      const fallback = character ? [NOTHING_MORE.character] : item ? [NOTHING_MORE.prop] : lines;
      const later = target.afterwards ?? fallback;
      if (later) await this.show(later, speaker);
      return;
    }

    if (lines) await this.show(lines, speaker);
    game.state.heard.add(key);
    if (item && !game.state.given.has(key) && this.host.room() === room) {
      if (!lines) await this.show([`You find ${describe(item)}.`]);
      game.state.given.add(key);
      room.drop(target, item);
      this.host.audio?.play("drop");
    }
    this.setObjective(game, target.objective);
  }

  /** Makes `id` the objective on screen, unless the player is already past it. */
  private setObjective(game: Game, id: string | undefined) {
    const index = id ? game.spec.objectives.findIndex((objective) => objective.id === id) : -1;
    if (index <= game.state.objective) return;
    game.state.objective = index;
    this.host.hud.setObjective(game.objective ?? null);
  }

  private async useDoor(door: Door) {
    const game = this.host.game();
    const room = this.host.room();
    const connection = game?.connections.get(door.connectionId);
    if (!game || !room || !connection) return;

    const key = connection.locked ? game.state.keys.find((k) => k.unlocks === connection.id) : undefined;
    if (connection.locked && !key) {
      this.host.audio?.play("door-locked");
      await this.show(["It's locked."]);
      return;
    }

    const next = game.rooms.get(connection.otherRoom(room.id));
    if (!next) return;
    // The room beyond is still being painted (see main.ts); it opens once all its images are in.
    if (!game.isRoomReady(next.id)) {
      this.host.audio?.play("door-locked");
      await this.show(["The door won't give.", "Something on the other side is still taking shape. Try again soon."]);
      return;
    }

    // Walking up to a locked door with its key opens it straight away. Each key opens one door, so it's used up.
    if (key) {
      connection.unlock();
      game.state.keys.splice(game.state.keys.indexOf(key), 1);
      this.showKeys(game);
      this.host.audio?.play("unlock");
    }
    this.host.audio?.play("door-open");
    this.host.swapRooms(next, connection.id);
  }

  private showKeys(game: Game) {
    this.host.hud.setItems(game.state.keys.map((key) => ({ name: key.name })));
  }

  /** Shows lines in the dialogue box with the player held still until they're read. */
  private async show(lines: string[], speaker = "") {
    const { player, hud } = this.host;
    player.frozen = true;
    hud.setHint(null);
    this.host.audio?.play("dialogue", { volume: 0.5 });
    try {
      await hud.dialogue.play(lines, speaker);
    } finally {
      player.frozen = false;
    }
  }

  /** The death screen, over a heartbeat that slows and stops. Trying again starts the room over with full hearts; a new dream goes back to the title screen. */
  private async die(game: Game, by: Character | Prop) {
    const { player, hud, audio } = this.host;
    const room = this.host.room();
    player.frozen = true;
    hud.setHint(null);
    audio?.stopMusic();
    audio?.play("thud");
    for (const [at, volume] of HEARTBEAT_FADING) setTimeout(() => audio?.heartbeat(volume), at * 1000);

    const choice = await hud.death.show({
      by: by.name,
      room: game.spec.rooms.find((spec) => spec.id === room?.id)?.name ?? "dark",
      portrait: by instanceof Character ? by.portrait : undefined,
    });
    if (choice === "new") {
      location.assign("/");
      return;
    }
    game.state.hearts = PLAYER.maxHearts;
    player.clearInvulnerability();
    hud.setHearts(game.state.hearts, PLAYER.maxHearts);
    player.frozen = false;
    audio?.startMusic();
    if (room) this.host.swapRooms(room);
  }
}
