import type { ConnectionSpec } from "../shared/spec";
import type { GameState } from "./GameState";

/** An edge in the room graph. A locked one stays locked until the player opens it, which opens both sides. */
export class Connection {
  readonly id: string;
  readonly roomIds: [string, string];

  constructor(
    private readonly spec: ConnectionSpec,
    private readonly state: GameState,
  ) {
    this.id = spec.id;
    this.roomIds = spec.rooms;
  }

  get locked() {
    return this.spec.locked && !this.state.unlocked.has(this.id);
  }

  unlock() {
    this.state.unlocked.add(this.id);
  }

  otherRoom(roomId: string) {
    return this.roomIds[0] === roomId ? this.roomIds[1] : this.roomIds[0];
  }
}
