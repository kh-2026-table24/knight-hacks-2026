import type { World } from "@dimforge/rapier3d-compat";
import { PLAYER } from "../shared/constants";
import type { ScreamJob } from "../shared/screams";
import type { ItemSpec } from "../shared/spec";
import type { GameAudio } from "./audio/GameAudio";
import { Character } from "./Character";
import { Door } from "./Door";
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

const verb = (target: Interactable) => (target instanceof Character ? "Talk" : target.examine ? "Examine" : "Search");
const describe = (item: ItemSpec) => `the ${item.name}`;

// What the player does to the world. Touching is passive: doors go through, hazards and hostile
// characters hurt, and pickups are collected by walking up to them. [E] is deliberate: talk to a
// character, examine a prop, or search one for what it holds.
export class Interactions {
  /** What the player was touching last step, so a door only triggers once on contact. */
  private touching = new Set<Touchable>();
  /** When each character last jumpscared the player (performance.now()). */
  private lastScare = new WeakMap<Character, number>();

  constructor(private readonly host: InteractionHost) {
    window.addEventListener("keydown", (e) => {
      // defaultPrevented: the dialogue box already used this press (e.g. to close the last line).
      if (e.key.toLowerCase() === "e" && !e.repeat && !e.defaultPrevented && !host.hud.dialogue.isOpen) void this.interact();
    });
  }

  /** Forgets what was being touched, e.g. after moving to another room. */
  reset() {
    this.touching.clear();
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
    const started = [...now].filter((owner) => !this.touching.has(owner));
    this.touching = now;

    // Checked every step: something hostile keeps hurting while you stay in contact, once the blinking from the last hit ends.
    for (const owner of now) {
      const damage = owner instanceof Character ? owner.hostile?.damage : owner instanceof Prop ? owner.hazard?.damage : undefined;
      if (damage && this.hurt(game, damage, owner instanceof Character ? owner : undefined)) break;
    }

    for (const pickup of room.pickupsInReach(player.position)) {
      this.host.audio?.play(pickup.item.kind === "key" ? "key-pickup" : "pickup");
      if (pickup.item.kind === "key") {
        game.state.keys.push(pickup.item);
        hud.setItems(game.state.keys.map((key) => ({ name: key.name })));
      }
      if (pickup.stateKey) game.state.collected.add(pickup.stateKey);
      room.take(pickup);
    }

    const target = room.interactTarget(player.position);
    hud.setHint(target ? `[E] ${verb(target)}` : null);

    for (const owner of started) {
      if (owner instanceof Door) void this.useDoor(owner);
      if (this.host.room() !== room) return; // went through a door
    }
  }

  /** Takes hearts unless the player is still blinking from the last hit. Returns whether it landed. */
  private hurt(game: Game, damage: number, by?: Character) {
    const { player, hud } = this.host;
    if (!player.vulnerable || game.state.hearts === 0) return false;
    game.state.hearts = Math.max(0, game.state.hearts - damage);
    player.startInvulnerability(PLAYER.invulnerableSeconds);
    hud.setHearts(game.state.hearts, PLAYER.maxHearts);
    const dead = game.state.hearts === 0;
    const last = by && this.lastScare.get(by);
    if (by?.scream && (last === undefined || performance.now() - last > SCARE_COOLDOWN_SECONDS * 1000)) {
      void this.scare(by, by.scream).then(() => {
        if (dead) void this.die(game);
      });
    } else {
      this.host.audio?.play("hurt");
      if (dead) void this.die(game);
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

  // Each press plays the next conversation and the last one repeats. A held item comes out once the
  // player has first heard everything there is to hear.
  private async interact() {
    const room = this.host.room();
    const game = this.host.game();
    const target = room?.interactTarget(this.host.player.position);
    if (!room || !game || !target) return;

    const key = stateKey(room.id, target.id);
    const conversations = (target instanceof Character ? target.dialogue : target.examine) ?? [];
    const finished = game.state.conversations.get(key) ?? 0;
    if (conversations.length > 0) {
      const { speaker, lines } = conversations[Math.min(finished, conversations.length - 1)];
      await this.show(lines, speaker ?? (target instanceof Character ? target.name : ""));
      game.state.conversations.set(key, finished + 1);
    }

    const item = target instanceof Character ? target.gives : target.contains;
    if (!item || game.state.given.has(key) || finished + 1 < conversations.length || this.host.room() !== room) return;
    if (conversations.length === 0) await this.show([`You find ${describe(item)}.`]);
    game.state.given.add(key);
    room.drop(target, item);
    this.host.audio?.play("drop");
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

    if (key) {
      connection.unlock();
      this.host.audio?.play("unlock");
      await this.show([`You unlock it with ${describe(key)}.`]);
    }
    if (this.host.room() !== room) return;
    this.host.audio?.play("door-open");
    this.host.swapRooms(next, connection.id);
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

  // Placeholder until the game's states are designed: back to the room's start with full hearts.
  private async die(game: Game) {
    this.host.audio?.play("thud");
    await this.show(["Everything goes dark..."]);
    game.state.hearts = PLAYER.maxHearts;
    this.host.player.clearInvulnerability();
    this.host.hud.setHearts(game.state.hearts, PLAYER.maxHearts);
    const room = this.host.room();
    if (room) this.host.swapRooms(room);
  }
}
