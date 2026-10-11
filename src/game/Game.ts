import { artIdsForRoom, collectArt } from "../shared/art";
import { doorSides } from "../shared/checkGame";
import type { GameSpec } from "../shared/spec";
import { Connection } from "./Connection";
import { GameState } from "./GameState";
import { Room } from "./Room";
import { TextureLibrary } from "./TextureLibrary";

/** A validated GameSpec built into rooms, plus the state of the game being played. */
export class Game {
  readonly state = new GameState();
  readonly textures: TextureLibrary;
  readonly connections: Map<string, Connection>;
  readonly rooms: Map<string, Room>;
  readonly startRoom: Room;
  /** The art ids each room needs, by room id. */
  private readonly roomArt: Map<string, string[]>;

  constructor(
    /** The server's id for the game; its assets are served under it. */
    readonly id: string,
    readonly spec: GameSpec,
  ) {
    this.textures = new TextureLibrary(collectArt(spec));
    this.connections = new Map(spec.connections.map((c) => [c.id, new Connection(c, this.state)]));
    const sides = doorSides(spec.rooms, spec.connections);
    this.rooms = new Map(spec.rooms.map((room) => [room.id, new Room(room, this.textures, sides.get(room.id) ?? new Map(), this.state)]));
    this.startRoom = this.rooms.get(spec.rooms[0].id)!;
    this.roomArt = new Map(spec.rooms.map((room) => [room.id, artIdsForRoom(spec, room)]));
  }

  /** The text of the objective on screen, if the game has any. */
  get objective(): string | undefined {
    return this.spec.objectives[this.state.objective]?.text;
  }

  /** A room can be entered once every image it needs has loaded (or been given up on). */
  isRoomReady(roomId: string) {
    return (this.roomArt.get(roomId) ?? []).every((id) => this.textures.isSettled(id));
  }
}
