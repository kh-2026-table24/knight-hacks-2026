import type { Vector3 } from "three";
import type { RoomSpec } from "../../shared/spec";
import type { Room } from "../Room";
import { GameAudio } from "./GameAudio";
import { floorSoundFor, type FloorSound } from "./sounds";

// A heartbeat starts when something hostile is this close (meters), and speeds up as it gets closer.
const HEARTBEAT_RANGE = 6;
const HEARTBEAT_SECONDS: [near: number, far: number] = [0.45, 1.2];
// Standing on a prop counts if its top is within this of the player's feet.
const STANDING_TOLERANCE = 0.15;

/**
 * Decides what the game sounds like: the room's background, the music, footsteps on whatever the
 * player is standing on, and a heartbeat when something hostile is near. The engine tells it what
 * happened; GameAudio makes the sounds. M mutes everything.
 */
export class SoundDirector {
  readonly audio = new GameAudio();
  private floor: FloorSound = "concrete";
  private heartbeatIn = 0;
  private muted = false;

  constructor() {
    void this.audio.load();
    window.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() !== "m" || e.repeat) return;
      this.muted = !this.muted;
      this.audio.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.audio.context.currentTime, 0.05);
    });
  }

  /** A game has started: the music plays until the page closes. */
  start() {
    this.audio.startMusic();
  }

  enterRoom(spec: RoomSpec) {
    this.floor = floorSoundFor(spec.floor);
    this.audio.setAmbience(spec.outdoor ? "outdoor" : "indoor");
    // Creaks and distant doors belong inside the house.
    if (spec.outdoor) this.audio.stopHouseNoises();
    else this.audio.startHouseNoises();
    this.heartbeatIn = 0;
  }

  /** The player put a foot down. On a prop (stairs, a rug), its name says what it sounds like; otherwise the room's floor. */
  footstep(room: Room | null, feet: Vector3) {
    const under = room?.props.find(
      (prop) =>
        Math.abs(prop.bounds.max.y - feet.y) <= STANDING_TOLERANCE &&
        prop.bounds.max.y > 0 &&
        feet.x >= prop.bounds.min.x &&
        feet.x <= prop.bounds.max.x &&
        feet.z >= prop.bounds.min.z &&
        feet.z <= prop.bounds.max.z,
    );
    this.audio.footstep(under ? floorSoundFor(under.name, this.floor) : this.floor);
  }

  /** Runs every frame the game isn't paused. */
  update(dt: number, room: Room | null, player: Vector3) {
    let nearest = Infinity;
    for (const character of room?.characters ?? []) {
      if (!character.hostile) continue;
      const p = character.mesh.position;
      nearest = Math.min(nearest, Math.hypot(p.x - player.x, p.z - player.z));
    }
    if (nearest > HEARTBEAT_RANGE) return;

    this.heartbeatIn -= dt;
    if (this.heartbeatIn > 0) return;
    const closeness = 1 - nearest / HEARTBEAT_RANGE;
    const [near, far] = HEARTBEAT_SECONDS;
    this.heartbeatIn = far + (near - far) * closeness;
    this.audio.heartbeat(0.4 + 0.6 * closeness);
  }
}
